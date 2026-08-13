'use strict';
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

const BADGE_PATH = path.resolve(__dirname, '..', 'critica-badge.js');
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..', '..');

let tmpDir;
let mod;
let settingsPath;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'critique-badge-'));
  process.env.CLAUDE_CONFIG_DIR = tmpDir;
  process.env.CLAUDE_PLUGIN_ROOT = PLUGIN_ROOT;
  settingsPath = path.join(tmpDir, 'settings.json');
  delete require.cache[require.resolve(BADGE_PATH)];
  mod = require(BADGE_PATH);
}

function teardown() {
  delete require.cache[require.resolve(BADGE_PATH)];
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CLAUDE_PLUGIN_ROOT;
}

function readSettings() {
  return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
}

describe('install — opt-in behaviour', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('registers statusLine when the user has none', () => {
    const r = mod.install(tmpDir, false);
    assert.equal(r.ok, true);
    assert.equal(readSettings().statusLine.type, 'command');
    assert.equal(mod.isInstalled(tmpDir, false), true);
  });

  test('copies the badge script and makes it executable (unix only)', () => {
    if (process.platform === 'win32') return;
    mod.install(tmpDir, false);
    const dest = mod.badgeDestPath(tmpDir, false);
    assert.equal(fs.statSync(dest).isFile(), true);
    assert.ok(fs.statSync(dest).mode & 0o111, 'badge script must be executable');
  });

  test('the installed badge actually renders while critique is active', () => {
    if (process.platform === 'win32') return;
    mod.install(tmpDir, false);
    fs.writeFileSync(path.join(tmpDir, '.critique-active'), 'active:pt:' + Math.floor(Date.now() / 1000));
    const out = execSync(readSettings().statusLine.command, {
      encoding: 'utf8',
      env: Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: tmpDir }),
    });
    assert.ok(out.includes('[CRITIQUE]'));
  });

  test('splices into an existing statusline script instead of replacing it', () => {
    const script = path.join(tmpDir, 'mine.sh');
    fs.writeFileSync(script, '#!/usr/bin/env bash\nprintf "[OTHER]"\nexit 0\n');
    fs.writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: 'command', command: 'bash "' + script + '"' } }));
    const r = mod.install(tmpDir, false);
    assert.equal(r.ok, true);
    assert.equal(readSettings().statusLine.command, 'bash "' + script + '"', 'must not hijack the statusLine');
    assert.ok(fs.readFileSync(script, 'utf8').includes('critica-statusline'));
  });

  test('the spliced call is reachable past a trailing exit 0', () => {
    if (process.platform === 'win32') return;
    const script = path.join(tmpDir, 'mine.sh');
    fs.writeFileSync(script, '#!/usr/bin/env bash\nprintf "[OTHER]"\nexit 0\n');
    fs.writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: 'command', command: 'bash "' + script + '"' } }));
    mod.install(tmpDir, false);
    fs.writeFileSync(path.join(tmpDir, '.critique-active'), 'active:pt:' + Math.floor(Date.now() / 1000));
    const out = execSync('bash "' + script + '"', {
      encoding: 'utf8',
      env: Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: tmpDir }),
    });
    // The real badge emits ANSI colour, so compare the plain text and the order.
    const plain = out.replace(/\x1B\[[0-9;]*m/g, '');
    assert.equal(plain, '[OTHER][CRITIQUE]');
  });

  test('refuses to write over a malformed settings.json', () => {
    const corrupt = '{\n "model":"opus",\n';
    fs.writeFileSync(settingsPath, corrupt);
    const r = mod.install(tmpDir, false);
    assert.equal(r.ok, false);
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), corrupt);
  });

  test('reports failure when the statusLine is not a shell script', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: 'command', command: 'echo hi' } }));
    const r = mod.install(tmpDir, false);
    assert.equal(r.ok, false);
    assert.match(r.message, /not a shell script/);
  });

  test('idempotent — installing twice does not duplicate the block', () => {
    const script = path.join(tmpDir, 'mine.sh');
    fs.writeFileSync(script, '#!/usr/bin/env bash\nprintf "[OTHER]"\n');
    fs.writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: 'command', command: 'bash "' + script + '"' } }));
    mod.install(tmpDir, false);
    const after = fs.readFileSync(script, 'utf8');
    mod.install(tmpDir, false);
    assert.equal(fs.readFileSync(script, 'utf8'), after);
  });
});

