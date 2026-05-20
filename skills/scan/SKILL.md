---
name: scan
description: >
  One-shot critical scan — surfaces only critical blockers in what was just shown.
  Use when user invokes /scan, says "scan this", "tem algo errado aqui", "aponta o problema",
  "check this", "quick review", "something wrong here", "olha isso pra mim".
  Does NOT persist. Does NOT comment on style or minor improvements.
---

Scan what was just presented for critical blockers only.

**Critical blockers (report these):**
- Bugs that break functionality or cause data loss
- Security vulnerabilities (injection, auth bypass, exposed secrets, XSS)
- Unhandled edge cases that cause crashes or silent failures
- Logic errors with wrong outcomes

**Stay silent on:**
- Style, formatting, naming preferences
- Refactoring opportunities
- Minor readability improvements
- "Nice to have" suggestions
- Anything that doesn't break or cause damage

**Format:** Direct. One finding per line. No preamble. No "overall it looks good".
If nothing critical: say "No critical issues found." and stop.
