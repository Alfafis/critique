# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries for 1.3.1 and earlier were reconstructed from commit history, so they are less detailed
than the ones written as the work happened.

## [1.5.0] — 2026-08-13

### Changed

- **The statusline badge is now opt-in.** Install it with `/critique:badge`; remove it with
  `/critique:badge off`; check it with `/critique:badge status`. A session start no longer
  writes to `~/.claude/settings.json` at all.

  Until 1.4.0 the badge installed itself on first activation: it set `statusLine` and appended
  a call into whatever statusline script you owned, without asking. That is configuration
  outside the plugin's own directory, changed on your behalf.

  **If you already have the badge, nothing changes** — the injected block stays where it is and
  keeps working. Only new installs need the explicit command.

- `/critique:badge off` is an exact inverse: it removes only the lines between the
  `# >>> critique badge >>>` markers, so a script you own comes back byte-identical.

### Added

- `critica-settings.js` and `critica-badge.js`, so the activation hook and the badge installer
  share `settings.json` access without a circular require.
- `refreshIfInstalled()` on session start: updates a badge you already installed so it stays in
  sync with the flag format across upgrades. It never creates one.

### Fixed

- README pointed at `/plugin install critique`, which predates the community-marketplace
  approval. Installing from the catalog needs
  `/plugin marketplace add anthropics/claude-plugins-community` first, then
  `/plugin install critique@claude-community`.

## [1.4.0] — 2026-08-13

Nine defects found in a full audit. Every one had a reproduction before and after the fix.

### Fixed

- **`~/.claude/settings.json` could be destroyed.** A failed `JSON.parse` was swallowed and the
  hook then wrote `{}` plus its own keys over the top, taking `model`, `permissions`, `env` and
  MCP configuration with it. The plugin now aborts rather than writing over a `settings.json` it
  cannot parse.
- **`critique off` lasted a single turn.** The "flag missing means fresh install" check ran
  before the deactivation branch, and deactivating deleted the flag — so the next prompt treated
  it as a new install and turned the mode back on, in English regardless of your language. Off
  is now a written state that keeps your language.
- **Every hook fired twice.** `hooks/hooks.json` declared the hooks and `setupHooks()` copied
  them into `settings.json`; both ran, so the activation banner and the per-turn context were
  injected twice on every turn. `hooks/hooks.json` is now the only registration, and the stale
  entries are removed automatically on the next session start.
- **A stale plugin path was left in `settings.json`.** The copied registration hardcoded the
  versioned cache directory, so it pointed at a deleted path after any upgrade and survived
  uninstall.
- **Ordinary prompts silently turned the mode off.** The toggle patterns only required the verb
  and the word `critique`/`critica` to appear somewhere in the same prompt. `stop using
  critique.md as reference` and `sem problemas, faz a critica disso` both deactivated it, with
  no output saying so. They now require the words to be adjacent.
- **Concurrent sessions could lose each other's `settings.json` write.** Writes now take a
  cross-process lock.
- **The badge never rendered when spliced into an aggregator script.** The call was appended at
  the end, after the `exit 0` such scripts commonly finish with. It is now inserted before the
  last `exit`, wrapped in removable markers.
- **A symlinked flag file bricked the plugin permanently.** The write guard refused and stopped,
  so the flag stayed a symlink, every later write refused too, and critique never activated
  again — with no error anywhere. The link is now removed (never its target) and the state
  recovers.
- **Windows paths were mangled** in `statusLine.command` by escaping backslashes that
  `JSON.stringify` already escapes, and injected paths containing `$` were expanded by both bash
  and PowerShell.

### Removed

- Duplicate `plugin.json` and `marketplace.json` at the repository root. `.claude-plugin/` is
  the location Claude Code reads, and keeping both meant bumping the version in two files.

## [1.3.1] — 2026-05-27

### Fixed

- Statusline: prevent the badge from injecting a call into itself when critique already owns
  `statusLine`.

## [1.3.0] — 2026-05-22

### Added

- Unit tests for the hooks.

### Fixed

- Activation on a mid-session install via `/reload-plugins`.
- Warn when the badge cannot be injected because `statusLine` is not a shell script.
- Skill frontmatter and multi-language trigger phrases.

## [1.2.0] — 2026-05-21

### Added

- Automatic hook registration and a badge fix.
- Published to GitHub; submitted to the community marketplace. Homepage live at
  <https://critique.developercorp.com>.

## [1.1.0] — 2026-05-20

### Added

- Three-tier skill system: `/scan` (one-shot, blockers only), `/critique` (persistent),
  `/rigorous` (five-phase protocol).

## [1.0.2] — 2026-05-20

### Fixed

- Directory-source install and language detection from the plugin cache.

## [1.0.1] — 2026-05-19

### Changed

- Homepage moved to <https://critique.developercorp.com>.

## [1.0.0] — 2026-05-19

### Added

- Initial release: `/critique` and `/rigorous` skills, `SessionStart` and `UserPromptSubmit`
  hooks, statusline badge renderers for bash and PowerShell.

[1.5.0]: https://github.com/Alfafis/critique/releases/tag/critique--v1.5.0
[1.4.0]: https://github.com/Alfafis/critique/releases/tag/critique--v1.4.0
[1.3.1]: https://github.com/Alfafis/critique/releases/tag/critique--v1.3.1
[1.3.0]: https://github.com/Alfafis/critique/releases/tag/critique--v1.3.0
[1.2.0]: https://github.com/Alfafis/critique/releases/tag/critique--v1.2.0
