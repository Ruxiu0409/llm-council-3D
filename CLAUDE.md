# CLAUDE.md - Technical Notes for LLM Council

This file contains technical details, architectural decisions, and important implementation notes for future development sessions.

## Project Overview

LLM Council is a 3-stage deliberation system where multiple LLMs collaboratively answer user questions. The key innovation is anonymized peer review in Stage 2, preventing models from playing favorites.

## Architecture

### Backend Structure (`backend/`)

**`config.py`**
- `DEFAULT_SETTINGS` (pool, chairman, planner) and `TITLE_MODEL`: auto-detected from installed CLIs, overridable via `LLM_COUNCIL_MODELS` / `LLM_COUNCIL_CHAIRMAN` / `LLM_COUNCIL_PLANNER` in `.env`
- `MODEL_CATALOG`: everything selectable, with a relative cost hint. Claude: fable/opus/sonnet/haiku. Codex: every visible model in `~/.codex/models_cache.json` (Codex's own server-fetched list; hints derived from its descriptions, e.g. "frontier", "fast"), falling back to the config.toml model if the cache is missing. Gemini: default
- Codex picks per tier come from that cache (`_codex_pick`): `max` → frontier, `standard` → latest workhorse, `economy` → fast. The ids depend on the user's Codex account, so never hardcode them. Codex effort is clamped to what each model supports; `ultra` (auto task delegation) is never used
- `BUDGETS`: tiers `economy` / `standard` / `max` (models, chairman, seats, effort), built from what's installed. `DEFAULT_BUDGET` comes from `LLM_COUNCIL_BUDGET` (default `standard`)
- `CouncilSettings` (pool, chairman, planner, min/max seats, effort) is per run: `settings_for()` starts from the request's `budget` (or the default tier) and applies explicit `models` / `chairman` / `seats` / `max_seats` / `effort` on top, then validates (seats 2–20; a chosen chairman also plans)
- `providers.MAX_CONCURRENT` (`LLM_COUNCIL_CONCURRENCY`, default 10) caps CLI calls running at once; larger councils queue
- Effort is passed to every call: Claude `--effort <level>`, Codex `-c model_reasoning_effort=...`. Timeouts grow with effort (`providers._TIMEOUTS`)
- Don't silently downgrade a user's choice to save quota: cheaper tiers/models only when asked
- Every council function takes the settings explicitly; there is no global pool anymore. Runs record `metadata.settings`
- No API keys: members run on the user's subscription logins
- Backend runs on **127.0.0.1:8001** (loopback only, because it drives the user's logged-in CLIs)

**`providers.py`**
- A `Member` is `cli/model` (e.g. `claude/opus`, `codex/<model>`); the id is what the UI shows
- `query_member()`: runs `claude -p` / `codex exec` / `gemini` headless with the prompt on stdin, from an empty temp dir so no project instructions leak in
- `query_parallel()`: parallel `(key, member, prompt)` jobs with an `on_response` callback per finished job; one model can fill several seats
- Graceful degradation: returns None on failure, continues with successful responses

**`runs.py`**
- A council run executes as a background task, independent of any HTTP request
- Every watcher (browser or CLI) replays all events from the start, then follows live
- Per-member events: `stage1_response`, `stage2_ranking` (in addition to `stageN_start/complete`)

**`cli.py`** (used by the skill)
- `ask`: starts the server detached, starts a run, and prints the verdict. With the GUI (default; `LLM_COUNCIL_GUI=0` or `--no-gui` turns it off) it also rebuilds a stale frontend and opens `/?c=<id>`. Without it, nothing is built or opened, but the run still lives in the server so it survives the CLI being killed
- `result <id>` (reattach or read stored), `open [id]` (3D view, latest by default), `members`, `stop`

**`council.py`** - The Core Logic
- `stage0_plan_council()`: the planner returns JSON choosing between `min_seats` and `max_seats` seats (2–20), each with a model from the pool, a `role`, and a `brief`
  - `parse_plan()` clamps to the pool and seat limits; on failure `default_seats()` gives one plain seat per pool model
  - A `Seat` id is `"model · role"` (unique); it's used everywhere the code says `model` (results, labels, rankings)
  - The plan is stored in `metadata.plan`
- `seat_prompt()`: Stage 1 prompt puts the seat in its perspective; Stage 2 reviews stay neutral (same prompt for every seat)
- `stage1_collect_responses()`: Parallel queries to all council models
- `stage2_collect_rankings()`:
  - Anonymizes responses as "Response A, B, C, etc."
  - Creates `label_to_model` mapping for de-anonymization
  - Prompts models to evaluate and rank (with strict format requirements)
  - Returns tuple: (rankings_list, label_to_model_dict)
  - Each ranking includes both raw text and `parsed_ranking` list
- `stage3_synthesize_final()`: Chairman synthesizes from all responses + rankings
- `parse_ranking_from_text()`: Extracts "FINAL RANKING:" section, handles both numbered lists and plain format
- `calculate_aggregate_rankings()`: Computes average rank position across all peer evaluations

**`storage.py`**
- JSON-based conversation storage in `data/conversations/`
- Each conversation: `{id, created_at, messages[]}`
- Assistant messages contain: `{role, stage1, stage2, stage3}`
- Assistant messages also persist `metadata` (label_to_model, aggregate_rankings) so reloads can de-anonymize

**`main.py`**
- FastAPI app with CORS enabled for localhost:5173 and localhost:3000
- POST `/api/conversations/{id}/runs` starts a background run; GET `/api/conversations/{id}/live` streams it as SSE
- Serves the built frontend (`frontend/dist`) from `/`, so production is one process on one port

### Frontend Structure (`frontend/src/`)

**`App.jsx`**
- Main orchestration: manages conversations list and current conversation
- Handles message sending and metadata storage
- Opening `/?c=<id>` selects that conversation; if its last message is from the user, it attaches to the live run
- All council events go through `watchRun()` → `handleCouncilEvent()` with immutable updates (StrictMode-safe)

**`components/CouncilSettings.jsx`** + `councilSettings.js`
- Under the composer: three budget cards from the server's `budgets` (省額度 / 標準 / 頂配), then a collapsible panel for models, seats (自動 or fixed), effort, and chairman, plus a call estimate (2 × seats + 2). Any manual change marks the budget 自訂
- Saved to localStorage (`llm-council-settings-v2`); without a saved choice, the server's `default_budget` is used

**`components/CouncilView.jsx`** (main area, keyed by conversation id)
- 3D chamber (lazy-loaded `chamber/Chamber.jsx`) + glass HUD: stage stepper, current speaker, question, verdict card, replay
- Composer for an empty conversation; transcript drawer (`Transcript.jsx`) reuses Stage0–3 for the full text
- Clicking a seat's nameplate or speech bubble opens the drawer on that seat

**`components/chamber/`** (react-three-fiber + drei + postprocessing)
- `useCouncilScene.js`: derives the scene from the latest assistant message. Utterances (plan, each answer, each review, the verdict) are spoken one at a time; the current speaker is *derived* (first unspoken utterance), and only a timer callback advances it. Live messages (have `loading`) play; stored ones start finished and can be replayed
- `Avatar.jsx`: seat, emblem, glow, nameplate, and speech bubble shared by every seat; the figure depends on the provider (`providers.js`). Claude seats are **Clawd** (`Clawd.jsx`), Claude Code's official mascot, built as voxels from its official pixel art (13×8 body, 1×2 eyes, 2×2 arms, four legs, `#d77757`); Clawd has no mouth, so speaking is hops, squash, and flapping arms. Fable gets a crown, Opus a halo, Haiku is smaller. Codex seats are the cloud from the official Codex app icon (`CodexFigure.jsx`, `>_` face: `>` eye, `_` cursor mouth) with the OpenAI logo (`OpenAILogo.jsx`, official path) as emblem. Gemini has no mascot here and uses the generic robot (`RobotFigure`). Status: idle, thinking (orbiting dots), speaking (mouth/nod/glow + `SpeechBubble`), absent
- `layout.js`: horseshoe seat positions, chairman on a dais at the back; seats face `SEAT_FOCUS` so faces read on camera. Past ~8 seats it adds raised back rows (`rowCount`, up to 3 rows for 20); `Avatar` draws a bench under elevated seats and `CameraRig` pulls back per extra row
- `VoteArcs.jsx`: arc from each reviewer to its #1 pick; rank badges appear after all reviews are spoken
- In-scene labels are drei `<Html>` (needed for CJK text); HUD elements sit at z-index 50 above them

**`components/Stage1.jsx`**
- Tab view of individual model responses
- ReactMarkdown rendering with markdown-content wrapper

**`components/Stage2.jsx`**
- **Critical Feature**: Tab view showing RAW evaluation text from each model
- De-anonymization happens CLIENT-SIDE for display (models receive anonymous labels)
- Shows "Extracted Ranking" below each evaluation so users can validate parsing
- Aggregate rankings shown with average position and vote count
- Explanatory text clarifies that boldface model names are for readability only

**`components/Stage3.jsx`**
- Final synthesized answer from chairman
- Green-tinted background (#f0fff0) to highlight conclusion (in the transcript drawer)

**Styling (`*.css`)**
- Dark chamber theme; accent #6aa8ff. The transcript drawer stays light ("paper") for readability
- UI copy is Traditional Chinese
- Global markdown styling in `index.css` with `.markdown-content` class
- 12px padding on all markdown content to prevent cluttered appearance

## Key Design Decisions

### Stage 2 Prompt Format
The Stage 2 prompt is very specific to ensure parseable output:
```
1. Evaluate each response individually first
2. Provide "FINAL RANKING:" header
3. Numbered list format: "1. Response C", "2. Response A", etc.
4. No additional text after ranking section
```

This strict format allows reliable parsing while still getting thoughtful evaluations.

### De-anonymization Strategy
- Models receive: "Response A", "Response B", etc.
- Backend creates mapping: `{"Response A": "openai/gpt-5.1", ...}`
- Frontend displays model names in **bold** for readability
- Users see explanation that original evaluation used anonymous labels
- This prevents bias while maintaining transparency

### Error Handling Philosophy
- Continue with successful responses if some models fail (graceful degradation)
- Never fail the entire request due to single model failure
- Log errors but don't expose to user unless all models fail

### UI/UX Transparency
- All raw outputs are inspectable via tabs
- Parsed rankings shown below raw text for validation
- Users can verify system's interpretation of model outputs
- This builds trust and allows debugging of edge cases

## Important Implementation Details

### Relative Imports
All backend modules use relative imports (e.g., `from .config import ...`) not absolute imports. This is critical for Python's module system to work correctly when running as `python -m backend.main`.

### Port Configuration
- Backend: 8001, also serves the built frontend
- Frontend dev server: 5173 (Vite default); `api.js` targets :8001 only in dev
- Update both `backend/config.py` and `frontend/src/api.js` if changing

### Skill
- `skill/` is the Claude Code skill (`SKILL.md` + `council` wrapper); `skill/install.sh` symlinks it to `~/.claude/skills/llm-council`
- The wrapper resolves the repo through the symlink, so the skill always runs this checkout

### Markdown Rendering
All ReactMarkdown components must be wrapped in `<div className="markdown-content">` for proper spacing. This class is defined globally in `index.css`.

### Model Configuration
Models come from the installed CLIs (Claude aliases; Codex's own model cache; Gemini default) and are chosen per run through budget tiers or explicit settings (see `config.py`). The number of seats and their perspectives are decided per question by the planner in Stage 0 unless the run fixes the seat count. The chairman also plans. Frontend shows seat ids via `shortName()` in `frontend/src/names.js`.

## Common Gotchas

1. **Module Import Errors**: Always run backend as `python -m backend.main` from project root, not from backend directory
2. **CORS Issues**: Frontend must match allowed origins in `main.py` CORS middleware
3. **Ranking Parse Failures**: If models don't follow format, fallback regex extracts any "Response X" patterns in order
4. **Stale UI after editing frontend**: the backend serves `frontend/dist`; `council ask` rebuilds when sources are newer, otherwise run `npm run build`
5. **Runs are in memory**: restarting the server mid-run loses that run (the user message stays saved)

## Future Enhancement Ideas

- Token-level streaming of each seat's answer (today a seat appears when its CLI call finishes)
- Export conversations to markdown/PDF
- Model performance analytics over time
- Custom ranking criteria (not just accuracy/insight)
- Multi-turn follow-ups to the same council

## Testing Notes

`./skill/council members` shows the detected roster. `./skill/council ask --no-gui "question"` runs a full council end to end.

## Data Flow Summary

```
User Query
    ↓
Stage 0: Planner → [seats: model + perspective, 2–20 of them]
    ↓
Stage 1: Parallel seat queries → [individual responses]
    ↓
Stage 2: Anonymize → Parallel ranking queries → [evaluations + parsed rankings]
    ↓
Aggregate Rankings Calculation → [sorted by avg position]
    ↓
Stage 3: Chairman synthesis with full context
    ↓
Return: {stage1, stage2, stage3, metadata}
    ↓
Frontend: Display with tabs + validation UI
```

The entire flow is async/parallel where possible to minimize latency.
