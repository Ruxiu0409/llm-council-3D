---
name: llm-council
description: "Convene an LLM Council: several AI CLIs the user is logged in to (Claude, Codex, Gemini) answer independently, anonymously rank each other, and a chairman writes the verdict, with an optional live 3D view. Triggers: 'council this', 'ask the council', 'llm council', '開議會', '讓議會討論', '叫他們吵一架', or when the user wants several models' opinions on a real tradeoff. Not for simple lookups."
---

# LLM Council

Members are fresh CLI sessions on the user's subscriptions. They **can't see this conversation, files, or tools**. Wrapper: `~/.claude/skills/llm-council/council`.

## 1. Frame the question

Make it self-contained: include the facts, file excerpts, constraints, and stakes that matter. Keep it neutral and in the user's language. If it's too vague, ask the user one clarifying question first. It goes to Anthropic / OpenAI / Google, so check with the user before including secrets or sensitive personal data.

## 2. Run it

The user's defaults (budget tier, GUI) are already saved, so don't look them up. Add flags only when the user asked for something (a tier, specific models, seat count, effort, GUI or no GUI); for the mapping, run `council ask --help`. Never pick a cheaper tier or model on your own.

Use the maximum Bash timeout (600000 ms) and pass the question on stdin:

```bash
~/.claude/skills/llm-council/council ask [flags] <<'QUESTION'
<framed question>
QUESTION
```

- **Exit code 3 = not set up yet.** Ask the user which budget (`economy`: cheapest, 2 seats / `standard`: up to 6 seats / `max`: strongest models, up to 20 seats) and whether to open the 3D view. Then run `council init --budget <tier> --gui|--no-gui` and the `ask` again.
- **Timeout:** the council keeps running. Run `council result <conversation_id>` with the id from the first line of output.

## 3. Report back

Don't paste the transcript. Give: the live view link (or `council open <id>` if the GUI was off), the seats and perspectives in one line, the chairman's conclusion in a few sentences, and the peer ranking plus anything notable (consensus, sharp disagreement, a failed seat). Add your own short take only if you see something the council missed, labeled as yours.

Other commands: `council members` (roster and tiers), `council open [id]`, `council stop`. Log: `data/server.log` in the repo.
