"""Command-line entry point used by the Claude Code skill.

    python -m backend.cli ask [question]   # question from stdin if omitted
        [--gui | --no-gui]
        [--budget economy|standard|max] [--effort low|medium|high|xhigh|max]
        [--models claude/fable,codex/<model>] [--chairman claude/fable]
        [--seats N | --max-seats N]
    python -m backend.cli result <conversation_id>
    python -m backend.cli open [conversation_id]   # latest if omitted
    python -m backend.cli members
    python -m backend.cli init [--budget economy|standard|max] [--gui | --no-gui]
    python -m backend.cli stop

`ask` starts the server if needed, opens the live 3D view in the browser
(unless --no-gui or LLM_COUNCIL_GUI=0), waits for the council to finish, and
prints the verdict as markdown. Without the GUI the frontend isn't built and no
browser opens; the run still lives in the background server, so `result` can
reattach and `open` can replay it later.

`init` saves the default budget and GUI choice to .env. Until it has run (or
LLM_COUNCIL_BUDGET is set), `ask` without --budget stops and says so, so the
first council never spends quota the user didn't choose.
"""

import argparse
import json
import os
import signal
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

import httpx

from .config import BUDGET_CONFIGURED, BUDGETS, DEFAULT_BUDGET, ENV_FILE, FRONTEND_DIST, HOST, MODEL_CATALOG, OPEN_GUI, PORT, PROJECT_ROOT, SEAT_LIMIT, MIN_SEATS, settings_for
from .providers import EFFORT_LEVELS

BASE_URL = f"http://{HOST}:{PORT}"
FRONTEND_DIR = PROJECT_ROOT / "frontend"
RUN_DIR = PROJECT_ROOT / "data"
PID_FILE = RUN_DIR / "server.pid"
LOG_FILE = RUN_DIR / "server.log"


def log(message: str):
    print(message, file=sys.stderr, flush=True)


def server_is_up() -> bool:
    try:
        return httpx.get(f"{BASE_URL}/api/health", timeout=1).status_code == 200
    except httpx.HTTPError:
        return False


def frontend_is_stale() -> bool:
    index = FRONTEND_DIST / "index.html"
    if not index.is_file():
        return True
    built_at = index.stat().st_mtime
    sources = [FRONTEND_DIR / "index.html", FRONTEND_DIR / "vite.config.js"]
    sources += [p for p in (FRONTEND_DIR / "src").rglob("*") if p.is_file()]
    return any(p.stat().st_mtime > built_at for p in sources)


def build_frontend():
    if not (FRONTEND_DIR / "node_modules").is_dir():
        log("Installing frontend dependencies...")
        subprocess.run(["npm", "install"], cwd=FRONTEND_DIR, check=True, stdout=sys.stderr)
    log("Building frontend...")
    subprocess.run(["npm", "run", "build"], cwd=FRONTEND_DIR, check=True, stdout=sys.stderr)


