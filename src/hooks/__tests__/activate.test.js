'use strict';
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const ACTIVATE_PATH = path.resolve(__dirname, '..', 'critica-activate.js');
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..', '..');

let tmpDir;
let mod;
let settingsPath;

function freshRequire(modPath) {
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'critique-activate-'));
  process.env.CLAUDE_CONFIG_DIR = tmpDir;
  process.env.CLAUDE_PLUGIN_ROOT = PLUGIN_ROOT;
  settingsPath = path.join(tmpDir, 'settings.json');
  mod = freshRequire(ACTIVATE_PATH);
}

function teardown() {
  delete require.cache[require.resolve(ACTIVATE_PATH)];
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CLAUDE_PLUGIN_ROOT;
}

function critiqueHook(script) {
  return { type: 'command', command: '"/usr/bin/node" "/cache/critique/1.3.1/src/hooks/' + script + '"' };
}

describe('safeWriteFlag', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('writes content to file', () => {
    const fp = path.join(tmpDir, '.critique-active');
    mod.safeWriteFlag(fp, 'active:en:12345');
    assert.equal(fs.readFileSync(fp, 'utf8'), 'active:en:12345');
  });

  test('overwrites existing content', () => {
    const fp = path.join(tmpDir, '.critique-active');
    mod.safeWriteFlag(fp, 'active:en:111');
    mod.safeWriteFlag(fp, 'active:pt:222');
    assert.equal(fs.readFileSync(fp, 'utf8'), 'active:pt:222');
  });

  test('never writes through a symlink to its target (unix only)', () => {
    if (process.platform === 'win32') return;
    const real = path.join(tmpDir, 'real.txt');
    const link = path.join(tmpDir, 'link.txt');
    fs.writeFileSync(real, 'original');
    fs.symlinkSync(real, link);
    mod.safeWriteFlag(link, 'injected');
    assert.equal(fs.readFileSync(real, 'utf8'), 'original');
  });

  test('replaces a symlinked flag with a real file instead of dead-ending (unix only)', () => {
    if (process.platform === 'win32') return;
    const real = path.join(tmpDir, 'real.txt');
    const link = path.join(tmpDir, '.critique-active');
    fs.writeFileSync(real, 'original');
    fs.symlinkSync(real, link);
    mod.safeWriteFlag(link, 'active:pt:123');
    assert.equal(fs.lstatSync(link).isSymbolicLink(), false, 'flag must recover to a real file');
    assert.equal(fs.readFileSync(link, 'utf8'), 'active:pt:123');
    assert.equal(fs.readFileSync(real, 'utf8'), 'original', 'target must be untouched');
  });

  test('refuses when the containing directory is a symlink (unix only)', () => {
    if (process.platform === 'win32') return;
    const realDir = path.join(tmpDir, 'realdir');
    const linkDir = path.join(tmpDir, 'linkdir');
    fs.mkdirSync(realDir);
    fs.symlinkSync(realDir, linkDir);
    mod.safeWriteFlag(path.join(linkDir, '.critique-active'), 'active:pt:123');
    assert.equal(fs.readdirSync(realDir).length, 0);
  });

  test('a symlinked flag recovers across a full activate + tracker cycle (unix only)', () => {
    if (process.platform === 'win32') return;
    const real = path.join(tmpDir, 'victim.txt');
    const flag = path.join(tmpDir, '.critique-active');
    fs.writeFileSync(real, 'victim');
    fs.symlinkSync(real, flag);
    const tracker = freshRequire(path.resolve(__dirname, '..', 'critica-tracker.js'));
    assert.equal(tracker.handlePrompt('review this', flag), null, 'stays silent while symlinked');
    mod.safeWriteFlag(flag, 'active:pt:' + Math.floor(Date.now() / 1000)); // next SessionStart
    assert.notEqual(tracker.handlePrompt('review this', flag), null, 'injects again after recovery');
    assert.equal(fs.readFileSync(real, 'utf8'), 'victim');
  });
});

