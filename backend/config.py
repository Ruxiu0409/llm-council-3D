"""Configuration for the LLM Council.

Council seats are filled from a pool of local AI CLIs logged in with the
user's subscription (no API keys). The pool is auto-detected from what's
installed. For each question a planner decides how many seats to open, what
perspective each seat takes, and which pool model fills it.

Each run may override the pool, chairman, and seat count (see `settings_for`),
so users can trade quota for firepower per question. Defaults come from the
environment (or a `.env` file):

    LLM_COUNCIL_BUDGET=max                 # economy | standard | max (default: economy; `council init` sets it)
    LLM_COUNCIL_GUI=0                      # don't open the 3D view by default (default: 1)
    LLM_COUNCIL_MODELS="claude/opus,claude/sonnet,codex/default,gemini/default"
    LLM_COUNCIL_CHAIRMAN="claude/opus"
    LLM_COUNCIL_PLANNER="claude/opus"     # defaults to the chairman
    LLM_COUNCIL_MAX_SEATS=6                # standard tier's auto-seat ceiling
    LLM_COUNCIL_CONCURRENCY=10             # CLI calls running at once; the rest queue

A budget tier picks models, chairman, seat count, and reasoning effort in one
go; explicit settings in a request override the tier's.
"""

import os
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from dotenv import load_dotenv

from .providers import EFFORT_LEVELS, Member, available_clis, codex_default_model, codex_models, parse_member

PROJECT_ROOT = Path(__file__).resolve().parent.parent

ENV_FILE = PROJECT_ROOT / ".env"
load_dotenv(ENV_FILE)


# Models offered in the UI per CLI: (model, label, cost hint). Cost is relative quota use.
_CLAUDE_MODELS = [
    ("fable", "Fable", "最強，最耗額度"),
    ("opus", "Opus", "很強，耗額度"),
    ("sonnet", "Sonnet", "均衡"),
    ("haiku", "Haiku", "最省額度"),
]

MIN_SEATS = 2
SEAT_LIMIT = 20  # hard cap for per-run requests (the max tier lets the planner go this high)


@dataclass(frozen=True)
class CouncilSettings:
    """Who may sit on one council run, who chairs it, and how many seats it may open."""
    pool: Tuple[Member, ...]
    chairman: Member
    planner: Member
    min_seats: int
    max_seats: int
    effort: Optional[str] = None  # None: each CLI's default

    def describe(self) -> Dict[str, Any]:
        return {
            "models": [m.id for m in self.pool],
            "chairman": self.chairman.id,
            "planner": self.planner.id,
            "seats": {"min": self.min_seats, "max": self.max_seats},
            "effort": self.effort,
        }


def _codex_cost(model: Dict[str, Any]) -> str:
    """A short quota/strength hint from Codex's own model description."""
    slug, desc = model["slug"], model["description"].lower()
    if "older" in desc or "previous" in desc:
        return "舊一代"
    if "frontier" in desc or "most demanding" in desc:
        return "最強，最耗額度"
    if "fast" in desc or "affordable" in desc or "luna" in slug:
        return "快、省額度"
    if "latest" in desc:
        return "最新主力"
    return ""


def _codex_pick(kind: str) -> Optional[str]:
    """Best Codex model for a role: 'top' (frontier), 'main' (latest workhorse), 'lean' (fast/cheap)."""
    models = codex_models()
    want = {"top": "最強，最耗額度", "main": "最新主力", "lean": "快、省額度"}[kind]
    match = next((m for m in models if _codex_cost(m) == want), None)
    return f"codex/{match['slug']}" if match else None


def _catalog(clis: List[str]) -> List[Dict[str, str]]:
    """Every model the user can pick, given which CLIs are installed."""
    catalog = []
    if "claude" in clis:
        catalog += [
            {"id": f"claude/{model}", "label": f"Claude {label}", "cost": cost}
            for model, label, cost in _CLAUDE_MODELS
        ]
    if "codex" in clis:
        models = codex_models()
        if models:
            catalog += [
                {"id": f"codex/{m['slug']}", "label": f"Codex {m['name']}", "cost": _codex_cost(m), "description": m["description"]}
                for m in models
            ]
        else:
            model = codex_default_model()
            catalog.append({"id": f"codex/{model}", "label": f"Codex {model}", "cost": "依 Codex 設定"})
    if "gemini" in clis:
        catalog.append({"id": "gemini/default", "label": "Gemini", "cost": "依 Gemini 設定"})
    # Anything configured explicitly is selectable too.
    for spec in os.getenv("LLM_COUNCIL_MODELS", "").split(","):
        spec = spec.strip()
        if spec and spec.split("/")[0] in clis and spec not in {c["id"] for c in catalog}:
            catalog.append({"id": spec, "label": spec, "cost": ""})
    return catalog


def _auto_pool(clis: List[str]) -> List[str]:
    specs = []
    if "claude" in clis:
        specs += ["claude/opus", "claude/sonnet"]
    if "codex" in clis:
        specs.append(_codex_pick("main") or f"codex/{codex_default_model()}")
    if "gemini" in clis:
        specs.append("gemini/default")
    return specs


