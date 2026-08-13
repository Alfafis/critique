# Architecture & Flow

## How the plugin activates

```
New Claude Code session
    └── SessionStart hook fires (declared in hooks/hooks.json — the only registration)
            └── critica-activate.js
                    ├── Detects language (CRITIQUE_LANG → LANG/LC_ALL → Windows locale → Intl → 'en')
                    ├── Writes ~/.claude/.critique-active  →  "active:[lang]:[unix_timestamp]"
                    ├── Removes legacy hook entries left in settings.json by ≤ 1.3.1
                    ├── Copies critica-statusline.[sh|ps1] to ~/.claude/hooks/
                    └── Outputs activation banner to model (in detected language)
```

### Hook registration lives in one place

`hooks/hooks.json` is the sole registration. Versions up to 1.3.1 *also* copied the two hooks
into `~/.claude/settings.json`, so both fired: the banner and the per-turn `additionalContext`
were injected twice on every turn. That copy also hardcoded the versioned plugin cache path
(`…/critique/1.3.1/src/hooks/…`), which broke on upgrade and survived uninstall.

`cleanupLegacyHooks()` deletes those entries on the next session start. It never touches
third-party hooks, and it aborts rather than writing when `settings.json` is not valid JSON —
overwriting it would destroy the user's `model`, `permissions`, `env`, and MCP config.

### Writes to settings.json

Only two things are ever written: removal of legacy critique hooks, and `statusLine` when the
user has none. Both go through a `mkdir`-based lock in `~/.claude/.critique-settings.lock` so
two sessions starting at once cannot lose each other's write. Locks older than 10s are treated
as orphaned and broken.

## Per-turn reinforcement

```
User submits message
    └── UserPromptSubmit hook fires
            └── critica-tracker.js
                    ├── Prompt matches reactivation pattern?
                    │       └── write "active:[lang]" → return (no output)
                    │
                    ├── Prompt matches deactivation pattern?
                    │       └── write "off:[lang]" → return (no output)
                    │
                    ├── Flag file absent? (mid-session install)
                    │       └── spawn critica-activate.js in background
                    │           write "active:en" so this turn still injects
                    │
                    ├── Flag unparseable / symlink / oversized?
                    │       └── no output (silent) — SessionStart rewrites it next session
                    │
                    ├── State is "off"?
                    │       └── no output (silent)
                    │
                    └── State "active" and fresh (< 24h)?
                            yes → refresh timestamp + write hookSpecificOutput JSON to stdout
                                  (model receives critique context as additionalContext)
                            no  → no output (silent)
```

Pattern matching runs **before** the missing-flag branch. In 1.3.x it ran after, and
deactivation deleted the flag file — so the next prompt saw "flag missing", treated it as a
fresh install, rewrote the flag and resumed injecting. `critique off` lasted exactly one turn,
and came back as `en` regardless of the detected language.

## Flag state machine

```
File: ~/.claude/.critique-active
Format: [active|off]:[en|pt|es|fr]:[unix_timestamp]

absent / expired            ──── SessionStart ───► active (detected lang)
active                      ──── each message  ───► active (timestamp refreshed)
active + deactivation phrase ───────────────────► off    (lang preserved)
off                         ──── each message  ───► off    (silent, no injection)
off + reactivation phrase    ───────────────────► active (lang preserved)
absent + any other prompt    ───────────────────► active (mid-session install)

"off" is a written state, not a deleted file: absence means "never installed" and triggers
first-run activation, so deactivating by unlink could not persist.

Rejected states (security):
  - symlink target  → ignored, no injection
  - file > 64 bytes → ignored, no injection
  - unknown state   → ignored, no injection
```

## Toggle phrase matching

Both patterns require the verb and the word `critique`/`critica`/`crítica` to be **adjacent**
(one optional article between them). 1.3.x allowed `.*` between them, which meant any prompt
containing both anywhere toggled the mode silently — `sem problemas, faz a critica disso` and
`can you stop using critique.md as reference` both turned it off, with no output to say so.

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
hooks/hooks.json            Sole hook registration (SessionStart + UserPromptSubmit)
.claude-plugin/
├── plugin.json             Plugin manifest — version lives here only
└── marketplace.json        Marketplace manifest

src/hooks/
├── critica-activate.js     SessionStart hook — init, flag write, legacy cleanup, statusline setup
├── critica-tracker.js      UserPromptSubmit hook — per-turn flag check, pattern matching, injection
├── critica-statusline.sh   Bash statusline badge renderer
├── critica-statusline.ps1  PowerShell statusline badge renderer
└── __tests__/              node:test suites for both hooks

skills/
├── critique/SKILL.md       /critique — persistent critical mindset
├── scan/SKILL.md           /scan — one-shot blocker scan
└── rigorous/SKILL.md       /rigorous — deep analysis with phased protocol
```

The manifests used to be duplicated at the repo root. A release then had to bump the version in
two files; `.claude-plugin/` is the location Claude Code reads, so the root copies were deleted.

## Statusline badge injection

When the user already has a `statusLine`, the badge call is spliced into their script **before
the last `exit` statement**, wrapped in `# >>> critique badge >>>` / `# <<< critique badge <<<`
markers. Appending at the end — what 1.3.x did — put the call after the `exit 0` that aggregator
scripts commonly end with, so the badge never rendered while the function reported success.

### Quoting, per platform

| Where | Parsed by | Quoting | Why |
|---|---|---|---|
| `settings.json` → `statusLine.command` | cmd.exe (Windows) / sh (unix) | **double** | cmd.exe does not treat `'` as quoting — a single-quoted path reaches `powershell.exe` with the quotes intact and `-File` fails |
| Injected line inside a `.sh` | bash | **single** | bash expands `$` inside double quotes |
| Injected line inside a `.ps1` | PowerShell | **single** | PowerShell expands `$` inside double quotes |

`$` in a path is not hypothetical on Windows — it is legal in a username (`C:\Users\dev$\…`).
Escaping differs: bash needs `'\''`, PowerShell doubles the quote (`''`).

Backslashes in the Windows `statusLine.command` are stored **unescaped**. `JSON.stringify`
escapes them when `settings.json` is written; 1.3.x also pre-escaped them, which produced a
literal `C:\\Users\\…` in the command string.

### Line endings

`spliceBadgeCall` takes a line array and joins it with the **target file's own** ending,
detected from its content. A `.ps1` is CRLF (enforced by `.gitattributes`); splicing LF lines
into it would leave the file with mixed endings.

### The two badge renderers

`critica-statusline.sh` and `critica-statusline.ps1` are independent implementations of the same
contract: read the flag, reject symlink / reparse point, reject > 64 bytes, require `^active:`,
require age ≤ 86400, and **never exit non-zero** — a non-zero exit hides the entire status bar.
Because `off:` is not `active:`, deactivating removes the badge on both platforms with no extra
code. A test suite pins the contract across both files, since the `.ps1` cannot be executed on a
machine without PowerShell.