describe('readSettings', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('returns {} when file is absent', () => {
    assert.deepEqual(mod.readSettings(settingsPath), {});
  });

  test('returns {} for an empty file', () => {
    fs.writeFileSync(settingsPath, '   \n');
    assert.deepEqual(mod.readSettings(settingsPath), {});
  });

  test('parses valid JSON object', () => {
    fs.writeFileSync(settingsPath, '{"model":"opus"}');
    assert.deepEqual(mod.readSettings(settingsPath), { model: 'opus' });
  });

  test('returns UNREADABLE for malformed JSON — never {}', () => {
    fs.writeFileSync(settingsPath, '{"model":"opus",');
    const result = mod.readSettings(settingsPath);
    assert.equal(result, mod.UNREADABLE);
    assert.notDeepEqual(result, {});
  });

  test('returns UNREADABLE for a JSON array', () => {
    fs.writeFileSync(settingsPath, '[1,2,3]');
    assert.equal(mod.readSettings(settingsPath), mod.UNREADABLE);
  });

  test('returns UNREADABLE for JSON null', () => {
    fs.writeFileSync(settingsPath, 'null');
    assert.equal(mod.readSettings(settingsPath), mod.UNREADABLE);
  });
});

describe('settings.json is never clobbered', () => {
  beforeEach(setup);
  afterEach(teardown);

  const CORRUPT = '{\n "model":"opus",\n "permissions":{"allow":["Bash(npm:*)"]},\n "env":{"FOO":"bar"},\n';

  test('cleanupLegacyHooks leaves a malformed settings.json byte-identical', () => {
    fs.writeFileSync(settingsPath, CORRUPT);
    mod.cleanupLegacyHooks();
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), CORRUPT);
  });

  test('setupStatusline leaves a malformed settings.json byte-identical', () => {
    fs.writeFileSync(settingsPath, CORRUPT);
    mod.setupStatusline();
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), CORRUPT);
  });

  test('setupStatusline preserves unrelated keys when settings.json is valid', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ model: 'opus', env: { FOO: 'bar' } }));
    mod.setupStatusline();
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(s.model, 'opus');
    assert.deepEqual(s.env, { FOO: 'bar' });
    assert.equal(s.statusLine.type, 'command');
  });

  test('setupStatusline does not overwrite an existing statusLine', () => {
    const existing = { type: 'command', command: 'echo mine' };
    fs.writeFileSync(settingsPath, JSON.stringify({ statusLine: existing }));
    mod.setupStatusline();
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.deepEqual(s.statusLine, existing);
  });
});

describe('cleanupLegacyHooks', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('removes critique hooks written by versions <= 1.3.1', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [critiqueHook('critica-activate.js')] }],
        UserPromptSubmit: [{ hooks: [critiqueHook('critica-tracker.js')] }],
      }
    }));
    assert.equal(mod.cleanupLegacyHooks(), true);
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(s.hooks, undefined);
  });

  test('preserves third-party hooks in the same event', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: 'node other-hook.js' }] },
          { hooks: [critiqueHook('critica-activate.js')] },
        ]
      }
    }));
    mod.cleanupLegacyHooks();
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const cmds = s.hooks.SessionStart.flatMap(g => g.hooks || []);
    assert.equal(cmds.length, 1);
    assert.ok(cmds[0].command.includes('other-hook'));
  });

  test('preserves a third-party hook sharing a group with a critique hook', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        SessionStart: [{
          matcher: 'startup',
          hooks: [critiqueHook('critica-activate.js'), { type: 'command', command: 'node other.js' }],
        }]
      }
    }));
    mod.cleanupLegacyHooks();
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(s.hooks.SessionStart.length, 1);
    assert.equal(s.hooks.SessionStart[0].matcher, 'startup');
    assert.equal(s.hooks.SessionStart[0].hooks.length, 1);
    assert.ok(s.hooks.SessionStart[0].hooks[0].command.includes('other.js'));
  });

  test('preserves unrelated top-level settings', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      model: 'opus',
      permissions: { allow: ['Bash(npm:*)'] },
      hooks: { SessionStart: [{ hooks: [critiqueHook('critica-activate.js')] }] },
    }));
    mod.cleanupLegacyHooks();
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(s.model, 'opus');
    assert.deepEqual(s.permissions, { allow: ['Bash(npm:*)'] });
  });

  test('no-op and no write when there is nothing to clean', () => {
    const clean = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node other.js' }] }] } });
    fs.writeFileSync(settingsPath, clean);
    assert.equal(mod.cleanupLegacyHooks(), false);
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), clean);
  });

  test('no-op when settings.json is absent', () => {
    assert.equal(mod.cleanupLegacyHooks(), false);
    assert.equal(fs.existsSync(settingsPath), false);
  });

  test('idempotent — second run finds nothing left', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: { SessionStart: [{ hooks: [critiqueHook('critica-activate.js')] }] }
    }));
    assert.equal(mod.cleanupLegacyHooks(), true);
    assert.equal(mod.cleanupLegacyHooks(), false);
  });

  test('releases the lock so a later call can acquire it', () => {
    assert.equal(fs.existsSync(path.join(tmpDir, '.critique-settings.lock')), false);
    mod.cleanupLegacyHooks();
    assert.equal(fs.existsSync(path.join(tmpDir, '.critique-settings.lock')), false);
  });
});

