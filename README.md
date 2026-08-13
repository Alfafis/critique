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

### What it costs

The hook adds about **125 tokens to every prompt**, for as long as the mode is on. That is the
mechanism — the instructions have to be in the model's attention on each turn, or the behavior
decays after a few messages. It is a standing cost, not a one-off.

Turn it off with `critique off` when you don't want it; the hook then writes nothing and injects
nothing until you turn it back on. Nothing is read from your prompts beyond the on/off phrases,
nothing is stored, and the plugin makes no network requests. See [SECURITY.md](SECURITY.md).

---

## Skills

### `/critique`
Activate the critical mindset explicitly for the current session.

### `/rigorous`
Deep analysis mode before coding, reviewing, or planning. Five-phase protocol:
pre-flight → security audit → implementation audit → structured output → STOP protocol.

Supports focused modes: `/rigorous plan <task>` · `/rigorous sec` · `/rigorous impl` · `/rigorous code`

### `/scan`
One-shot scan of what was just shown. Critical blockers only, no persistence, no style commentary.

### `/badge`
Install, remove, or check the `[CRITIQUE]` statusline badge. See [Statusline badge](#statusline-badge-opt-in).

---

## Install

### Claude Code community marketplace

Add the community marketplace once, then install:

```
/plugin marketplace add anthropics/claude-plugins-community
/plugin install critique@claude-community
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

### Statusline badge (opt-in)

```
/critique:badge
```

Renders `[CRITIQUE]` in red in the statusline while the mode is active, and disappears when it is off.

It is **not** installed automatically. Installing it changes configuration outside the plugin's own directory — it sets `statusLine` in `~/.claude/settings.json`, or, if you already have one, splices a call into your existing statusline script between these markers:

```shell
# >>> critique badge >>>
[ -f '…/critica-statusline.sh' ] && bash '…/critica-statusline.sh'
# <<< critique badge <<<
```

`/critique:badge off` reverses exactly that: it removes the marked block, or the `statusLine` entry if the plugin was the one that set it, then deletes the copied script. Content outside the markers is never touched. `/critique:badge status` reports the current state.

Installing never overwrites an existing `statusLine`, and never writes over a `settings.json` it cannot parse.

---

## Toggle

**On:** automatic — hooks activate every session.

**Off:** `critique off` · `disable critique` · `stop critique` · `desativa critica` · `sem critica` · `desactiva critica` · `désactive critique`

**Back on:** `critique on` · `enable critique` · `ativa critica` · `activa la critica` · `réactive critique`

Off persists for the rest of the session and keeps your detected language. A new session starts active again — that is the plugin's default. The phrase has to name critique directly (`stop critique`, not `stop` somewhere in a sentence that happens to mention critique), so ordinary prompts never toggle it by accident.

---

## Contributing

Tests, signing setup and the release process: [CONTRIBUTING.md](CONTRIBUTING.md).
Reporting a vulnerability: [SECURITY.md](SECURITY.md).

## License

MIT
