---
name: llm-council
description: "Convene an LLM Council: several AI models (Claude, Codex/GPT, Gemini — whichever CLIs the user is logged in to, using their subscriptions, no API keys) answer a question independently, anonymously peer-review and rank each other, and a chairman synthesizes the verdict. Opens a live web view in the browser so the user can watch the models argue. MANDATORY TRIGGERS: 'council this', 'run the council', 'ask the council', 'llm council', '讓議會討論', '開議會', '叫他們吵一架'. STRONG TRIGGERS (when there's a real tradeoff or the user wants multiple opinions): 'pressure-test this', 'get multiple perspectives', 'what would different models say', 'I can't decide between X and Y'. Do NOT trigger for simple factual lookups or tasks with one obvious answer."
---

# LLM Council

Runs the user's question through a council of AI models, live in the browser:

0. **Stage 0** — a planner reads the question and decides how many seats to open (2–20), gives each seat a question-specific perspective (domain expert, stakeholder, skeptic…), and assigns each seat a model from the pool.
1. **Stage 1** — every seat answers independently from its perspective, in parallel.
2. **Stage 2** — every seat reviews the answers anonymized as "Response A, B, C…" and ranks them.
3. **Stage 3** — the chairman reads everything and writes the final answer.

Models are local CLIs (`claude`, `codex`, `gemini`) running on the user's own logins, so there's no API key and usage counts against their subscriptions. The CLI wrapper lives next to this file: `~/.claude/skills/llm-council/council`.

## Step 1: frame the question

Council members are fresh sessions. They **can't see this conversation, the user's files, or any tools**, so the question you send must stand on its own:

- Include the context that matters: relevant facts from the conversation, excerpts of files the user referred to, constraints, numbers, and what's at stake.
- Keep it neutral. Don't add your own opinion or steer toward an answer.
- Write it in the user's language; the members will answer in that language.
- If the question is too vague to answer well, ask the user one clarifying question first, then proceed.
- The question goes to Anthropic, OpenAI, and/or Google depending on the members. If it would include secrets or sensitive personal data, check with the user first.

## Step 2: choose the council (only if the user said something about it)

Without flags, the council uses the user's default budget tier (`LLM_COUNCIL_BUDGET` in the repo's `.env`; run `council members` to see it). Never downgrade on your own to "save quota": only pick a cheaper tier or model when the user asks for it.

Budget tiers (`--budget`):

| Tier | Models | Chairman | Seats | Effort |
|---|---|---|---|---|
| `economy` | Haiku + Sonnet + Codex's fast model | Sonnet | 2 | low |
| `standard` | Opus + Sonnet + Codex's latest workhorse | Opus | auto, ≤ 6 | CLI default |
| `max` | Fable + Opus + Codex's frontier model (+ Gemini) | Fable | auto, ≤ 20 | max |

(Codex models come from the user's Codex account via `~/.codex/models_cache.json`; they depend on the user's plan, so run `council members` for the exact ids.)

Only installed CLIs are used; with a single CLI, every seat uses that provider's models.

Map what the user says to flags; explicit flags override the tier:

| User says | Flags |
|---|---|
| "用最好的" / "頂配" / "火力全開" / "我有預算" | `--budget max` |
| "額度快沒了" / "省一點" | `--budget economy` |
| "三隻都用 Fable" | `--models claude/fable --seats 3 --chairman claude/fable` |
| "只要 Claude 跟 GPT" | `--models claude/fable,codex/<model>` (use the ids from `council members`) |
| "開 4 席" / "最多 4 席" | `--seats 4` / `--max-seats 4` |
| "想深一點" / "快一點就好" | `--effort max` / `--effort low` |
| "不用開視窗" / "不要 GUI" / "直接給我結果" | `--no-gui` |
| "開畫面讓我看" / "我想看他們吵" | `--gui` |

- `--models`: comma-separated pool the seats are filled from (one model may fill several seats). `--chairman`: plans the seats and writes the verdict.
- `--seats N` fixes the size; `--max-seats N` lets the chairman pick up to N (2–20). `--effort`: low, medium, high, xhigh, max.
- At most `LLM_COUNCIL_CONCURRENCY` (default 10) calls run at once; bigger councils queue, so a 20-seat `max` council takes noticeably longer.
- `--gui` / `--no-gui` override the default (`LLM_COUNCIL_GUI` in `.env`; `council members` shows it). Without the GUI nothing opens and the frontend isn't built; the run still lives in the background server, and it can be replayed later with `council open <conversation_id>`.
- Calls per run ≈ 2 × seats + 2. Deeper effort makes each call slower: a `max` council can take 10+ minutes, so expect to use `council result <id>` after the first timeout.

## Step 3: convene the council

Pass the framed question on stdin with a quoted heredoc, so quotes and newlines survive. Run it in the foreground with the **maximum Bash timeout (600000 ms)**; a full council usually takes 2–6 minutes:

```bash
~/.claude/skills/llm-council/council ask [flags from step 2] <<'QUESTION'
<framed question>
QUESTION
```

What it does:
- Starts the local server on http://127.0.0.1:8001 if it isn't running (building the frontend the first time).
- Opens the live 3D view in the browser, unless the GUI is off. If it opened, tell the user they can watch each seat answer and review live. If it didn't, mention they can replay it with `council open <conversation_id>`.
- Logs progress to stderr and prints the verdict to stdout: the seats the planner opened (and why), the aggregate peer ranking, and the chairman's synthesis.

If the command times out, the council keeps running on the server. Use the conversation id from the first lines of output to pick it back up:

```bash
~/.claude/skills/llm-council/council result <conversation_id>
```

## Step 4: report back

The user may already be reading the live view, so don't paste the full transcript. In chat, give:

- The live view link.
- How many seats were opened and which perspectives, in one line.
- The chairman's conclusion in a few sentences.
- The peer ranking (which perspective the seats rated best), plus anything notable: a clear consensus, a sharp disagreement, or a seat that failed to respond.
- Your own short take, if you see something the council missed. Label it clearly as yours, not the council's.

## Configuration and troubleshooting

- `council members` lists the budget tiers (and which is the default), every selectable model with its relative quota cost, and the GUI default.
- In the web UI, the same choices live under the question box (budget cards 省額度 / 標準 / 頂配, or pick models, seats, effort, and chairman by hand); they're remembered in the browser.
- To override, set these in the repo's `.env`:
  `LLM_COUNCIL_BUDGET` (default tier), `LLM_COUNCIL_GUI`, `LLM_COUNCIL_MODELS="claude/opus,codex/default,gemini/default"`, `LLM_COUNCIL_CHAIRMAN`, `LLM_COUNCIL_PLANNER`, `LLM_COUNCIL_MAX_SEATS` (default 6), and `LLM_COUNCIL_CONCURRENCY` (default 10).
- If planning fails, the council falls back to one plain seat per pool model. A seat that errors or times out is skipped, and the council continues with the rest. If every seat fails, make sure the CLIs are installed and logged in (`claude`, `codex login`, `gemini`).
- Server log: `data/server.log` in the repo. Stop the background server with `council stop`.
