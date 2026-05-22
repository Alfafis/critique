'use strict';
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const TRACKER_PATH = path.resolve(__dirname, '..', 'critica-tracker.js');

let tmpDir;
let mod;
let flagFile;

function freshRequire(modPath) {
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'critique-tracker-'));
  flagFile = path.join(tmpDir, '.critique-active');
  mod = freshRequire(TRACKER_PATH);
}

function teardown() {
  delete require.cache[require.resolve(TRACKER_PATH)];
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function writeFlag(lang, ageSeconds) {
  const ts = Math.floor(Date.now() / 1000) - (ageSeconds || 0);
  fs.writeFileSync(flagFile, 'active:' + lang + ':' + ts, 'utf8');
}

describe('readFlag', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('returns null for missing file', () => {
    assert.equal(mod.readFlag(flagFile), null);
  });

  test('returns content for valid flag', () => {
    fs.writeFileSync(flagFile, 'active:en:12345');
    assert.equal(mod.readFlag(flagFile), 'active:en:12345');
  });

  test('returns null for file exceeding 64 bytes', () => {
    fs.writeFileSync(flagFile, 'x'.repeat(65));
    assert.equal(mod.readFlag(flagFile), null);
  });

  test('returns content for file exactly 64 bytes', () => {
    const content = 'active:en:' + '1'.repeat(54); // 10 + 54 = 64
    fs.writeFileSync(flagFile, content);
    assert.equal(mod.readFlag(flagFile), content);
  });

  test('returns null for symlink (unix only)', () => {
    if (process.platform === 'win32') return;
    const real = path.join(tmpDir, 'real.txt');
    fs.writeFileSync(real, 'active:en:12345');
    fs.symlinkSync(real, flagFile);
    assert.equal(mod.readFlag(flagFile), null);
  });
});

describe('refreshFlag', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('updates timestamp while preserving lang prefix', () => {
    const before = Math.floor(Date.now() / 1000) - 100;
    fs.writeFileSync(flagFile, 'active:pt:' + before);
    mod.refreshFlag(flagFile);
    const content = fs.readFileSync(flagFile, 'utf8');
    assert.ok(content.startsWith('active:pt:'));
    const ts = parseInt(content.split(':')[2]);
    assert.ok(ts >= before + 100);
  });

  test('defaults to active:en prefix when flag is missing', () => {
    mod.refreshFlag(flagFile);
    const content = fs.readFileSync(flagFile, 'utf8');
    assert.ok(content.startsWith('active:en:'));
  });
});

describe('handlePrompt — TTL', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('fresh flag injects critique context', () => {
    writeFlag('en', 0);
    const out = mod.handlePrompt('hello world', flagFile);
    assert.notEqual(out, null);
    const parsed = JSON.parse(out);
    assert.ok(parsed.hookSpecificOutput.additionalContext.includes('CRITIQUE MODE ACTIVE'));
  });

  test('expired flag (>24h) returns null', () => {
    writeFlag('en', 86401);
    const out = mod.handlePrompt('hello world', flagFile);
    assert.equal(out, null);
  });

  test('fresh flag refreshes timestamp on inject', () => {
    writeFlag('en', 500);
    const before = fs.readFileSync(flagFile, 'utf8');
    mod.handlePrompt('hello world', flagFile);
    const after = fs.readFileSync(flagFile, 'utf8');
    assert.notEqual(before, after);
  });
});

describe('handlePrompt — deactivation patterns', () => {
  beforeEach(setup);
  afterEach(teardown);

  const deactivationPhrases = [
    'critique off',
    'disable critique',
    'stop critique',
    'critica off',
    'desativa critica',
    'sem critica',
    'desactiva critica',
    'désactive critique',
  ];

  for (const phrase of deactivationPhrases) {
    test('deactivates on: ' + phrase, () => {
      writeFlag('en', 0);
      mod.handlePrompt(phrase, flagFile);
      assert.equal(fs.existsSync(flagFile), false);
    });
  }

  test('does not deactivate on unrelated prompt', () => {
    writeFlag('en', 0);
    mod.handlePrompt('review my code please', flagFile);
    assert.equal(fs.existsSync(flagFile), true);
  });
});

describe('handlePrompt — reactivation patterns', () => {
  beforeEach(setup);
  afterEach(teardown);

  const reactivationPhrases = [
    'enable critique',
    'turn on critique',
    'ativa critica',
    'reativa critica',
    'critique on',
  ];

  for (const phrase of reactivationPhrases) {
    test('reactivates on: ' + phrase, () => {
      // start with expired flag
      writeFlag('en', 86401);
      mod.handlePrompt(phrase, flagFile);
      const content = fs.readFileSync(flagFile, 'utf8');
      const ts = parseInt(content.split(':')[2]);
      assert.ok(Math.floor(Date.now() / 1000) - ts < 5);
    });
  }
});

describe('handlePrompt — missing flag (mid-session install)', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('writes flag when missing', () => {
    assert.equal(fs.existsSync(flagFile), false);
    mod.handlePrompt('hello', flagFile);
    assert.equal(fs.existsSync(flagFile), true);
  });

  test('written flag is active:en format', () => {
    mod.handlePrompt('hello', flagFile);
    const content = fs.readFileSync(flagFile, 'utf8');
    assert.ok(content.startsWith('active:en:'));
  });
});
