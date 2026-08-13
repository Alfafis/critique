#!/usr/bin/env node
// critique — statusline badge installer
//
// Opt-in by design. Nothing here runs from SessionStart except refreshIfInstalled(),
// which updates a badge script the user already chose to install. Installing writes to
// ~/.claude/settings.json and, when the user already owns a statusline script, appends
// a call into it — both are changes to config outside the plugin's own directory, so
// they happen only when the user asks for them via /critique:badge.

const fs = require('fs');
const path = require('path');

const S = require('./critica-settings.js');

const BADGE_BEGIN = '# >>> critique badge >>>';
const BADGE_END = '# <<< critique badge <<<';

function pluginRoot() {
  return process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..', '..');
}

function scriptName(isWindows) {
  return isWindows ? 'critica-statusline.ps1' : 'critica-statusline.sh';
}

function badgeDestPath(dir, isWindows) {
  return path.join(dir, 'hooks', scriptName(isWindows));
}

function badgeSrcPath(isWindows) {
  return path.join(pluginRoot(), 'src', 'hooks', scriptName(isWindows));
}

// The statusLine command is handed to a shell by Claude Code. On Windows that shell is
// cmd.exe, which does not treat single quotes as quoting — a single-quoted path would
// reach powershell.exe with the quotes intact and -File would fail. Double quotes are
// required there. The backslashes are NOT escaped: JSON.stringify handles that when
// settings.json is serialized, and pre-escaping produced a literal C:\\dir\\x.ps1.
function buildStatusLineCommand(destPath, isWindows) {
  return isWindows
    ? 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + destPath + '"'
    : 'bash "' + destPath + '"';
}

function extractScriptPath(cmd, extension) {
  for (const quote of ['"', "'"]) {
    const m = cmd.match(new RegExp(quote + '([^' + quote + ']+\\.' + extension + ')' + quote, 'i'));
    if (m) return m[1];
  }
  const bare = cmd.match(new RegExp('(\\S+\\.' + extension + ')', 'i'));
  return bare ? bare[1] : null;
}

// Single-quote for the shell that will actually parse the injected line. Both bash and
// PowerShell interpolate inside double quotes, so a path containing $ (legal in a
// Windows username, e.g. C:\Users\dev$\...) would be mangled. Neither expands inside
// single quotes; both escape an embedded single quote by their own rule.
function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function powershellQuote(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function buildBadgeCallBlock(badgePath, isWindows) {
  if (isWindows) {
    const p = powershellQuote(badgePath);
    return [BADGE_BEGIN, 'if (Test-Path ' + p + ') { & ' + p + ' }', BADGE_END];
  }
  const p = shellQuote(badgePath);
  return [BADGE_BEGIN, '[ -f ' + p + ' ] && bash ' + p, BADGE_END];
}

function detectEol(content) {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

// Splices the badge call into the user's own statusline script, delimited by markers
// so it can be located and removed later. Appending blindly is wrong: aggregator
// scripts commonly end in `exit 0`, which makes a trailing line unreachable — the
// badge silently never renders while this function reports success.
//
// blockLines is a line array, not a pre-joined string, so the target file's own line
// ending wins. Splicing LF lines into a CRLF .ps1 leaves mixed endings.
function spliceBadgeCall(content, blockLines) {
  const block = Array.isArray(blockLines) ? blockLines : String(blockLines).split(/\r?\n/);
  const eol = detectEol(content);
  const lines = content.split(/\r?\n/);
  let insertAt = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*exit\b/i.test(lines[i])) { insertAt = i; break; }
  }
  if (insertAt === -1) {
    const needsEol = content.length > 0 && !/\r?\n$/.test(content);
    return content + (needsEol ? eol : '') + block.join(eol) + eol;
  }
  lines.splice(insertAt, 0, ...block);
  return lines.join(eol);
}

// Removes the marked block and nothing else. Content outside the markers is never
// touched, so a script the user edited around our block survives intact.
function removeBadgeCall(content) {
  const eol = detectEol(content);
  const lines = content.split(/\r?\n/);
  const out = [];
  let inside = false;
  let removed = false;
  for (const line of lines) {
    if (!inside && line.trim() === BADGE_BEGIN) { inside = true; removed = true; continue; }
    if (inside) {
      if (line.trim() === BADGE_END) inside = false;
      continue;
    }
    out.push(line);
  }
  return { content: out.join(eol), removed };
}

function injectIntoBadgeAggregator(statusLine, badgePath, isWindows) {
  try {
    if (!statusLine || statusLine.type !== 'command') return false;
    const target = extractScriptPath(statusLine.command || '', isWindows ? 'ps1' : 'sh');
    if (!target) return false;
    if (path.resolve(target) === path.resolve(badgePath)) return true;

    let content;
    try { content = fs.readFileSync(target, 'utf8'); } catch (e) { return false; }
    if (content.includes('critica-statusline')) return true;

    fs.writeFileSync(target, spliceBadgeCall(content, buildBadgeCallBlock(badgePath, isWindows)), { encoding: 'utf8' });
    return true;
  } catch (e) {
    S.debug('inject', e.message);
    return false;
  }
}