describe('withSettingsLock', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('runs the callback and returns its value', () => {
    assert.equal(mod.withSettingsLock(tmpDir, () => 'done'), 'done');
  });

  test('releases the lock even when the callback throws', () => {
    assert.throws(() => mod.withSettingsLock(tmpDir, () => { throw new Error('boom'); }), /boom/);
    assert.equal(fs.existsSync(path.join(tmpDir, '.critique-settings.lock')), false);
  });

  test('breaks a stale lock left by a killed process', () => {
    const lockDir = path.join(tmpDir, '.critique-settings.lock');
    fs.mkdirSync(lockDir);
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(lockDir, old, old);
    assert.equal(mod.withSettingsLock(tmpDir, () => 'acquired'), 'acquired');
  });
});

describe('detectLang', () => {
  let savedVars;

  beforeEach(() => {
    savedVars = {
      CRITIQUE_LANG: process.env.CRITIQUE_LANG,
      LANG: process.env.LANG,
      LC_ALL: process.env.LC_ALL,
    };
    delete process.env.CRITIQUE_LANG;
    delete process.env.LANG;
    delete process.env.LC_ALL;
    setup();
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedVars)) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
    teardown();
  });

  test('CRITIQUE_LANG=pt returns pt', () => {
    process.env.CRITIQUE_LANG = 'pt';
    assert.equal(freshRequire(ACTIVATE_PATH).detectLang(), 'pt');
  });

  test('CRITIQUE_LANG=pt-BR returns pt', () => {
    process.env.CRITIQUE_LANG = 'pt-BR';
    assert.equal(freshRequire(ACTIVATE_PATH).detectLang(), 'pt');
  });

  test('CRITIQUE_LANG=es returns es', () => {
    process.env.CRITIQUE_LANG = 'es';
    assert.equal(freshRequire(ACTIVATE_PATH).detectLang(), 'es');
  });

  test('CRITIQUE_LANG=fr returns fr', () => {
    process.env.CRITIQUE_LANG = 'fr';
    assert.equal(freshRequire(ACTIVATE_PATH).detectLang(), 'fr');
  });

  test('CRITIQUE_LANG=en returns en (skips LANG check)', () => {
    process.env.CRITIQUE_LANG = 'en';
    process.env.LANG = 'pt_BR.UTF-8';
    assert.equal(freshRequire(ACTIVATE_PATH).detectLang(), 'en');
  });

  test('LANG=pt_BR.UTF-8 returns pt when no CRITIQUE_LANG', () => {
    process.env.LANG = 'pt_BR.UTF-8';
    assert.equal(freshRequire(ACTIVATE_PATH).detectLang(), 'pt');
  });

  test('LANG=es_ES returns es', () => {
    process.env.LANG = 'es_ES.UTF-8';
    assert.equal(freshRequire(ACTIVATE_PATH).detectLang(), 'es');
  });

  test('every detected language has a message', () => {
    for (const lang of ['en', 'pt', 'es', 'fr']) {
      assert.ok(mod.MESSAGES[lang], 'missing message for ' + lang);
    }
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

describe('spliceBadgeCall', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('inserts before a trailing exit so the call is reachable', () => {
    const script = '#!/usr/bin/env bash\nprintf "%s" "$OUT"\nexit 0\n';
    const out = mod.spliceBadgeCall(script, ['BADGE'], false);
    const lines = out.split('\n').filter(Boolean);
    assert.ok(lines.indexOf('BADGE') < lines.indexOf('exit 0'), 'badge must precede exit');
  });

  test('appends when the script has no exit statement', () => {
    const script = '#!/usr/bin/env bash\necho hi\n';
    const out = mod.spliceBadgeCall(script, ['BADGE'], false);
    assert.ok(out.trimEnd().endsWith('BADGE'));
  });

  test('adds a newline when the script does not end with one', () => {
    assert.equal(mod.spliceBadgeCall('echo hi', ['BADGE'], false), 'echo hi\nBADGE\n');
  });

  test('uses only the last exit when several are present', () => {
    const script = 'if [ -z "$X" ]; then\nexit 1\nfi\necho hi\nexit 0\n';
    const out = mod.spliceBadgeCall(script, ['BADGE'], false);
    const lines = out.split('\n');
    assert.equal(lines[lines.indexOf('BADGE') + 1], 'exit 0');
  });

  test('matches PowerShell Exit regardless of case', () => {
    const script = 'Write-Host hi\r\nExit 0\r\n';
    const out = mod.spliceBadgeCall(script, ['BADGE'], true);
    const lines = out.split('\r\n');
    assert.equal(lines[lines.indexOf('BADGE') + 1], 'Exit 0');
  });
});

describe('spliceBadgeCall — line endings', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('a CRLF script stays pure CRLF', () => {
    const script = '# ps1\r\nWrite-Host hi\r\nexit 0\r\n';
    const out = mod.spliceBadgeCall(script, mod.buildBadgeCallBlock('C:\\a\\b.ps1', true), true);
    assert.ok(out.includes('\r\n'));
    assert.equal(out.replace(/\r\n/g, '').includes('\n'), false, 'must not contain a bare LF');
  });

  test('an LF script stays pure LF', () => {
    const script = '#!/bin/bash\necho hi\nexit 0\n';
    const out = mod.spliceBadgeCall(script, mod.buildBadgeCallBlock('/a/b.sh', false), false);
    assert.equal(out.includes('\r'), false, 'must not introduce a CR');
  });

  test('CRLF is preserved when appending with no exit line', () => {
    const script = '# ps1\r\nWrite-Host hi\r\n';
    const out = mod.spliceBadgeCall(script, ['BADGE'], true);
    assert.ok(out.endsWith('BADGE\r\n'));
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
    const badgeDir = path.join(tmpDir, 'dev$user');
    fs.mkdirSync(badgeDir);
    const badgePath = path.join(badgeDir, 'critica-statusline.sh');
    fs.writeFileSync(badgePath, 'printf "[CRITIQUE]"\n');
    const scriptPath = path.join(tmpDir, 'aggregator.sh');
    fs.writeFileSync(scriptPath, '#!/usr/bin/env bash\nprintf "[OTHER]"\nexit 0\n');
    mod.injectIntoBadgeAggregator(
      { type: 'command', command: 'bash "' + scriptPath + '"' }, badgePath, false);
    const out = require('child_process').execSync('bash "' + scriptPath + '"', { encoding: 'utf8' });
    assert.equal(out, '[OTHER][CRITIQUE]');
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

// The .ps1 badge cannot be executed on a machine without PowerShell, so its contract is
// pinned against the .sh one here. Any change to the flag format has to land in both, or
// the badge silently desyncs on one platform.
describe('statusline badge parity — sh vs ps1', () => {
  beforeEach(setup);
  afterEach(teardown);

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
    const tracker = require(path.resolve(__dirname, '..', 'critica-tracker.js'));
    assert.equal(tracker.TTL, 86400);
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

describe('injectIntoBadgeAggregator — windows branch', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('injects into a .ps1 aggregator before its exit', () => {
    const scriptPath = path.join(tmpDir, 'statusline.ps1');
    const badgePath = path.join(tmpDir, 'critica-statusline.ps1');
    fs.writeFileSync(scriptPath, '# aggregator\r\nWrite-Host hi\r\nexit 0\r\n');
    const result = mod.injectIntoBadgeAggregator(
      { type: 'command', command: 'powershell -NoProfile -File "' + scriptPath + '"' }, badgePath, true);
    assert.equal(result, true);
    const lines = fs.readFileSync(scriptPath, 'utf8').split('\r\n');
    const badgeAt = lines.findIndex(l => l.includes('critica-statusline'));
    assert.ok(badgeAt > -1);
    assert.ok(badgeAt < lines.indexOf('exit 0'), 'badge must precede exit');
  });

  test('uses PowerShell comment syntax for the markers', () => {
    const scriptPath = path.join(tmpDir, 'statusline.ps1');
    fs.writeFileSync(scriptPath, 'Write-Host hi\r\n');
    mod.injectIntoBadgeAggregator(
      { type: 'command', command: 'powershell -File "' + scriptPath + '"' },
      path.join(tmpDir, 'critica-statusline.ps1'), true);
    const content = fs.readFileSync(scriptPath, 'utf8');
    assert.ok(content.includes('# >>> critique badge >>>'));
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
    assert.equal(mod.injectIntoBadgeAggregator(
      { type: 'command', command: 'bash "/a/b.sh"' }, '/a/badge.ps1', true), false);
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

  test('injects call into existing bash script', () => {
    const scriptPath = path.join(tmpDir, 'statusline.sh');
    const badgePath = path.join(tmpDir, 'critica-statusline.sh');
    fs.writeFileSync(scriptPath, '#!/bin/bash\necho hi\n');
    const result = mod.injectIntoBadgeAggregator(
      { type: 'command', command: 'bash "' + scriptPath + '"' }, badgePath, false);
    assert.equal(result, true);
    assert.ok(fs.readFileSync(scriptPath, 'utf8').includes('critica-statusline'));
  });

  test('injected call is reachable in a script ending with exit 0', () => {
    const scriptPath = path.join(tmpDir, 'aggregator.sh');
    const badgePath = path.join(tmpDir, 'critica-statusline.sh');
    fs.writeFileSync(badgePath, 'printf "[CRITIQUE]"\n');
    fs.writeFileSync(scriptPath, '#!/usr/bin/env bash\nprintf "%s" "[OTHER]"\nexit 0\n');
    mod.injectIntoBadgeAggregator(
      { type: 'command', command: 'bash "' + scriptPath + '"' }, badgePath, false);
    const out = require('child_process').execSync('bash "' + scriptPath + '"', { encoding: 'utf8' });
    assert.equal(out, '[OTHER][CRITIQUE]');
  });

  test('wraps the injected call in removable markers', () => {
    const scriptPath = path.join(tmpDir, 'statusline.sh');
    const badgePath = path.join(tmpDir, 'critica-statusline.sh');
    fs.writeFileSync(scriptPath, '#!/bin/bash\necho hi\n');
    mod.injectIntoBadgeAggregator(
      { type: 'command', command: 'bash "' + scriptPath + '"' }, badgePath, false);
    const content = fs.readFileSync(scriptPath, 'utf8');
    assert.ok(content.includes('# >>> critique badge >>>'));
    assert.ok(content.includes('# <<< critique badge <<<'));
  });

  test('returns false when target script does not exist', () => {
    const scriptPath = path.join(tmpDir, 'nonexistent.sh');
    const badgePath = path.join(tmpDir, 'critica-statusline.sh');
    const result = mod.injectIntoBadgeAggregator(
      { type: 'command', command: 'bash "' + scriptPath + '"' }, badgePath, false);
    assert.equal(result, false);
  });

  test('returns true without modifying when targetScript IS the badge script', () => {
    const badgePath = path.join(tmpDir, 'critica-statusline.sh');
    fs.writeFileSync(badgePath, '#!/bin/bash\necho hi\n');
    const contentBefore = fs.readFileSync(badgePath, 'utf8');
    const result = mod.injectIntoBadgeAggregator(
      { type: 'command', command: 'bash "' + badgePath + '"' }, badgePath, false);
    assert.equal(result, true);
    assert.equal(fs.readFileSync(badgePath, 'utf8'), contentBefore);
  });

  test('idempotent — already injected script not modified again', () => {
    const scriptPath = path.join(tmpDir, 'statusline.sh');
    const badgePath = path.join(tmpDir, 'critica-statusline.sh');
    fs.writeFileSync(scriptPath, '#!/bin/bash\nbash "' + badgePath + '"\n');
    const before = fs.readFileSync(scriptPath, 'utf8');
    mod.injectIntoBadgeAggregator(
      { type: 'command', command: 'bash "' + scriptPath + '"' }, badgePath, false);
    assert.equal(fs.readFileSync(scriptPath, 'utf8'), before);
  });
});
