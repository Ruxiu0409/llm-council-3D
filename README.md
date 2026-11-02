# LLM Council 3D

https://github.com/user-attachments/assets/2d7611c4-07a4-4ea2-8040-e9fbaff000bd

<sub>Every frame is real: the Claude Code session and the 3D chamber's replay of the 7-seat council it ran (the run itself was in Chinese).</sub>

Instead of asking one model, put the question to a council. Several AI models answer independently, review and rank each other's answers anonymously, and a chairman model writes the final verdict. A local 3D view lets you watch the seats think, speak, and vote.

This is a fork of [karpathy/llm-council](https://github.com/karpathy/llm-council). The upstream app sent queries through OpenRouter with an API key. This fork instead runs the AI CLIs you're already logged in to (`claude`, `codex`, `gemini`), so **the council runs on your subscriptions, with no API key**. It ships as a Claude Code skill.

## How a council runs

0. **Plan.** The chairman reads the question and decides how many seats to open (2–20), what perspective each seat argues from (a domain expert, a stakeholder, a skeptic…), and which model fills each seat.
1. **Answer.** Every seat answers from its perspective, in parallel.
2. **Review.** Every seat reads the answers, anonymized as "Response A, B, C…", and ranks them. Anonymity keeps models from favoring their own answer or provider.
3. **Verdict.** The chairman reads every answer and review and writes the final answer.

## Requirements

- At least one of these CLIs, installed and logged in:
  - [Claude Code](https://docs.claude.com/en/docs/claude-code) (`claude`)
  - [Codex CLI](https://github.com/openai/codex) (`codex login`)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`gemini`)

  One CLI is enough: the council can fill every seat with different perspectives from the same model.
- [uv](https://docs.astral.sh/uv/) (Python 3.10+) and Node.js (for the frontend).

## Install

```bash
git clone https://github.com/Ruxiu0409/llm-council-3D.git
cd llm-council-3D
uv sync
(cd frontend && npm install)
./skill/install.sh   # symlinks skill/ to ~/.claude/skills/llm-council
```

`install.sh` asks once for your default budget tier and whether to open the 3D view (saved to `.env`; change it anytime with `./skill/council init`), then prints the council it detected. Until a budget is chosen, councils from the skill stop and ask instead of spending quota.

## Use

**From Claude Code.** Say "council this: …", "ask the council", or 「開議會」. You can add a budget too ("use the best models", "I'm low on quota, keep it cheap"). Claude frames the question so it stands on its own, the 3D view opens in your browser, and the verdict comes back into the chat. See [`skill/SKILL.md`](skill/SKILL.md) for everything the skill understands.

**From the terminal:**

```bash
./skill/council ask "Should we rewrite the backend in Go?"
./skill/council ask --budget economy --no-gui "Tabs or spaces?"
./skill/council members      # detected models, budget tiers, defaults
./skill/council init         # choose the default budget and GUI again
./skill/council open         # replay the latest council in the 3D view
./skill/council stop         # stop the background server
```

**In the browser.** Go to http://127.0.0.1:8001 while the server is running. The panel under the question box sets the budget, models, seats, reasoning effort, and chairman for each question.

The server only listens on 127.0.0.1, since it drives your logged-in CLIs.

## Choosing the council

A budget tier sets models, chairman, seats, and reasoning effort in one go. Explicit flags override the tier.

| Tier | Models | Seats | Effort |
|---|---|---|---|
| `economy` | the lightest models (e.g. Haiku, Sonnet, Codex's fast model) | 2 | low |
| `standard` | workhorse models (e.g. Opus, Sonnet, Codex's latest) | auto, up to 6 | CLI default |
| `max` | the strongest models (e.g. Fable, Opus, Codex's frontier model, Gemini) | auto, up to 20 | max |

Only installed CLIs are used. Codex models are read from your own Codex account's model list, so the exact ids depend on your plan; `council members` shows them.

| Flag | Meaning |
|---|---|
| `--budget economy\|standard\|max` | start from a tier |
| `--models claude/opus,codex/<model>` | pool the seats are filled from (one model can fill several seats) |
| `--chairman claude/opus` | who plans the seats and writes the verdict |
| `--seats N` / `--max-seats N` | fix the size, or cap the planner (2–20) |
| `--effort low\|medium\|high\|xhigh\|max` | reasoning effort for every call |
| `--gui` / `--no-gui` | open the 3D view or not |

A council makes about 2 × seats + 2 calls, all billed to your subscriptions. Bigger councils and deeper effort take longer: a 20-seat `max` council can run past 10 minutes.

## Configuration

Defaults can be set in a `.env` file in the repo root:

```bash
LLM_COUNCIL_BUDGET=economy      # default tier: economy | standard | max (`council init` sets it)
LLM_COUNCIL_GUI=1               # open the 3D view by default (0 to turn off)
LLM_COUNCIL_MODELS="claude/opus,claude/sonnet,codex/default"   # override the auto-detected pool
LLM_COUNCIL_CHAIRMAN=claude/opus
LLM_COUNCIL_PLANNER=claude/opus # defaults to the chairman
LLM_COUNCIL_MAX_SEATS=6         # auto-seat ceiling outside the tiers
LLM_COUNCIL_CONCURRENCY=10      # CLI calls running at once; the rest queue
```

Conversations are saved as JSON in `data/conversations/`, and the server log is at `data/server.log`.

## Development

```bash
uv run python -m backend.main   # API + built frontend on http://127.0.0.1:8001
cd frontend && npm run dev      # Vite dev server on http://localhost:5173 (talks to :8001)
```

`council ask` rebuilds `frontend/dist` automatically when the sources are newer; otherwise run `npm run build`. [`CLAUDE.md`](CLAUDE.md) has the architecture notes.

## Tech stack

- **Backend:** FastAPI, with the models run as headless CLI subprocesses (`claude -p`, `codex exec`, `gemini`)
- **Frontend:** React + Vite, three.js through react-three-fiber/drei, react-markdown
- **Storage:** JSON files in `data/conversations/`

## Credits and license

The original idea, the three-stage flow, and the anonymized peer-review design come from [Andrej Karpathy's llm-council](https://github.com/karpathy/llm-council). Parts of `backend/council.py`, `backend/storage.py`, `backend/main.py`, and the frontend's `Stage1`–`Stage3`, `Sidebar`, and `App` still build on that code.

The upstream project was published without a license, so its parts remain under the original author's rights. Everything this fork adds (the CLI providers and budget tiers, background runs, the Claude Code skill, the 3D chamber, and the other changes) is released under the MIT License; see [`LICENSE`](LICENSE).