function isInstalled(dir, isWindows) {
  try { return fs.statSync(badgeDestPath(dir, isWindows)).isFile(); } catch (e) { return false; }
}

// SessionStart calls this. It only refreshes a script the user already installed, so a
// flag-format change reaches existing badges without the plugin ever creating one on
// its own. It never registers anything and never writes to settings.json.
function refreshIfInstalled(dir, isWindows) {
  try {
    if (!isInstalled(dir, isWindows)) return false;
    const dest = badgeDestPath(dir, isWindows);
    fs.copyFileSync(badgeSrcPath(isWindows), dest);
    if (!isWindows) fs.chmodSync(dest, 0o755);
    return true;
  } catch (e) {
    S.debug('refresh', e.message);
    return false;
  }
}

function install(dir, isWindows) {
  const dest = badgeDestPath(dir, isWindows);
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(badgeSrcPath(isWindows), dest);
    if (!isWindows) fs.chmodSync(dest, 0o755);
  } catch (e) {
    return { ok: false, message: 'could not copy the badge script: ' + e.message };
  }

  const file = S.settingsPath(dir);
  const result = S.withSettingsLock(dir, () => {
    const settings = S.readSettings(file);
    if (settings === S.UNREADABLE) {
      return { ok: false, message: file + ' is not valid JSON. Fix it and run /critique:badge again.' };
    }
    if (!settings.statusLine) {
      settings.statusLine = { type: 'command', command: buildStatusLineCommand(dest, isWindows) };
      if (!S.writeSettings(file, settings)) {
        return { ok: false, message: 'could not write ' + file };
      }
      return { ok: true, message: 'Badge installed and registered as your statusLine.' };
    }
    if (injectIntoBadgeAggregator(settings.statusLine, dest, isWindows)) {
      return { ok: true, message: 'Badge call added to your existing statusline script.' };
    }
    return {
      ok: false,
      message: 'Your statusLine is not a shell script this can splice into. Call ' + dest + ' from it yourself.',
    };
  });
  return result || { ok: false, message: 'could not acquire the settings lock; try again.' };
}

function uninstall(dir, isWindows) {
  const dest = badgeDestPath(dir, isWindows);
  const file = S.settingsPath(dir);
  const notes = [];

  const result = S.withSettingsLock(dir, () => {
    const settings = S.readSettings(file);
    if (settings === S.UNREADABLE) {
      return { ok: false, message: file + ' is not valid JSON. Fix it and run /critique:badge off again.' };
    }
    const cmd = (settings.statusLine && settings.statusLine.command) || '';
    const target = cmd ? extractScriptPath(cmd, isWindows ? 'ps1' : 'sh') : null;

    if (target && path.resolve(target) === path.resolve(dest)) {
      // We registered it, so we remove it. A statusLine the user set themselves is left alone.
      delete settings.statusLine;
      if (!S.writeSettings(file, settings)) return { ok: false, message: 'could not write ' + file };
      notes.push('statusLine entry removed from settings.json');
    } else if (target) {
      try {
        const before = fs.readFileSync(target, 'utf8');
        const { content, removed } = removeBadgeCall(before);
        if (removed) {
          fs.writeFileSync(target, content, { encoding: 'utf8' });
          notes.push('badge block removed from ' + target);
        }
      } catch (e) {
        notes.push('could not edit ' + target + ': ' + e.message);
      }
    }
    return { ok: true };
  });

  if (result && result.ok === false) return result;

  try {
    fs.unlinkSync(dest);
    notes.push('badge script deleted');
  } catch (e) {
    if (e.code !== 'ENOENT') notes.push('could not delete ' + dest + ': ' + e.message);
  }

  return {
    ok: true,
    message: notes.length ? 'Badge removed — ' + notes.join('; ') + '.' : 'Badge was not installed; nothing to do.',
  };
}

function status(dir, isWindows) {
  const dest = badgeDestPath(dir, isWindows);
  if (!isInstalled(dir, isWindows)) {
    return { installed: false, message: 'Badge is not installed. Run /critique:badge to install it.' };
  }
  const settings = S.readSettings(S.settingsPath(dir));
  const registered = settings !== S.UNREADABLE && !!(settings && settings.statusLine);
  return {
    installed: true,
    message: 'Badge script at ' + dest + (registered ? ', statusLine is set.' : ', but no statusLine is configured.'),
  };
}

if (require.main === module) {
  const dir = S.claudeDir();
  const isWindows = process.platform === 'win32';
  const arg = (process.argv[2] || 'install').toLowerCase();
  let result;
  if (arg === 'off' || arg === 'remove' || arg === 'uninstall') result = uninstall(dir, isWindows);
  else if (arg === 'status') result = status(dir, isWindows);
  else result = install(dir, isWindows);
  process.stdout.write(result.message + '\n');
  process.exit(result.ok === false ? 1 : 0);
}

module.exports = {
  BADGE_BEGIN,
  BADGE_END,
  badgeDestPath,
  buildStatusLineCommand,
  extractScriptPath,
  shellQuote,
  powershellQuote,
  buildBadgeCallBlock,
  spliceBadgeCall,
  removeBadgeCall,
  injectIntoBadgeAggregator,
  isInstalled,
  refreshIfInstalled,
  install,
  uninstall,
  status,
};
