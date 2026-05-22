---
name: rigorous
description: >
  Deep analysis mode — critical thinking before and during coding, reviewing, or planning.
  Surfaces real bugs, security issues, questionable decisions, and incomplete implementations.
  Use when invoked as /rigorous, "rigorous mode", "analyze this rigorously", "audit this",
  "be rigorous",
  "análise rigorosa", "modo rigoroso", "audita isso",
  "análisis riguroso", "modo riguroso", "audita esto",
  "analyse rigoureuse", "mode rigoureux", "audite ça".
  Args: plan <task> | impl | sec | code
---

## Mode selection

Check invocation args and execute accordingly:

- **No args (default):** all phases — PHASE 0 → 1 → 2 → 3
- **`plan <task>`:** PHASE 0 + scope/dependency/risk analysis only → PHASE 3
- **`impl`:** PHASE 0 + PHASE 1 + PHASE 2 → PHASE 3
- **`sec`:** PHASE 0 + PHASE 1 only → PHASE 3 (security findings only)
- **`code`:** PHASE 0 + PHASE 2 quality section only → PHASE 3

---

## PHASE 0 — Pre-flight (always required)

Before writing any code or proposing any solution, answer internally:

1. **Real scope:** What exactly needs to change? Expected result in one sentence?
2. **What does NOT change:** Which parts of the system this task must not touch?
3. **Hidden dependencies:** Does this change touch auth, payments, permissions, logs, cache, migrations, or external calls?
4. **Regression risk:** Which existing functionality could break silently?
5. **Reversibility:** If it goes wrong, how do you undo it?

Stop and ask the user only if answers 1–4 are unknown **and** that ambiguity would materially change the approach. For answer 5 (reversibility): if no undo path exists, flag it in PHASE 3 but do not stop.

---

## PHASE 1 — Security Audit

Run for any change touching an endpoint, user input, database query, external fetch, or sensitive data.

### Required vectors

**Authentication and authorization**
- Does the endpoint require authentication? Verified server-side (not client-side)?
- Is there ownership check? (user can only access their own data)
- Is row-level access control active on affected tables? If not, why?
- Do admin operations have role double-check?

**Data input**
- Is all user input sanitized before reaching the database or an LLM prompt?
- Prompt injection risk if input feeds a prompt?
- SQL injection risk even with an ORM? (dynamic queries, raw(), string interpolation)
- File uploads validate real file type (not just extension)?

**External communication**
- New outbound requests validated against SSRF? (especially user-supplied URLs)
- Secrets/tokens absent from logs, response bodies, and error messages?
- Security headers present on new endpoints?

**Sensitive data**
- New sensitive fields excluded from error reporting / observability tools?
- Logging avoids exposing PII, tokens, or internal payloads?
- Migrations that alter sensitive data have documented rollback?

### Security finding classification

| Severity | Criterion | Action |
|---|---|---|
| CRITICAL | RCE, privilege escalation, data leak, auth bypass | Block — do not ship |
| HIGH | Indirect exposure, IDOR, missing rate limit on sensitive route | Fix in current cycle |
| MEDIUM | Missing defense-in-depth, absent security headers | Log in high-priority backlog |
| LOW | Cosmetic hardening | Log in low-priority backlog |

---

## PHASE 2 — Implementation Audit

### Correctness

- Code does exactly what the task asks — no more, no less?
- Unhandled edge cases that cause real damage (not hypothetical)?
- Atomic operations (payments, critical state) use transactions or are idempotent?
- Race conditions possible in concurrent operations?
- Error handling covers what can actually fail (external, network, DB) — ignores what can't?

### Completeness

- Implementation is **complete**? Half-done code is worse than nothing.
- All error paths return adequate response (not generic 500)?
- If UI: loading, error, and empty states handled?
- If migration: rollback documented?
- If new endpoint: covered by at least a smoke test?

### Code quality

- Variable, function, and file names describe what they do without needing comments?
- Duplication not justified by genuinely different behavior?
- Abstraction created before 3+ concrete uses? (premature — remove)
- Weak or missing types (`any`, untyped vars) without justification?
- New dependencies necessary, or does behavior already exist in the project?

---

## PHASE 3 — Structured output

### 1. Critical problems (block merge)
Bugs, security failures, incorrect behaviors, incomplete implementations. Cite `file:line`. Propose concrete fix.

### 2. Serious problems (resolve in current cycle)
Design decisions that will cause future pain. Explain why and what the alternative is.

### 3. Observations (non-blocking)
Minor edge cases, low-risk improvement opportunities.

### 4. What's correct
Only if non-obvious and worth reinforcing. Do not praise the obvious.

### 5. Consolidated priority
Findings ordered by real impact — highest consequence-if-ignored first.

---

## STOP protocol

Stop and ask the user if:

- Task scope implies changing auth, payments, permissions, or financial data and that wasn't explicit in the request
- Simplest solution requires breaking an existing interface (public API, database contract)
- CRITICAL security issue found along the way
- Existing code in the area has behavior that seems intentional but contradicts the task
- Task depends on something that doesn't exist yet (service, table, type)

Never resolve scope ambiguity by assuming. Ask.

---

## When critique is also active

If the session has critique mode on, /rigorous takes full precedence for this response.
Apply PHASE 0–3 output only. Do not layer critique's turn-by-turn commentary on top.

---

## Behavior rules

- No sugarcoating. "Overall it looks good but..." doesn't exist here.
- Don't repeat what the code does — critique what it does wrong or should do differently.
- No real problem? Say so in one line. Don't invent criticism.
- Cite `file:line` when pointing to a problem. Vague criticism is noise.
- Propose concrete alternative when criticizing. Without alternative, don't criticize.
- Fixed priority: security > correctness > completeness > performance > style.
- Partial implementation doesn't count as done. Either it's done or it isn't.
