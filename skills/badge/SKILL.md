---
name: badge
description: >
  Install, remove, or check the [CRITIQUE] statusline badge. Use when invoked as
  /badge, or when the user says "install the critique badge", "enable the badge",
  "remove the badge", "statusline badge",
  "instala o badge", "ativa o badge", "remove o badge",
  "instala la insignia", "quita la insignia",
  "installe le badge", "retire le badge".
  Args: (none) = install | off | status
disable-model-invocation: true
---

The badge renders `[CRITIQUE]` in red in the Claude Code statusline while critique mode
is active, and disappears when it is off.

It is **not** installed automatically. Installing changes configuration outside this
plugin's directory — it writes `statusLine` to `~/.claude/settings.json`, or appends a
call into a statusline script you already own — so it only happens when you ask.

## What to run

Pass the user's argument straight through. With no argument, install.

```shell
node "${CLAUDE_PLUGIN_ROOT}/src/hooks/critica-badge.js" $ARGUMENTS
```

| Argument | Effect |
|---|---|
| *(none)* | Copies the badge script to `~/.claude/hooks/` and registers it: sets `statusLine` if you have none, otherwise splices a call into your existing statusline script between `# >>> critique badge >>>` markers, before its last `exit`. |
| `off` | Removes the marked block from your script, or removes the `statusLine` entry if this plugin was the one that set it, then deletes the copied script. Content outside the markers is never touched. |
| `status` | Reports whether the badge is installed and whether a `statusLine` is configured. |

## After running

Report the command's output verbatim — it names the exact file that changed. Then:

- **On install:** the badge appears on the next statusline refresh. If the output says
  the existing `statusLine` could not be spliced into, it is not a shell script; the
  user has to call the printed path from it themselves.
- **On failure:** the command exits non-zero and explains why. The usual cause is a
  `settings.json` that is not valid JSON — the installer refuses to write over one it
  cannot parse, rather than replacing it.

Do not edit `settings.json` or any statusline script by hand to work around a failure.
Fix the reported cause and run the command again.
