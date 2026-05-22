# Architecture & Flow

## How the plugin activates

```
New Claude Code session
    └── SessionStart hook fires
            └── critica-activate.js
                    ├── Detects language (CRITIQUE_LANG → LANG/LC_ALL → Windows locale → Intl → 'en')
                    ├── Writes ~/.claude/.critique-active  →  "active:[lang]:[unix_timestamp]"
                    ├── Registers SessionStart + UserPromptSubmit hooks in settings.json (idempotent)
                    ├── Copies critica-statusline.[sh|ps1] to ~/.claude/hooks/
                    └── Outputs activation banner to model (in detected language)
```

## Per-turn reinforcement

```
User submits message
    └── UserPromptSubmit hook fires
            └── critica-tracker.js
                    ├── Flag missing? (mid-session install)
                    │       └── spawn critica-activate.js in background
                    │           write temporary flag so this turn still injects
                    │
                    ├── Prompt matches reactivation pattern?
                    │       └── refresh flag timestamp → return
                    │
                    ├── Prompt matches deactivation pattern?
                    │       └── delete flag → return (no output)
                    │
                    └── Flag present and fresh (< 24h)?
                            yes → refresh timestamp + write hookSpecificOutput JSON to stdout
                                  (model receives critique context as additionalContext)
                            no  → no output (silent)
```

## Flag state machine

```
File: ~/.claude/.critique-active
Format: active:[en|pt|es|fr]:[unix_timestamp]

OFF (missing or > 24h old)  ──── SessionStart ───► ON (detected lang)
ON                          ──── each message  ───► ON (timestamp refreshed)
ON + deactivation phrase    ────────────────────► OFF (file deleted)
OFF + reactivation phrase   ────────────────────► ON (timestamp set)

Rejected states (security):
  - symlink target → ignored
  - file > 64 bytes → ignored
```

## Components and what each changes

| Component | Activation | Persists | Scope | Depth |
|---|---|---|---|---|
| Hook (auto) | Every session start | Until "off" phrase or 24h | Every message | Medium |
| `/critique` | Explicit invocation or phrase | Full session | Everything | Medium |
| `/scan` | `/scan` or trigger phrase | One-shot only | Last message | Blockers only |
| `/rigorous [arg]` | Explicit invocation | One-shot only | Current task | Maximum |

### Hook (automatic)

Invisible to the user. Injects `additionalContext` into every prompt before the model sees it.
This is the plugin's default behavior — always on after install, no user action required.

### `/critique`

Reinforces and refines the same behavior as the hook. Redundant when the hook is already
active. Useful when:
- The hook was deactivated and the user wants to re-enable via explicit skill invocation.
- The user wants to anchor the critical framing explicitly in the conversation.

### `/scan`

Different purpose: no persistence, no style commentary, no explanations.
Single question: "is there a critical blocker here, yes or no?"
Returns one finding per line. Stops when done. Does not bleed into subsequent messages.

### `/rigorous [arg]`

Heaviest mode. Forces the model through explicit phases before responding.

| Arg | Phases run |
|---|---|
| *(none)* | PHASE 0 → 1 → 2 → 3 (full) |
| `plan <task>` | PHASE 0 + scope/dependency/risk → PHASE 3 |
| `impl` | PHASE 0 + PHASE 1 + PHASE 2 → PHASE 3 |
| `sec` | PHASE 0 + PHASE 1 → PHASE 3 (security only) |
| `code` | PHASE 0 + PHASE 2 quality → PHASE 3 |

When `/rigorous` fires in the same response as the hook, rigorous takes full precedence.
The hook's turn-by-turn commentary does not layer on top.

## Typical session flow

```
Session starts          → hook injects critique context on every message (automatic)

/scan my code           → one-shot, blockers only, no persistence

/rigorous impl          → deep audit of current implementation
                          after response: back to normal hook behavior

critique off            → hook silenced, no injection until reactivated

critique on             → hook reactivated, flag refreshed
```

## Deactivation phrases (all languages)

| Language | Phrases |
|---|---|
| EN | `critique off` · `disable critique` · `stop critique` |
| PT | `critica off` · `desativa critica` · `sem critica` |
| ES | `critica off` · `desactiva critica` · `sin critica` |
| FR | `critique off` · `désactive critique` · `sans critique` |

## Source files

```
src/hooks/
├── critica-activate.js     SessionStart hook — init, flag write, hook registration, statusline setup
├── critica-tracker.js      UserPromptSubmit hook — per-turn flag check, pattern matching, injection
├── critica-statusline.sh   Bash statusline badge renderer
└── critica-statusline.ps1  PowerShell statusline badge renderer

skills/
├── critique/SKILL.md       /critique — persistent critical mindset
├── scan/SKILL.md           /scan — one-shot blocker scan
└── rigorous/SKILL.md       /rigorous — deep analysis with phased protocol
```
