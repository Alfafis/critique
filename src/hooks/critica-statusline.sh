#!/usr/bin/env bash
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
FLAG="$CLAUDE_DIR/.critique-active"
[ -f "$FLAG" ] || exit 0
[ -L "$FLAG" ] && exit 0
SIZE=$(wc -c < "$FLAG" 2>/dev/null || echo 999)
[ "$SIZE" -le 64 ] || exit 0
printf '\033[38;5;196m[CRITIQUE]\033[0m'
