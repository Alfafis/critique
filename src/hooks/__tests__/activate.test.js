'use strict';
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const ACTIVATE_PATH = path.resolve(__dirname, '..', 'critica-activate.js');
const TRACKER_PATH = path.resolve(__dirname, '..', 'critica-tracker.js');
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

  // CI caught this on all three runners: CLAUDE_CONFIG_DIR pointed at a directory that did
  // not exist, writeFileSync threw ENOENT into the empty catch, and the flag was never
  // written. The banner still printed, so the failure was invisible.
  test('creates the config directory when it does not exist', () => {
    const fresh = path.join(tmpDir, 'not-created-yet');
    const flag = path.join(fresh, '.critique-active');
    mod.safeWriteFlag(flag, 'active:pt:123');
    assert.equal(fs.readFileSync(flag, 'utf8'), 'active:pt:123');
  });

  test('creates nested config directories', () => {
    const flag = path.join(tmpDir, 'a', 'b', 'c', '.critique-active');
    mod.safeWriteFlag(flag, 'active:en:1');
    assert.equal(fs.existsSync(flag), true);
  });

  test('the first activation persists the flag, not only the second', () => {
    const fresh = path.join(tmpDir, 'first-run');
    const flag = path.join(fresh, '.critique-active');
    mod.safeWriteFlag(flag, 'active:fr:' + Math.floor(Date.now() / 1000));
    const tracker = freshRequire(TRACKER_PATH);
    assert.notEqual(tracker.handlePrompt('review this', flag), null);
    assert.equal(tracker.parseFlag(flag).lang, 'fr', 'detected language must survive the first run');
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
    const tracker = freshRequire(TRACKER_PATH);
    assert.equal(tracker.handlePrompt('review this', flag), null, 'stays silent while symlinked');
    mod.safeWriteFlag(flag, 'active:pt:' + Math.floor(Date.now() / 1000)); // next SessionStart
    assert.notEqual(tracker.handlePrompt('review this', flag), null, 'injects again after recovery');
    assert.equal(fs.readFileSync(real, 'utf8'), 'victim');
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
});

describe('SessionStart writes nothing to settings.json on its own', () => {
  beforeEach(setup);
  afterEach(teardown);

  // The badge is opt-in as of 1.5.0. A clean install must leave global config alone;
  // the only write left is the legacy-hook migration, which has nothing to remove here.
  test('a clean install leaves no settings.json behind', () => {
    mod.cleanupLegacyHooks();
    assert.equal(fs.existsSync(settingsPath), false);
  });

  test('an existing settings.json is untouched when there is nothing to migrate', () => {
    const before = JSON.stringify({ model: 'opus', env: { A: '1' } });
    fs.writeFileSync(settingsPath, before);
    mod.cleanupLegacyHooks();
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), before);
  });

  test('no statusLine is registered without the user asking', () => {
    fs.writeFileSync(settingsPath, '{}');
    mod.cleanupLegacyHooks();
    assert.equal(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).statusLine, undefined);
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

// A migration that keeps having work to do is losing a race, not finishing. Versions up
// to 1.3.1 re-add their settings.json entries from both hooks, so a cleanup at session
// start is undone on the next prompt — forever, and with no symptom other than the
// directive arriving twice.
describe('repeated cleanups are reported instead of run forever', () => {
  beforeEach(setup);
  afterEach(teardown);

  const countPath = () => path.join(tmpDir, '.critique-legacy-cleanup');

  test('the first cleanup is not treated as a loop', () => {
    assert.equal(mod.noteCleanup(true), 1);
  });

  test('consecutive cleanups accumulate', () => {
    mod.noteCleanup(true);
    assert.equal(mod.noteCleanup(true), 2);
    assert.equal(mod.noteCleanup(true), 3);
  });

  test('a clean session start resets the count and removes the file', () => {
    mod.noteCleanup(true);
    mod.noteCleanup(true);
    assert.equal(mod.noteCleanup(false), 0);
    assert.equal(fs.existsSync(countPath()), false);
  });

  test('a corrupted count starts over instead of throwing', () => {
    fs.writeFileSync(countPath(), 'not a number');
    assert.equal(mod.noteCleanup(true), 1);
  });

  test('nothing is written while there is nothing to clean up', () => {
    assert.equal(mod.noteCleanup(false), 0);
    assert.equal(fs.existsSync(countPath()), false);
  });

  test('every language that has a banner also has the loop warning', () => {
    assert.deepEqual(Object.keys(mod.LOOP_WARNINGS).sort(), Object.keys(mod.MESSAGES).sort());
  });

  test('the warning names the file and the block the user has to edit', () => {
    for (const lang of Object.keys(mod.LOOP_WARNINGS)) {
      const text = mod.LOOP_WARNINGS[lang];
      assert.ok(text.includes('settings.json'), lang + ' warning does not name the file');
      assert.ok(text.includes('critica-tracker.js'), lang + ' warning does not name the hook to remove');
    }
  });
});

describe('SessionEnd cleanup', () => {
  beforeEach(setup);
  afterEach(teardown);

  // Registered at SessionEnd on purpose: it is the only point that runs after the last
  // prompt of the session, so the legacy tracker cannot re-add what it just removed.
  test('the plugin registers the cleanup at SessionEnd', () => {
    const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
    const commands = (hooks.SessionEnd || []).flatMap(g => g.hooks || []).map(h => h.command);
    assert.equal(commands.length, 1);
    assert.ok(commands[0].includes('critica-cleanup.js'));
  });

  test('the cleanup entry point removes the legacy hooks', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: { UserPromptSubmit: [{ hooks: [critiqueHook('critica-tracker.js')] }] }
    }));
    const cleanup = freshRequire(path.resolve(__dirname, '..', 'critica-cleanup.js'));
    assert.equal(cleanup.cleanupLegacyHooks(), true);
    assert.equal(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).hooks, undefined);
    delete require.cache[require.resolve(path.resolve(__dirname, '..', 'critica-cleanup.js'))];
  });
});
