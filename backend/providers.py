"""Council members backed by locally logged-in AI CLIs.

Each member is answered by shelling out to a CLI (claude, codex, gemini) in
headless mode, so it runs on the user's subscription login instead of an API key.
"""

import asyncio
import json
import os
import re
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Awaitable, Callable, Dict, List, Optional, Tuple

SUPPORTED_CLIS = ("claude", "codex", "gemini")

# Reasoning effort levels shared by the Claude and Codex CLIs. (Codex also has
# "ultra", which adds automatic task delegation; that's for agentic coding, not
# for a single-turn council answer, so it isn't offered.)
EFFORT_LEVELS = ("low", "medium", "high", "xhigh", "max")

# How many CLI calls may run at once. Big councils (up to 20 seats) queue past
# this instead of hitting subscription rate limits or spawning 20 CLIs at once.
MAX_CONCURRENT = max(1, int(os.getenv("LLM_COUNCIL_CONCURRENCY", "10")))
_slots: Optional[asyncio.Semaphore] = None


def _concurrency() -> asyncio.Semaphore:
    global _slots
    if _slots is None:
        _slots = asyncio.Semaphore(MAX_CONCURRENT)
    return _slots

# Deep thinking takes longer; give it room before declaring a seat dead.
_TIMEOUTS = {"xhigh": 1200.0, "max": 1500.0}

# Run CLIs from an empty directory so they don't pick up project instructions
# (CLAUDE.md, AGENTS.md, ...) from wherever the server was started.
_WORKDIR = tempfile.mkdtemp(prefix="llm-council-")


@dataclass(frozen=True)
class Member:
    """A model reachable through a CLI, e.g. id "claude/opus"."""
    id: str
    cli: str
    model: Optional[str] = None


def parse_member(spec: str) -> Member:
    """Parse "cli/model" (model may be "default")."""
    cli, _, model = spec.strip().partition("/")
    if cli not in SUPPORTED_CLIS:
        raise ValueError(f"Unsupported CLI '{cli}' in '{spec}' (expected one of {SUPPORTED_CLIS})")
    return Member(id=spec.strip(), cli=cli, model=None if model in ("", "default") else model)


def available_clis() -> List[str]:
    return [cli for cli in SUPPORTED_CLIS if shutil.which(cli)]


def _codex_home() -> Path:
    return Path(os.getenv("CODEX_HOME", Path.home() / ".codex"))


def codex_default_model() -> str:
    """Read the default model from ~/.codex/config.toml."""
    try:
        match = re.search(r'^model\s*=\s*"([^"]+)"', (_codex_home() / "config.toml").read_text(), re.MULTILINE)
    except OSError:
        return "default"
    return match.group(1) if match else "default"


def codex_models() -> List[Dict]:
    """
    The models the user's Codex account offers, from the CLI's own cache
    (~/.codex/models_cache.json, refreshed by Codex itself). Visible models
    only, in Codex's priority order. Empty if the cache is missing.
    """
    try:
        data = json.loads((_codex_home() / "models_cache.json").read_text())
    except (OSError, ValueError):
        return []
    models = [m for m in data.get("models", []) if m.get("visibility") == "list" and m.get("slug")]
    models.sort(key=lambda m: m.get("priority", 999))
    return [
        {
            "slug": m["slug"],
            "name": m.get("display_name") or m["slug"],
            "description": m.get("description", ""),
            "efforts": [
                lvl["effort"] for lvl in m.get("supported_reasoning_levels", [])
                if isinstance(lvl, dict) and lvl.get("effort")
            ],
        }
        for m in models
    ]


def _codex_effort(model: Optional[str], effort: str) -> str:
    """Clamp an effort level to what this Codex model supports."""
    supported = next((m["efforts"] for m in codex_models() if m["slug"] == model), None)
    if not supported or effort in supported:
        return effort
    order = list(EFFORT_LEVELS)
    candidates = [e for e in supported if e in order and order.index(e) <= order.index(effort)]
    return candidates[-1] if candidates else effort


def _command(member: Member, effort: Optional[str] = None) -> List[str]:
    if member.cli == "claude":
        cmd = [
            "claude", "-p",
            "--tools", "",
            "--no-session-persistence",
            "--setting-sources", "",
            "--strict-mcp-config",
        ]
        if member.model:
            cmd += ["--model", member.model]
        if effort:
            cmd += ["--effort", effort]
    elif member.cli == "codex":
        cmd = [
            "codex", "exec",
            "--skip-git-repo-check",
            "--ephemeral",
            "--sandbox", "read-only",
            "--color", "never",
        ]
        if member.model:
            cmd += ["--model", member.model]
        if effort:
            cmd += ["-c", f'model_reasoning_effort="{_codex_effort(member.model, effort)}"']
        cmd.append("-")
    else:
        cmd = ["gemini"]
        if member.model:
            cmd += ["--model", member.model]
    return cmd


async def query_member(
    member: Member,
    prompt: str,
    timeout: Optional[float] = None,
    effort: Optional[str] = None,
) -> Optional[str]:
    """
    Ask one council member a single-turn question.

    `effort` is the reasoning effort (see EFFORT_LEVELS); None uses the CLI's default.
    The prompt is sent over stdin to avoid argument length limits.
    Returns the response text, or None on failure.
    """
    if timeout is None:
        timeout = _TIMEOUTS.get(effort, 600.0)
    async with _concurrency():
        return await _run(member, prompt, timeout, effort)


async def _run(member: Member, prompt: str, timeout: float, effort: Optional[str]) -> Optional[str]:
    """Run one CLI call; the timeout covers the call itself, not time spent queued."""
    try:
        proc = await asyncio.create_subprocess_exec(
            *_command(member, effort),
            cwd=_WORKDIR,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except OSError as e:
        print(f"Error starting {member.id}: {e}")
        return None

    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(prompt.encode()), timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        print(f"Error querying {member.id}: timed out after {timeout:.0f}s")
        return None

    text = stdout.decode(errors="replace").strip()
    if proc.returncode != 0 or not text:
        print(f"Error querying {member.id} (exit {proc.returncode}): {stderr.decode(errors='replace')[-500:]}")
        return None
    return text


async def query_parallel(
    jobs: List[Tuple[str, Member, str]],
    on_response: Optional[Callable[[str, str], Awaitable[None]]] = None,
    effort: Optional[str] = None,
) -> Dict[str, Optional[str]]:
    """
    Run (key, member, prompt) jobs in parallel; one member may appear in several jobs.

    `on_response(key, text)` fires as each job finishes, so callers can stream progress.
    Returns {key: text or None}, in job order.
    """
    async def run(key: str, member: Member, prompt: str) -> Optional[str]:
        text = await query_member(member, prompt, effort=effort)
        if text is not None and on_response is not None:
            await on_response(key, text)
        return text

    texts = await asyncio.gather(*(run(*job) for job in jobs))
    return {job[0]: text for job, text in zip(jobs, texts)}