describe('uninstall', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('removes the statusLine entry this plugin registered', () => {
    mod.install(tmpDir, false);
    const r = mod.uninstall(tmpDir, false);
    assert.equal(r.ok, true);
    assert.equal(readSettings().statusLine, undefined);
    assert.equal(mod.isInstalled(tmpDir, false), false);
  });

  test('removes only the marked block from a script the user owns', () => {
    const script = path.join(tmpDir, 'mine.sh');
    const original = '#!/usr/bin/env bash\nprintf "[OTHER]"\nexit 0\n';
    fs.writeFileSync(script, original);
    fs.writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: 'command', command: 'bash "' + script + '"' } }));
    mod.install(tmpDir, false);
    mod.uninstall(tmpDir, false);
    assert.equal(fs.readFileSync(script, 'utf8'), original, 'script must return to its original content');
  });

  test('leaves a statusLine the user set themselves alone', () => {
    const script = path.join(tmpDir, 'mine.sh');
    fs.writeFileSync(script, '#!/usr/bin/env bash\nprintf "[OTHER]"\n');
    const statusLine = { type: 'command', command: 'bash "' + script + '"' };
    fs.writeFileSync(settingsPath, JSON.stringify({ statusLine }));
    mod.install(tmpDir, false);
    mod.uninstall(tmpDir, false);
    assert.deepEqual(readSettings().statusLine, statusLine);
  });

  test('is safe to run when nothing is installed', () => {
    const r = mod.uninstall(tmpDir, false);
    assert.equal(r.ok, true);
    assert.match(r.message, /not installed|nothing to do/i);
  });

  test('refuses to write over a malformed settings.json', () => {
    const corrupt = '{"statusLine":';
    fs.writeFileSync(settingsPath, corrupt);
    assert.equal(mod.uninstall(tmpDir, false).ok, false);
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), corrupt);
  });
});

describe('status', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('reports not installed on a clean config', () => {
    assert.equal(mod.status(tmpDir, false).installed, false);
  });

  test('reports installed after install', () => {
    mod.install(tmpDir, false);
    assert.equal(mod.status(tmpDir, false).installed, true);
  });
});

describe('refreshIfInstalled', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('does nothing when the badge was never installed', () => {
    assert.equal(mod.refreshIfInstalled(tmpDir, false), false);
    assert.equal(fs.existsSync(mod.badgeDestPath(tmpDir, false)), false);
  });

  test('never creates a settings.json', () => {
    mod.refreshIfInstalled(tmpDir, false);
    assert.equal(fs.existsSync(settingsPath), false);
  });

  test('updates a stale copy the user already installed', () => {
    mod.install(tmpDir, false);
    const dest = mod.badgeDestPath(tmpDir, false);
    fs.writeFileSync(dest, '# stale\n');
    assert.equal(mod.refreshIfInstalled(tmpDir, false), true);
    assert.equal(fs.readFileSync(dest, 'utf8'), fs.readFileSync(path.resolve(__dirname, '..', 'critica-statusline.sh'), 'utf8'));
  });

  test('does not touch settings.json when refreshing', () => {
    mod.install(tmpDir, false);
    const before = fs.readFileSync(settingsPath, 'utf8');
    mod.refreshIfInstalled(tmpDir, false);
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), before);
  });
});

describe('removeBadgeCall', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('removes the block and nothing else', () => {
    const content = 'a\n' + mod.BADGE_BEGIN + '\ncall\n' + mod.BADGE_END + '\nb\n';
    const { content: out, removed } = mod.removeBadgeCall(content);
    assert.equal(removed, true);
    assert.equal(out, 'a\nb\n');
  });

  test('reports nothing removed when no block is present', () => {
    const { content: out, removed } = mod.removeBadgeCall('a\nb\n');
    assert.equal(removed, false);
    assert.equal(out, 'a\nb\n');
  });

  test('preserves CRLF', () => {
    const content = 'a\r\n' + mod.BADGE_BEGIN + '\r\ncall\r\n' + mod.BADGE_END + '\r\nb\r\n';
    const { content: out } = mod.removeBadgeCall(content);
    assert.equal(out, 'a\r\nb\r\n');
  });

  test('round-trips with spliceBadgeCall', () => {
    const original = '#!/usr/bin/env bash\nprintf hi\nexit 0\n';
    const spliced = mod.spliceBadgeCall(original, mod.buildBadgeCallBlock('/a/b.sh', false));
    assert.notEqual(spliced, original);
    assert.equal(mod.removeBadgeCall(spliced).content, original);
  });
});