def ensure_server(gui: bool = True):
    """Start the server if needed. The frontend is only (re)built when a GUI will be shown."""
    if gui and frontend_is_stale():
        build_frontend()
    if server_is_up():
        return

    log(f"Starting LLM Council server on {BASE_URL} (log: {LOG_FILE})")
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    with open(LOG_FILE, "ab") as out:
        proc = subprocess.Popen(
            [sys.executable, "-m", "backend.main"],
            cwd=PROJECT_ROOT,
            stdout=out,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
    PID_FILE.write_text(str(proc.pid))

    for _ in range(60):
        if server_is_up():
            return
        if proc.poll() is not None:
            sys.exit(f"Server exited with code {proc.returncode}; see {LOG_FILE}")
        time.sleep(0.5)
    sys.exit(f"Server did not come up; see {LOG_FILE}")


def short(model: str) -> str:
    return model.split("/")[1] if "/" in model else model


def watch(conversation_id: str) -> dict:
    """Follow the live run, logging progress; return the collected results."""
    result = {"plan": None, "stage1": [], "stage2": [], "stage3": None, "metadata": {}}
    with httpx.stream("GET", f"{BASE_URL}/api/conversations/{conversation_id}/live", timeout=None) as response:
        if response.status_code == 404:
            return None
        response.raise_for_status()
        for line in response.iter_lines():
            if not line.startswith("data: "):
                continue
            event = json.loads(line[6:])
            kind = event["type"]
            if kind == "stage0_start":
                log(f"Stage 0: {event['members'][0]} is deciding the seats")
            elif kind == "stage0_complete":
                result["plan"] = event["data"]
                log(f"  {len(event['data']['seats'])} seats: {event['data']['reason']}")
                for seat in event["data"]["seats"]:
                    log(f"    - {seat['id']}")
            elif kind == "stage1_start":
                log(f"Stage 1: asking {', '.join(event['members'])}")
            elif kind == "stage1_response":
                log(f"  {event['data']['model']} answered")
            elif kind == "stage1_complete":
                result["stage1"] = event["data"]
            elif kind == "stage2_start":
                log("Stage 2: anonymized peer review")
            elif kind == "stage2_ranking":
                log(f"  {event['data']['model']} ranked the responses")
            elif kind == "stage2_complete":
                result["stage2"] = event["data"]
                result["metadata"] = event["metadata"]
            elif kind == "stage3_start":
                log(f"Stage 3: chairman {event['members'][0]} is synthesizing")
            elif kind == "stage3_complete":
                result["stage3"] = event["data"]
            elif kind == "error":
                sys.exit(f"Council failed: {event['message']}")
    return result


def stored_result(conversation_id: str) -> dict:
    response = httpx.get(f"{BASE_URL}/api/conversations/{conversation_id}", timeout=10)
    response.raise_for_status()
    assistant = [m for m in response.json()["messages"] if m["role"] == "assistant"]
    if not assistant:
        sys.exit("This conversation has no council verdict yet.")
    return assistant[-1]


def print_verdict(result: dict, conversation_id: str, gui: bool = True):
    metadata = result.get("metadata") or {}
    ranking = metadata.get("aggregate_rankings") or []
    stage3 = result.get("stage3") or {}

    plan = result.get("plan") or metadata.get("plan") or {}
    answered = {r["model"] for r in result.get("stage1", [])}

    if gui:
        where = f"Live view: {BASE_URL}/?c={conversation_id}"
    else:
        where = f"Conversation {conversation_id} (replay in the 3D view: `council open {conversation_id}`)"
    print(f"# LLM Council verdict\n\n{where}\n")
    if plan:
        print(f"## Council ({len(plan['seats'])} seats, planned by {plan['planner']})\n")
        if plan.get("reason"):
            print(f"{plan['reason']}\n")
        for seat in plan["seats"]:
            status = "" if seat["id"] in answered else " (no response)"
            brief = f": {seat['brief']}" if seat.get("brief") else ""
            print(f"- **{seat['id']}**{brief}{status}")
        print()
    print(f"Chairman: {stage3.get('model', '?')}\n")
    if ranking:
        print("## Peer ranking (lower average is better)\n")
        for i, entry in enumerate(ranking, start=1):
            print(f"{i}. {entry['model']}: avg {entry['average_rank']:.2f} ({entry['rankings_count']} votes)")
        print()
    print("## Chairman's synthesis\n")
    print(stage3.get("response", "(no synthesis)"))


NOT_CONFIGURED = 3  # exit code: `ask` ran before `init`


def tier_line(key: str) -> str:
    tier = BUDGETS[key]
    seats = f"{tier['seats']} seats" if tier["seats"] else f"auto, up to {tier['max_seats']} seats"
    return f"{key}: {', '.join(tier['models'])} · chair {tier['chairman']} · {seats} · effort {tier['effort'] or 'CLI default'}"


def write_env(updates: dict):
    """Set keys in .env, keeping every other line (and comment) as it was."""
    lines = ENV_FILE.read_text().splitlines() if ENV_FILE.exists() else []
    done = set()
    for i, line in enumerate(lines):
        key = line.split("=", 1)[0].strip()
        if key in updates and not line.lstrip().startswith("#"):
            lines[i] = f"{key}={updates[key]}"
            done.add(key)
    lines += [f"{key}={value}" for key, value in updates.items() if key not in done]
    ENV_FILE.write_text("\n".join(lines) + "\n")


def prompt_choice(question: str, choices: list, default: str) -> str:
    while True:
        answer = input(f"{question} [{'/'.join(choices)}] (default {default}): ").strip().lower()
        if not answer:
            return default
        if answer in choices:
            return answer
        print(f"Please answer one of: {', '.join(choices)}", file=sys.stderr)


def init(budget, gui) -> tuple:
    """Fill in whatever wasn't given (asking on a terminal), save it to .env, and return it."""
    if budget is None or gui is None:
        if not sys.stdin.isatty():
            sys.exit("Pass the choices as flags: council init --budget economy|standard|max --gui|--no-gui")
        if not BUDGETS:
            sys.exit("No AI CLI found (claude, codex, gemini). Install and log in to one first.")
    if budget is None:
        print("Budget tiers (each council makes about 2 × seats + 2 calls on your subscriptions):", file=sys.stderr)
        for key in BUDGETS:
            print(f"  {tier_line(key)}", file=sys.stderr)
        budget = prompt_choice("Default budget", list(BUDGETS), DEFAULT_BUDGET)
    if gui is None:
        gui = prompt_choice("Open the live 3D view in the browser for each council?", ["y", "n"],
                            "y" if OPEN_GUI else "n") == "y"
    write_env({"LLM_COUNCIL_BUDGET": budget, "LLM_COUNCIL_GUI": "1" if gui else "0"})
    log(f"Saved to {ENV_FILE}: budget {budget}, GUI {'on' if gui else 'off'}.")
    if server_is_up():
        log("Restart the server (`council stop`) for the web UI to pick up the new default.")
    return budget, gui


def cmd_init(args):
    init(args.budget, args.gui)


def cmd_ask(args):
    gui = OPEN_GUI if args.gui is None else args.gui
    if not BUDGET_CONFIGURED and args.budget is None:
        if not (args.question and sys.stdin.isatty()):
            log("LLM Council isn't set up yet: no default budget has been chosen.")
            log("Ask the user which budget (economy / standard / max) and whether to open the 3D view, then run:")
            log("  council init --budget <tier> --gui|--no-gui")
            log("Or pass --budget to this run only. Tiers:")
            for key in BUDGETS:
                log(f"  {tier_line(key)}")
            sys.exit(NOT_CONFIGURED)
        args.budget, chosen_gui = init(None, args.gui)
        gui = chosen_gui if args.gui is None else args.gui

    question = " ".join(args.question).strip() if args.question else sys.stdin.read().strip()
    if not question:
        sys.exit("No question given (pass it as an argument or on stdin).")

    # Validate before creating anything, so bad settings don't leave an empty conversation behind.
    try:
        settings_for(args.budget, args.models.split(",") if args.models else None,
                     args.chairman, args.seats, args.max_seats, args.effort)
    except ValueError as e:
        sys.exit(f"Invalid council settings: {e}")

    ensure_server(gui)
    conversation = httpx.post(f"{BASE_URL}/api/conversations", json={}, timeout=10).json()
    conversation_id = conversation["id"]
    body = {
        "content": question,
        "budget": args.budget,
        "effort": args.effort,
        "models": args.models.split(",") if args.models else None,
        "chairman": args.chairman,
        "seats": args.seats,
        "max_seats": args.max_seats,
    }
    response = httpx.post(f"{BASE_URL}/api/conversations/{conversation_id}/runs", json=body, timeout=10)
    if response.status_code == 400:
        sys.exit(f"Invalid council settings: {response.json()['detail']}")
    response.raise_for_status()

    log(f"Conversation {conversation_id} · budget {args.budget or DEFAULT_BUDGET} · GUI {'on' if gui else 'off'}")
    if gui:
        url = f"{BASE_URL}/?c={conversation_id}"
        log(f"Live view: {url}")
        webbrowser.open(url)

    result = watch(conversation_id)
    print_verdict(result, conversation_id, gui)


def cmd_result(args):
    ensure_server(gui=False)
    result = watch(args.conversation_id) or stored_result(args.conversation_id)
    print_verdict(result, args.conversation_id, gui=False)


def cmd_open(args):
    ensure_server(gui=True)
    conversation_id = args.conversation_id
    if not conversation_id:
        conversations = httpx.get(f"{BASE_URL}/api/conversations", timeout=10).json()
        if not conversations:
            sys.exit("No conversations yet.")
        conversation_id = conversations[0]["id"]
    url = f"{BASE_URL}/?c={conversation_id}"
    webbrowser.open(url)
    print(f"Opened {url}")


def cmd_members(args):
    print("Budget tiers (--budget):")
    for key in BUDGETS:
        mark = "  (default)" if key == DEFAULT_BUDGET else ""
        print(f"  {tier_line(key)}{mark}")
    if not BUDGET_CONFIGURED:
        print("  No default chosen yet; run `council init`.")
    print("\nSelectable models (--models / --chairman):")
    for model in MODEL_CATALOG:
        cost = f"  [{model['cost']}]" if model["cost"] else ""
        print(f"  {model['id']}{cost}")
    print(f"\nSeats: {MIN_SEATS}-{SEAT_LIMIT} (--seats / --max-seats). Effort: {', '.join(EFFORT_LEVELS)} (--effort).")
    print(f"GUI: {'opens the 3D view' if OPEN_GUI else 'off'} by default (--gui / --no-gui; LLM_COUNCIL_GUI in .env).")


def cmd_stop(args):
    if not PID_FILE.exists():
        print("No server started by the CLI.")
        return
    pid = int(PID_FILE.read_text())
    try:
        os.killpg(pid, signal.SIGTERM)
        print(f"Stopped server (pid {pid}).")
    except ProcessLookupError:
        print("Server was not running.")
    PID_FILE.unlink()


ASK_EPILOG = """\
Tiers set models, chairman, seats, and effort in one go; explicit flags override them.
Run `council members` for the exact models in each tier on this machine.
  economy   lightest models, 2 seats, low effort
  standard  workhorse models, planner picks up to 6 seats, CLI default effort
  max       strongest models (+ Gemini), planner picks up to 20 seats, max effort
A council makes about 2 × seats + 2 calls. Deeper effort is slower: a 20-seat max
council can take 10+ minutes; if `ask` times out, `council result <id>` reattaches.

What the user says -> flags:
  "use the best" / 頂配 / 火力全開         --budget max
  "low on quota" / 省一點                  --budget economy
  "three Fable seats"                      --models claude/fable --seats 3 --chairman claude/fable
  "only Claude and GPT"                    --models claude/<m>,codex/<m>  (ids from `council members`)
  "4 seats" / "at most 4 seats"            --seats 4 / --max-seats 4
  "think harder" / "just be quick"         --effort max / --effort low
  "no window" / 不要 GUI                   --no-gui
  "let me watch" / 開畫面                  --gui
Never pick a cheaper tier or model unless the user asks for it.
"""


def main():
    parser = argparse.ArgumentParser(prog="council", description="Run the LLM Council")
    sub = parser.add_subparsers(dest="command", required=True)

    ask = sub.add_parser("ask", help="Ask the council a question", epilog=ASK_EPILOG,
                         formatter_class=argparse.RawDescriptionHelpFormatter)
    ask.add_argument("question", nargs="*", help="The question (read from stdin if omitted)")
    gui = ask.add_mutually_exclusive_group()
    gui.add_argument("--gui", dest="gui", action="store_true", default=None,
                     help="Open the live 3D view in the browser")
    gui.add_argument("--no-gui", "--no-open", dest="gui", action="store_false",
                     help=f"Run without opening the browser (default: {'GUI' if OPEN_GUI else 'no GUI'}, set by LLM_COUNCIL_GUI)")
    ask.add_argument("--budget", choices=list(BUDGETS), help=f"Budget tier (default: {DEFAULT_BUDGET}); other flags override it")
    ask.add_argument("--effort", choices=list(EFFORT_LEVELS), help="Reasoning effort for every seat, the planner, and the chairman")
    ask.add_argument("--models", help="Comma-separated models the seats are filled from, e.g. claude/fable")
    ask.add_argument("--chairman", help="Model that plans the seats and writes the verdict")
    size = ask.add_mutually_exclusive_group()
    size.add_argument("--seats", type=int, help="Open exactly this many seats")
    size.add_argument("--max-seats", type=int, help="Let the planner open up to this many seats")
    ask.set_defaults(func=cmd_ask)

    result = sub.add_parser("result", help="Wait for / print the verdict of a conversation")
    result.add_argument("conversation_id")
    result.set_defaults(func=cmd_result)

    open_ = sub.add_parser("open", help="Open a conversation in the 3D view (latest if omitted)")
    open_.add_argument("conversation_id", nargs="?")
    open_.set_defaults(func=cmd_open)

    sub.add_parser("members", help="Show the detected council").set_defaults(func=cmd_members)

    init_ = sub.add_parser("init", help="Choose the default budget and GUI (saved to .env); asks for what's missing")
    init_.add_argument("--budget", choices=list(BUDGETS))
    init_gui = init_.add_mutually_exclusive_group()
    init_gui.add_argument("--gui", dest="gui", action="store_true", default=None)
    init_gui.add_argument("--no-gui", dest="gui", action="store_false")
    init_.set_defaults(func=cmd_init)
    sub.add_parser("stop", help="Stop the background server").set_defaults(func=cmd_stop)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
