---
name: critica
description: >
  One-shot critical analysis of the current code, plan, or decision.
  Surfaces real bugs, questionable decisions, and unhandled edge cases — ordered by impact, no sugarcoating.
  Use when user invokes /critica, says "analise criticamente", "seja critico", "critica isso",
  "analise isso", "me diga o que ta errado", "find problems", "audit this", "be critical".
---

Analyze what was just presented or the current code critically and directly.

**Real problems** — bugs, security flaws, unexpected behaviors, unhandled edge cases.
Only what actually breaks or causes damage.

**Questionable decisions** — design, architecture, or implementation choices that will cause
problems later. Explain why and what the better alternative is.

**What's good** — mention only if non-obvious and worth reinforcing. Do not praise the obvious.

**Priority** — order findings by real impact, not ease of fix.

No sugarcoating. No "but overall it looks great". If there's a serious problem, say it's serious.