describe('spliceBadgeCall', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('inserts before a trailing exit so the call is reachable', () => {
    const out = mod.spliceBadgeCall('#!/usr/bin/env bash\nprintf "%s" "$OUT"\nexit 0\n', ['BADGE']);
    const lines = out.split('\n').filter(Boolean);
    assert.ok(lines.indexOf('BADGE') < lines.indexOf('exit 0'), 'badge must precede exit');
  });

  test('appends when the script has no exit statement', () => {
    assert.ok(mod.spliceBadgeCall('#!/usr/bin/env bash\necho hi\n', ['BADGE']).trimEnd().endsWith('BADGE'));
  });

  test('adds a newline when the script does not end with one', () => {
    assert.equal(mod.spliceBadgeCall('echo hi', ['BADGE']), 'echo hi\nBADGE\n');
  });

  test('uses only the last exit when several are present', () => {
    const out = mod.spliceBadgeCall('if [ -z "$X" ]; then\nexit 1\nfi\necho hi\nexit 0\n', ['BADGE']);
    const lines = out.split('\n');
    assert.equal(lines[lines.indexOf('BADGE') + 1], 'exit 0');
  });

  test('matches PowerShell Exit regardless of case', () => {
    const out = mod.spliceBadgeCall('Write-Host hi\r\nExit 0\r\n', ['BADGE']);
    const lines = out.split('\r\n');
    assert.equal(lines[lines.indexOf('BADGE') + 1], 'Exit 0');
  });

  test('a CRLF script stays pure CRLF', () => {
    const out = mod.spliceBadgeCall('# ps1\r\nWrite-Host hi\r\nexit 0\r\n', mod.buildBadgeCallBlock('C:\\a\\b.ps1', true));
    assert.ok(out.includes('\r\n'));
    assert.equal(out.replace(/\r\n/g, '').includes('\n'), false, 'must not contain a bare LF');
  });

  test('an LF script stays pure LF', () => {
    const out = mod.spliceBadgeCall('#!/bin/bash\necho hi\nexit 0\n', mod.buildBadgeCallBlock('/a/b.sh', false));
    assert.equal(out.includes('\r'), false, 'must not introduce a CR');
  });

  test('CRLF is preserved when appending with no exit line', () => {
    assert.ok(mod.spliceBadgeCall('# ps1\r\nWrite-Host hi\r\n', ['BADGE']).endsWith('BADGE\r\n'));
  });
});

describe('shell quoting', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('bash block single-quotes the path so $ is not expanded', () => {
    const block = mod.buildBadgeCallBlock('/home/dev$user/critica-statusline.sh', false).join('\n');
    assert.ok(block.includes("'/home/dev$user/critica-statusline.sh'"));
    assert.equal(block.includes('"'), false);
  });

  test('a path with $ survives execution by bash', () => {
    if (process.platform === 'win32') return;
    const badgeDir = path.join(tmpDir, 'dev$user');
    fs.mkdirSync(badgeDir);
    const badgePath = path.join(badgeDir, 'critica-statusline.sh');
    fs.writeFileSync(badgePath, 'printf "[CRITIQUE]"\n');
    const scriptPath = path.join(tmpDir, 'aggregator.sh');
    fs.writeFileSync(scriptPath, '#!/usr/bin/env bash\nprintf "[OTHER]"\nexit 0\n');
    mod.injectIntoBadgeAggregator({ type: 'command', command: 'bash "' + scriptPath + '"' }, badgePath, false);
    assert.equal(execSync('bash "' + scriptPath + '"', { encoding: 'utf8' }), '[OTHER][CRITIQUE]');
  });

  test('powershell block single-quotes the path', () => {
    const block = mod.buildBadgeCallBlock('C:\\Users\\dev$u\\critica-statusline.ps1', true).join('\n');
    assert.ok(block.includes("'C:\\Users\\dev$u\\critica-statusline.ps1'"));
    assert.equal(block.includes('"'), false);
  });

  test('powershell escapes an embedded single quote by doubling it', () => {
    assert.equal(mod.powershellQuote("C:\\a'b"), "'C:\\a''b'");
  });

  test('bash escapes an embedded single quote', () => {
    assert.equal(mod.shellQuote("/a'b"), "'/a'\\''b'");
  });
});