def _load_defaults() -> Tuple[List[Dict[str, str]], Optional[CouncilSettings], Optional[Member]]:
    clis = available_clis()
    pool_env = os.getenv("LLM_COUNCIL_MODELS")
    specs = pool_env.split(",") if pool_env else _auto_pool(clis)
    pool = tuple(parse_member(s) for s in specs if s.strip())
    if not pool:
        return _catalog(clis), None, None

    chairman_env = os.getenv("LLM_COUNCIL_CHAIRMAN")
    if chairman_env:
        chairman = parse_member(chairman_env)
    elif "claude" in clis:
        chairman = parse_member("claude/opus")
    else:
        chairman = pool[0]

    planner_env = os.getenv("LLM_COUNCIL_PLANNER")
    planner = parse_member(planner_env) if planner_env else chairman
    max_seats = min(SEAT_LIMIT, max(MIN_SEATS, int(os.getenv("LLM_COUNCIL_MAX_SEATS", "6"))))

    # Titles are cosmetic, so use the cheapest model available.
    title_model = parse_member("claude/haiku") if "claude" in clis else chairman
    defaults = CouncilSettings(pool, chairman, planner, MIN_SEATS, max_seats)
    return _catalog(clis), defaults, title_model


MODEL_CATALOG, DEFAULT_SETTINGS, TITLE_MODEL = _load_defaults()


def _budgets() -> Dict[str, Dict[str, Any]]:
    """
    Budget tiers as request fields, built from the models actually installed.
    Each lists preferred models in order and keeps the ones available.
    """
    if DEFAULT_SETTINGS is None:
        return {}
    have = [m["id"] for m in MODEL_CATALOG]
    gemini = [i for i in have if i.startswith("gemini/")]

    def pick(*ids):
        return [i for i in ids if i and i in have]

    defaults = DEFAULT_SETTINGS.describe()
    economy_models = pick("claude/haiku", "claude/sonnet", _codex_pick("lean")) or defaults["models"]
    max_models = pick("claude/fable", "claude/opus", _codex_pick("top")) + gemini or defaults["models"]
    return {
        "economy": {
            "label": "省額度",
            "hint": "小模型、2 席、淺思考",
            "models": economy_models,
            "chairman": (pick("claude/sonnet") or economy_models)[0],
            "seats": 2,
            "max_seats": None,
            "effort": "low",
        },
        "standard": {
            "label": "標準",
            "hint": "預設組合",
            "models": defaults["models"],
            "chairman": defaults["chairman"],
            "seats": None,
            "max_seats": defaults["seats"]["max"],
            "effort": None,
        },
        "max": {
            "label": "頂配",
            "hint": "最強模型、最多席次、最深思考",
            "models": max_models,
            "chairman": (pick("claude/fable", "claude/opus") or max_models)[0],
            "seats": None,
            "max_seats": SEAT_LIMIT,
            "effort": "max",
        },
    }


BUDGETS = _budgets()
# The cheapest tier unless the user picked one (`council init` writes it to .env),
# so a fresh install never burns quota the user didn't choose to spend.
BUDGET_CONFIGURED = "LLM_COUNCIL_BUDGET" in os.environ
DEFAULT_BUDGET = os.getenv("LLM_COUNCIL_BUDGET", "economy")
if DEFAULT_BUDGET not in BUDGETS:
    DEFAULT_BUDGET = "economy"


def settings_for(
    budget: Optional[str] = None,
    models: Optional[List[str]] = None,
    chairman: Optional[str] = None,
    seats: Optional[int] = None,
    max_seats: Optional[int] = None,
    effort: Optional[str] = None,
) -> CouncilSettings:
    """
    Per-run settings: start from a budget tier (DEFAULT_BUDGET if none is given),
    then apply any explicit choices on top.

    `seats` fixes the council size; `max_seats` lets the planner choose up to it.
    When a chairman is chosen, it also does the planning. Raises ValueError on bad input.
    """
    if DEFAULT_SETTINGS is None:
        raise ValueError("No council models found. Install and log in to the claude, codex, or gemini CLI.")
    budget = budget or DEFAULT_BUDGET
    if budget not in BUDGETS:
        raise ValueError(f"Unknown budget '{budget}' (expected one of {', '.join(BUDGETS)})")
    tier = BUDGETS[budget]
    models = models or tier["models"]
    chairman = chairman or tier["chairman"]
    if seats is None and max_seats is None:
        seats, max_seats = tier["seats"], tier["max_seats"]
    effort = effort or tier["effort"]
    if effort is not None and effort not in EFFORT_LEVELS:
        raise ValueError(f"effort must be one of {', '.join(EFFORT_LEVELS)}")

    clis = available_clis()
    settings = replace(DEFAULT_SETTINGS, effort=effort)

    def member(spec: str) -> Member:
        m = parse_member(spec)
        if m.cli not in clis:
            raise ValueError(f"The {m.cli} CLI isn't installed")
        return m

    if models:
        pool = tuple(dict.fromkeys(member(s) for s in models))
        settings = replace(settings, pool=pool)
    if chairman:
        chair = member(chairman)
        settings = replace(settings, chairman=chair, planner=chair)
    if seats is not None:
        if not MIN_SEATS <= seats <= SEAT_LIMIT:
            raise ValueError(f"seats must be between {MIN_SEATS} and {SEAT_LIMIT}")
        settings = replace(settings, min_seats=seats, max_seats=seats)
    elif max_seats is not None:
        if not MIN_SEATS <= max_seats <= SEAT_LIMIT:
            raise ValueError(f"max_seats must be between {MIN_SEATS} and {SEAT_LIMIT}")
        settings = replace(settings, min_seats=MIN_SEATS, max_seats=max_seats)
    return settings


# Data directory for conversation storage
DATA_DIR = str(PROJECT_ROOT / "data" / "conversations")

# Whether `council ask` opens the live 3D view by default (--gui / --no-gui override it)
OPEN_GUI = os.getenv("LLM_COUNCIL_GUI", "1").strip().lower() not in ("0", "false", "no", "off")

# Server
HOST = "127.0.0.1"
PORT = 8001
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"
