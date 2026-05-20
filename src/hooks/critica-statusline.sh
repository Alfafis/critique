#!/usr/bin/env bash
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
FLAG="$CLAUDE_DIR/.critique-active"
[ -f "$FLAG" ] || exit 0
[ -L "$FLAG" ] && exit 0
SIZE=$(wc -c < "$FLAG" 2>/dev/null || echo 999)
[ "$SIZE" -le 64 ] || exit 0
CONTENT=$(cat "$FLAG")
[[ "$CONTENT" =~ ^active:[a-z]{2}:([0-9]+)$ ]] || exit 0
NOW=$(date +%s)
AGE=$(( NOW - ${BASH_REMATCH[1]} ))
[ "$AGE" -le 86400 ] || exit 0
printf '\033[38;5;196m[CRITIQUE]\033[0m'