describe('buildStatusLineCommand', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('windows uses powershell -File with double quotes (cmd.exe cannot parse single quotes)', () => {
    const cmd = mod.buildStatusLineCommand('C:\\Users\\dev\\.claude\\hooks\\critica-statusline.ps1', true);
    assert.ok(cmd.startsWith('powershell -NoProfile -ExecutionPolicy Bypass -File "'));
    assert.equal(cmd.includes("'"), false);
  });

  test('windows path keeps single backslashes — JSON serialization does the escaping', () => {
    const raw = 'C:\\Users\\dev\\.claude\\hooks\\critica-statusline.ps1';
    const cmd = mod.buildStatusLineCommand(raw, true);
    assert.ok(cmd.includes(raw));
    assert.equal(cmd.includes('\\\\'), false, 'pre-escaping produced literal double backslashes');
    assert.equal(JSON.parse(JSON.stringify({ c: cmd })).c, cmd, 'must round-trip through JSON');
  });

  test('unix uses bash', () => {
    assert.equal(mod.buildStatusLineCommand('/h/.claude/hooks/critica-statusline.sh', false),
      'bash "/h/.claude/hooks/critica-statusline.sh"');
  });

  test('the generated command is parseable by extractScriptPath on both platforms', () => {
    const win = 'C:\\a\\critica-statusline.ps1';
    const nix = '/a/critica-statusline.sh';
    assert.equal(mod.extractScriptPath(mod.buildStatusLineCommand(win, true), 'ps1'), win);
    assert.equal(mod.extractScriptPath(mod.buildStatusLineCommand(nix, false), 'sh'), nix);
  });
});

describe('extractScriptPath', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('quoted path', () => {
    assert.equal(mod.extractScriptPath('bash "/a/b/status.sh"', 'sh'), '/a/b/status.sh');
  });

  test('quoted path containing spaces', () => {
    assert.equal(mod.extractScriptPath('bash "/a b/my status.sh"', 'sh'), '/a b/my status.sh');
  });

  test('single-quoted path', () => {
    assert.equal(mod.extractScriptPath("bash '/a/b/status.sh'", 'sh'), '/a/b/status.sh');
  });

  test('unquoted path', () => {
    assert.equal(mod.extractScriptPath('bash /a/b/status.sh', 'sh'), '/a/b/status.sh');
  });

  test('sh instead of bash', () => {
    assert.equal(mod.extractScriptPath('sh /a/b/status.sh', 'sh'), '/a/b/status.sh');
  });

  test('bare executable path with no interpreter', () => {
    assert.equal(mod.extractScriptPath('/a/b/status.sh', 'sh'), '/a/b/status.sh');
  });

  test('powershell -File form', () => {
    assert.equal(mod.extractScriptPath('powershell -NoProfile -File "C:\\a\\s.ps1"', 'ps1'), 'C:\\a\\s.ps1');
  });

  test('returns null when no script is present', () => {
    assert.equal(mod.extractScriptPath('echo hello', 'sh'), null);
  });
});

describe('injectIntoBadgeAggregator — windows branch', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('injects into a .ps1 aggregator before its exit', () => {
    const scriptPath = path.join(tmpDir, 'statusline.ps1');
    const badgePath = path.join(tmpDir, 'critica-statusline.ps1');
    fs.writeFileSync(scriptPath, '# aggregator\r\nWrite-Host hi\r\nexit 0\r\n');
    assert.equal(mod.injectIntoBadgeAggregator(
      { type: 'command', command: 'powershell -NoProfile -File "' + scriptPath + '"' }, badgePath, true), true);
    const lines = fs.readFileSync(scriptPath, 'utf8').split('\r\n');
    const badgeAt = lines.findIndex(l => l.includes('critica-statusline'));
    assert.ok(badgeAt > -1);
    assert.ok(badgeAt < lines.indexOf('exit 0'), 'badge must precede exit');
  });

  test('uses PowerShell comment syntax for the markers', () => {
    const scriptPath = path.join(tmpDir, 'statusline.ps1');
    fs.writeFileSync(scriptPath, 'Write-Host hi\r\n');
    mod.injectIntoBadgeAggregator({ type: 'command', command: 'powershell -File "' + scriptPath + '"' },
      path.join(tmpDir, 'critica-statusline.ps1'), true);
    const content = fs.readFileSync(scriptPath, 'utf8');
    assert.ok(content.includes(mod.BADGE_BEGIN));
    assert.ok(content.includes('Test-Path'));
  });

  test('idempotent on windows', () => {
    const scriptPath = path.join(tmpDir, 'statusline.ps1');
    const badgePath = path.join(tmpDir, 'critica-statusline.ps1');
    fs.writeFileSync(scriptPath, 'Write-Host hi\r\n');
    const statusLine = { type: 'command', command: 'powershell -File "' + scriptPath + '"' };
    mod.injectIntoBadgeAggregator(statusLine, badgePath, true);
    const after = fs.readFileSync(scriptPath, 'utf8');
    mod.injectIntoBadgeAggregator(statusLine, badgePath, true);
    assert.equal(fs.readFileSync(scriptPath, 'utf8'), after);
  });

  test('does not match a .sh path when looking for .ps1', () => {
    assert.equal(mod.injectIntoBadgeAggregator({ type: 'command', command: 'bash "/a/b.sh"' }, '/a/badge.ps1', true), false);
  });
});

