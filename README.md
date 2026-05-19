# critique

Permanent critical mindset for Claude Code. Surfaces real bugs, questionable decisions, and unhandled edge cases — ordered by impact, no sugarcoating.

---

## Before / After

**Without critique:**
> "This looks good overall! A few minor things to consider..."

**With critique:**
> **Security hole:** `userId` comes from request body without validation — attacker controls it. Fix: read from session token only.
> **Design problem:** `processOrder` does DB write + email send in same function — partial failure leaves inconsistent state. Split or wrap in transaction.

---

## What it does

Every response, every task:

- **Real problems** — bugs, security flaws, unexpected behaviors, unhandled edge cases. Only what actually breaks or causes damage.
- **Questionable decisions** — architecture or implementation choices that will bite later. Explains why and what's better.
- **What's good** — only if non-obvious and worth reinforcing. No praising the obvious.
- **Priority** — ordered by real impact, not ease of fix.

Active on: code, review, brainstorm, plan, architecture, decisions.

---

## Install

### Claude Code plugin

Add to `~/.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "critique": {
      "source": {
        "source": "github",
        "repo": "Alfafis/critique"
      }
    }
  }
}
```

Then in Claude Code: `/install-plugin` → select `critique`.

### Statusline badge

Add the badge to your `settings.json` statusline:

**Windows** (`critica-statusline.ps1` from `src/hooks/`):
```json
{
  "statusLine": {
    "type": "command",
    "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"PATH_TO/critica-statusline.ps1\""
  }
}
```

**Mac/Linux** (`critica-statusline.sh` from `src/hooks/`):
```json
{
  "statusLine": {
    "type": "command",
    "command": "bash \"PATH_TO/critica-statusline.sh\""
  }
}
```

---

## Toggle

On: automatic — active every session via SessionStart hook.

Off: say `critique off`, `disable critique`, `stop critique`, `desativa critica`, or `sem critica`.

---

## License

MIT
