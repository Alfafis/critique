# critique

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-Plugin-d03b2f?logo=anthropic&logoColor=white)](https://claude.ai/code)
[![GitHub stars](https://img.shields.io/github/stars/Alfafis/critique?style=flat&color=yellow)](https://github.com/Alfafis/critique/stargazers)
[![Last Commit](https://img.shields.io/github/last-commit/Alfafis/critique?style=flat)](https://github.com/Alfafis/critique/commits/main)

Permanent critical mindset for Claude Code. Every response surfaces real bugs, questionable decisions, and unhandled edge cases — ordered by impact. No sugarcoating.

<p align="center">
  <a href="#before--after">Before/After</a> •
  <a href="#install">Install</a> •
  <a href="#skills">Skills</a> •
  <a href="#toggle">Toggle</a>
</p>

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

### Claude Code community marketplace

```
/plugin install critique
```

Or: `/plugin` → Discover → search `critique`.

### Direct from GitHub (CLI)

Run in your terminal (outside Claude Code), or use `!` prefix inside Claude Code:

```shell
claude plugin marketplace add Alfafis/critique && claude plugin install critique@critique
```

### Direct from GitHub (manual)

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

Then install:

```shell
/plugin install critique@critique
```

### Statusline badge

Automatic on first activation — the plugin copies the badge script to `~/.claude/hooks/` and registers it in `settings.json`. Renders `[CRITIQUE]` in red when active.

---

## Toggle

**On:** automatic — hooks activate every session.

**Off:** `critique off` · `disable critique` · `stop critique` · `desativa critica` · `sem critica`

---

## License

MIT
