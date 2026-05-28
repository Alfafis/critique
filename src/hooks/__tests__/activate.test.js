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

function freshRequire(modPath) {
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'critique-activate-'));
  process.env.CLAUDE_CONFIG_DIR = tmpDir;
  process.env.CLAUDE_PLUGIN_ROOT = PLUGIN_ROOT;
  mod = freshRequire(ACTIVATE_PATH);
}

function teardown() {
  delete require.cache[require.resolve(ACTIVATE_PATH)];
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CLAUDE_PLUGIN_ROOT;
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

  test('rejects symlink target (unix only)', () => {
    if (process.platform === 'win32') return;
    const real = path.join(tmpDir, 'real.txt');
    const link = path.join(tmpDir, 'link.txt');
    fs.writeFileSync(real, 'original');
    fs.symlinkSync(real, link);
    mod.safeWriteFlag(link, 'injected');
    assert.equal(fs.readFileSync(real, 'utf8'), 'original');
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
});

describe('setupHooks', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('adds SessionStart and UserPromptSubmit to empty settings', () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, '{}');
    mod.setupHooks();
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(Array.isArray(s.hooks.SessionStart) && s.hooks.SessionStart.length > 0);
    assert.ok(Array.isArray(s.hooks.UserPromptSubmit) && s.hooks.UserPromptSubmit.length > 0);
  });

  test('creates settings.json when missing', () => {
    mod.setupHooks();
    assert.ok(fs.existsSync(path.join(tmpDir, 'settings.json')));
  });

  test('idempotent — second call does not duplicate hooks', () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, '{}');
    mod.setupHooks();
    mod.setupHooks();
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const sessionCmds = s.hooks.SessionStart.flatMap(g => g.hooks || []);
    const count = sessionCmds.filter(h => (h.command || '').includes('critica-activate')).length;
    assert.equal(count, 1);
  });

  test('preserves existing hooks on merge', () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    const existing = {
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'node other-hook.js' }] }]
      }
    };
    fs.writeFileSync(settingsPath, JSON.stringify(existing));
    mod.setupHooks();
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const sessionCmds = s.hooks.SessionStart.flatMap(g => g.hooks || []);
    assert.ok(sessionCmds.some(h => (h.command || '').includes('other-hook')));
    assert.ok(sessionCmds.some(h => (h.command || '').includes('critica-activate')));
  });
});

describe('injectIntoBadgeAggregator', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('returns false for non-command statusLine', () => {
    assert.equal(mod.injectIntoBadgeAggregator({ type: 'static', value: 'x' }, '/badge.sh', false), false);
  });

  test('returns false when command has no recognizable script path', () => {
    assert.equal(mod.injectIntoBadgeAggregator({ type: 'command', command: 'echo hello' }, '/badge.sh', false), false);
  });

  test('injects call into existing bash script', () => {
    const scriptPath = path.join(tmpDir, 'statusline.sh');
    const badgePath = path.join(tmpDir, 'critica-statusline.sh');
    fs.writeFileSync(scriptPath, '#!/bin/bash\necho hi\n');
    const result = mod.injectIntoBadgeAggregator(
      { type: 'command', command: 'bash "' + scriptPath + '"' },
      badgePath,
      false
    );
    assert.equal(result, true);
    assert.ok(fs.readFileSync(scriptPath, 'utf8').includes('critica-statusline'));
  });

  test('returns false when target script does not exist', () => {
    const scriptPath = path.join(tmpDir, 'nonexistent.sh');
    const badgePath = path.join(tmpDir, 'critica-statusline.sh');
    const result = mod.injectIntoBadgeAggregator(
      { type: 'command', command: 'bash "' + scriptPath + '"' },
      badgePath,
      false
    );
    assert.equal(result, false);
  });

  test('returns true without modifying when targetScript IS the badge script', () => {
    const badgePath = path.join(tmpDir, 'critica-statusline.sh');
    fs.writeFileSync(badgePath, '#!/bin/bash\necho hi\n');
    const contentBefore = fs.readFileSync(badgePath, 'utf8');
    const result = mod.injectIntoBadgeAggregator(
      { type: 'command', command: 'bash "' + badgePath + '"' },
      badgePath,
      false
    );
    assert.equal(result, true);
    assert.equal(fs.readFileSync(badgePath, 'utf8'), contentBefore);
  });

  test('idempotent — already injected script not modified again', () => {
    const scriptPath = path.join(tmpDir, 'statusline.sh');
    const badgePath = path.join(tmpDir, 'critica-statusline.sh');
    // One occurrence already present
    fs.writeFileSync(scriptPath, '#!/bin/bash\nbash "' + badgePath + '"\n');
    const before = (fs.readFileSync(scriptPath, 'utf8').match(/critica-statusline/g) || []).length;
    mod.injectIntoBadgeAggregator(
      { type: 'command', command: 'bash "' + scriptPath + '"' },
      badgePath,
      false
    );
    const after = (fs.readFileSync(scriptPath, 'utf8').match(/critica-statusline/g) || []).length;
    assert.equal(before, after);
  });
});