describe('injectIntoBadgeAggregator', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('returns false for non-command statusLine', () => {
    assert.equal(mod.injectIntoBadgeAggregator({ type: 'static', value: 'x' }, '/badge.sh', false), false);
  });

  test('returns false for a null statusLine', () => {
    assert.equal(mod.injectIntoBadgeAggregator(null, '/badge.sh', false), false);
  });

  test('returns false when command has no recognizable script path', () => {
    assert.equal(mod.injectIntoBadgeAggregator({ type: 'command', command: 'echo hello' }, '/badge.sh', false), false);
  });

  test('returns false when target script does not exist', () => {
    assert.equal(mod.injectIntoBadgeAggregator(
      { type: 'command', command: 'bash "' + path.join(tmpDir, 'nope.sh') + '"' },
      path.join(tmpDir, 'critica-statusline.sh'), false), false);
  });

  test('returns true without modifying when targetScript IS the badge script', () => {
    const badgePath = path.join(tmpDir, 'critica-statusline.sh');
    fs.writeFileSync(badgePath, '#!/bin/bash\necho hi\n');
    const before = fs.readFileSync(badgePath, 'utf8');
    assert.equal(mod.injectIntoBadgeAggregator(
      { type: 'command', command: 'bash "' + badgePath + '"' }, badgePath, false), true);
    assert.equal(fs.readFileSync(badgePath, 'utf8'), before);
  });
});

// The .ps1 badge cannot be executed on a machine without PowerShell, so its contract is
// pinned against the .sh one here. Any change to the flag format has to land in both, or
// the badge silently desyncs on one platform.
describe('statusline badge parity — sh vs ps1', () => {
  const sh = fs.readFileSync(path.resolve(__dirname, '..', 'critica-statusline.sh'), 'utf8');
  const ps1 = fs.readFileSync(path.resolve(__dirname, '..', 'critica-statusline.ps1'), 'utf8');

  test('both gate on the active state only, so off never renders', () => {
    assert.ok(sh.includes('^active:[a-z]{2}:'));
    assert.ok(ps1.includes('^active:[a-z]{2}:'));
  });

  test('neither accepts the off state', () => {
    assert.equal(/\boff:/.test(sh), false);
    assert.equal(/\boff:/.test(ps1), false);
  });

  test('both use the same 24h TTL as the tracker', () => {
    assert.equal(require(path.resolve(__dirname, '..', 'critica-tracker.js')).TTL, 86400);
    assert.ok(sh.includes('86400'));
    assert.ok(ps1.includes('86400'));
  });

  test('both enforce the 64-byte cap', () => {
    assert.ok(sh.includes('64'));
    assert.ok(ps1.includes('64'));
  });

  test('both reject symlinks / reparse points', () => {
    assert.ok(sh.includes('-L '));
    assert.ok(ps1.includes('ReparsePoint'));
  });

  test('both honour CLAUDE_CONFIG_DIR', () => {
    assert.ok(sh.includes('CLAUDE_CONFIG_DIR'));
    assert.ok(ps1.includes('CLAUDE_CONFIG_DIR'));
  });

  // Contract is "never exit non-zero", not "same number of guards": the .ps1 needs an
  // explicit catch around Get-Item where the .sh gets the same coverage from an empty
  // $CONTENT falling through to the regex check.
  test('neither script can exit non-zero — that would hide the whole status bar', () => {
    assert.equal(/exit\s+[1-9]/i.test(sh), false);
    assert.equal(/exit\s+[1-9]/i.test(ps1), false);
  });

  test('both have at least as many guards as rejection reasons', () => {
    assert.ok((sh.match(/exit 0/g) || []).length >= 5);
    assert.ok((ps1.match(/exit 0/g) || []).length >= 5);
  });
});
