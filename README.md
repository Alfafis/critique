# critique

Permanent critical mindset for Claude Code. Every response surfaces real bugs, questionable decisions, and unhandled edge cases — ordered by impact. No sugarcoating.

---

## Before / After

**Without critique:**
> "This looks good overall! A few minor things to consider..."

**With critique:**
> 🔴 **Security:** `userId` comes from request body without validation — attacker controls it. Read from session token instead.
>
> 🟡 **Design:** `processOrder` does DB write + email in the same function — partial failure leaves inconsistent state. Wrap in transaction or split into two operations.

---

## What it does

Injects a permanent critical mindset into every session via a `SessionStart` hook. Active on every response, every task:

| What | How |
|---|---|
| **Real problems** | Bugs, security flaws, unexpected behaviors, unhandled edge cases. Only what actually breaks. |
| **Questionable decisions** | Architecture/implementation choices that will cause pain later — with explanation and alternative. |
| **What's good** | Only if non-obvious and worth reinforcing. No praising the obvious. |
| **Priority** | Ordered by real impact, not ease of fix. |

Applies to: code, review, brainstorm, plan, architecture, decisions.

---

## Skills

### `/critique`
Activate the critical mindset explicitly for the current session.

### `/rigorous`
Deep analysis mode before coding, reviewing, or planning. Five-phase protocol:
pre-flight → security audit → implementation audit → structured output → STOP protocol.

Supports focused modes: `/rigorous plan <task>` · `/rigorous sec` · `/rigorous impl` · `/rigorous code`

---

## Install

### Claude Code plugin marketplace

```
/plugin install critique
```

Or: `/plugin` → Discover → search `critique`.

### Manual (via `extraKnownMarketplaces`)

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

Then run `/plugin` → Discover → install `critique`.

### Statusline badge

Copy `src/hooks/critica-statusline.ps1` (Windows) or `src/hooks/critica-statusline.sh` (Mac/Linux) to your Claude config directory, then add to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"C:/Users/YOU/.claude/critica-statusline.ps1\""
  }
}
```

Renders `[CRITIQUE]` in red when active.

---

## Toggle

**On:** automatic — hooks activate every session.

**Off:** `critique off` · `disable critique` · `stop critique` · `desativa critica` · `sem critica`

---

## License

MIT
