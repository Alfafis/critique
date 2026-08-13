# Security Policy

## Reporting a vulnerability

Report privately through
[GitHub Security Advisories](https://github.com/Alfafis/critique/security/advisories/new).
Please do not open a public issue for a security problem.

Include what an attacker can do, not only what looks wrong: the file and line, the state
required to reach it, and what an attacker controls. A reproduction against a throwaway
`CLAUDE_CONFIG_DIR` is ideal:

```shell
CLAUDE_CONFIG_DIR=$(mktemp -d) CLAUDE_PLUGIN_ROOT=$PWD node src/hooks/critica-activate.js
```

Expect a first response within 7 days. This is a single-maintainer project — there is no
on-call rotation, so a critical report may still take days to reach a release.

## Supported versions

Only the latest release is supported. The community marketplace pins a specific commit and
bumps it as commits land on `main`, so the version you have may be behind the fixed one — check
`/plugin` before reporting.

| Version | Supported |
|---|---|
| 1.5.x | yes |
| ≤ 1.4.x | no — upgrade |

Versions **1.3.1 and earlier destroy `~/.claude/settings.json`** when it fails to parse,
taking `model`, `permissions`, `env` and MCP configuration with it. If you are on one of those,
upgrading is the fix; see `CHANGELOG.md` under 1.4.0.

## What this plugin does to your machine

Worth knowing before you trust it, and the surface any report should be measured against.

**On every session start** it writes `~/.claude/.critique-active`, a file of at most 64 bytes
holding `active|off:<lang>:<timestamp>`. That is the plugin's entire persistent state.

**On every prompt** it prints roughly 125 tokens of instructions to stdout, which Claude Code
passes to the model as `additionalContext`. It does not read your prompt beyond matching the
on/off phrases, does not store it, and does not send anything anywhere.

**It makes no network requests.** It has no npm dependencies, so there is no transitive
supply-chain surface — the code you can read in `src/hooks/` is all of it.

**It writes to `~/.claude/settings.json` in exactly one case**: removing hook entries that
versions ≤ 1.3.1 left behind. That code only ever deletes this plugin's own entries, never adds
anything, does not write when there is nothing to remove, and is scheduled for removal in 1.6.0.

**It touches nothing else unless you ask.** `/critique:badge` is the only path that registers a
`statusLine` or edits a statusline script you own, and `/critique:badge off` reverses it exactly.

### Hardening already in place

- The state file is rejected if it is a symlink, larger than 64 bytes, or does not match the
  expected format — so it cannot be used to feed arbitrary text into the model's context.
- Writes never follow a symlink to its target, and refuse outright if the containing directory
  is a symlink.
- A `settings.json` that does not parse is never written over.
- Writes to `settings.json` take a cross-process lock.

### Known limitations

- `hooks/hooks.json` invokes `node` from `PATH`. Under a version manager (fnm, nvm), if `node`
  is not on the inherited `PATH` the hook fails silently. A plugin manifest cannot interpolate
  an absolute interpreter path.
- Uninstalling the plugin does not remove `~/.claude/.critique-active`, a badge you installed,
  or the marked block in your statusline script. Claude Code has no uninstall hook. Run
  `/critique:badge off` before uninstalling, and delete the flag file by hand.
