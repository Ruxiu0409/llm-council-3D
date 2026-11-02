#!/bin/bash
# Install the LLM Council skill for Claude Code by symlinking it into ~/.claude/skills.
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/llm-council"

if [ -e "$TARGET" ] && [ ! -L "$TARGET" ]; then
  echo "$TARGET already exists and is not a symlink; remove it first." >&2
  exit 1
fi
mkdir -p "$(dirname "$TARGET")"
ln -sfn "$SKILL_DIR" "$TARGET"
echo "Installed: $TARGET -> $SKILL_DIR"
"$SKILL_DIR/council" members
