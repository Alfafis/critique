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

function writeFlag(lang, ageSeconds, state) {
  const ts = Math.floor(Date.now() / 1000) - (ageSeconds || 0);
  fs.writeFileSync(flagFile, (state || 'active') + ':' + lang + ':' + ts, 'utf8');
}

function flagContent() {
  return fs.readFileSync(flagFile, 'utf8');
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

describe('readPrompt', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('reads a plain payload', () => {
    assert.equal(mod.readPrompt('{"prompt":"review this"}'), 'review this');
  });

  // A PowerShell 5.1 pipe prepends a UTF-8 BOM. Without stripping it, JSON.parse throws into
  // the entrypoint's catch and critique silently stops injecting — found while validating on
  // Windows 11 / Node 22.
  test('tolerates a UTF-8 BOM', () => {
    assert.equal(mod.readPrompt('﻿{"prompt":"review this"}'), 'review this');
  });

  test('strips only one leading BOM, not content', () => {
    assert.equal(mod.readPrompt('﻿{"prompt":"a﻿b"}'), 'a﻿b');
  });

  test('trims surrounding whitespace', () => {
    assert.equal(mod.readPrompt('{"prompt":"  spaced  "}'), 'spaced');
  });

  test('returns empty string when prompt is absent', () => {
    assert.equal(mod.readPrompt('{}'), '');
  });

  test('still throws on genuinely malformed JSON', () => {
    assert.throws(() => mod.readPrompt('{"prompt":'), SyntaxError);
  });
});

describe('parseFlag', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('parses an active flag', () => {
    fs.writeFileSync(flagFile, 'active:pt:12345');
    assert.deepEqual(mod.parseFlag(flagFile), { state: 'active', lang: 'pt', ts: 12345 });
  });

  test('parses an off flag', () => {
    fs.writeFileSync(flagFile, 'off:fr:999');
    assert.deepEqual(mod.parseFlag(flagFile), { state: 'off', lang: 'fr', ts: 999 });
  });

  test('returns null for an unknown state', () => {
    fs.writeFileSync(flagFile, 'paused:pt:12345');
    assert.equal(mod.parseFlag(flagFile), null);
  });

  test('returns null for garbage content', () => {
    fs.writeFileSync(flagFile, 'not a flag');
    assert.equal(mod.parseFlag(flagFile), null);
  });

  test('off flag fits the 64-byte limit', () => {
    const content = 'off:pt:' + Math.floor(Date.now() / 1000);
    assert.ok(Buffer.byteLength(content) <= 64);
  });
});

describe('refreshFlag', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('updates timestamp while preserving lang prefix', () => {
    const before = Math.floor(Date.now() / 1000) - 100;
    fs.writeFileSync(flagFile, 'active:pt:' + before);
    mod.refreshFlag(flagFile);
    assert.ok(flagContent().startsWith('active:pt:'));
    assert.ok(parseInt(flagContent().split(':')[2]) >= before + 100);
  });

  test('preserves the off state', () => {
    fs.writeFileSync(flagFile, 'off:es:100');
    mod.refreshFlag(flagFile);
    assert.ok(flagContent().startsWith('off:es:'));
  });

  test('defaults to active:en prefix when flag is missing', () => {
    mod.refreshFlag(flagFile);
    assert.ok(flagContent().startsWith('active:en:'));
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
    assert.equal(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.ok(parsed.hookSpecificOutput.additionalContext.includes('CRITIQUE MODE ACTIVE'));
  });

  test('expired flag (>24h) returns null', () => {
    writeFlag('en', mod.TTL + 1);
    assert.equal(mod.handlePrompt('hello world', flagFile), null);
  });

  test('flag exactly at the TTL boundary still injects', () => {
    writeFlag('en', mod.TTL);
    assert.notEqual(mod.handlePrompt('hello world', flagFile), null);
  });

  test('fresh flag refreshes timestamp on inject', () => {
    writeFlag('en', 500);
    const before = flagContent();
    mod.handlePrompt('hello world', flagFile);
    assert.notEqual(before, flagContent());
  });

  test('injection preserves the detected language in the flag', () => {
    writeFlag('pt', 500);
    mod.handlePrompt('hello world', flagFile);
    assert.ok(flagContent().startsWith('active:pt:'));
  });

  test('malformed flag stays silent instead of injecting', () => {
    fs.writeFileSync(flagFile, 'garbage');
    assert.equal(mod.handlePrompt('hello world', flagFile), null);
  });

  test('symlinked flag stays silent (unix only)', () => {
    if (process.platform === 'win32') return;
    const real = path.join(tmpDir, 'real.txt');
    fs.writeFileSync(real, 'active:en:' + Math.floor(Date.now() / 1000));
    fs.symlinkSync(real, flagFile);
    assert.equal(mod.handlePrompt('hello world', flagFile), null);
  });
});

describe('handlePrompt — deactivation persists', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('deactivation survives the next prompt', () => {
    writeFlag('pt', 0);
    mod.handlePrompt('critique off', flagFile);
    assert.equal(mod.handlePrompt('agora revisa meu codigo', flagFile), null);
  });

  test('deactivation survives many prompts', () => {
    writeFlag('pt', 0);
    mod.handlePrompt('critique off', flagFile);
    for (let i = 0; i < 5; i++) {
      assert.equal(mod.handlePrompt('prompt ' + i, flagFile), null);
    }
  });

  test('deactivation writes an off flag rather than deleting it', () => {
    writeFlag('pt', 0);
    mod.handlePrompt('critique off', flagFile);
    assert.equal(fs.existsSync(flagFile), true);
    assert.deepEqual(mod.parseFlag(flagFile).state, 'off');
  });

  test('deactivation preserves the detected language', () => {
    writeFlag('fr', 0);
    mod.handlePrompt('critique off', flagFile);
    assert.equal(mod.parseFlag(flagFile).lang, 'fr');
  });

  test('reactivation after deactivation restores injection in the same language', () => {
    writeFlag('pt', 0);
    mod.handlePrompt('critique off', flagFile);
    mod.handlePrompt('ativa critica', flagFile);
    assert.equal(mod.parseFlag(flagFile).lang, 'pt');
    assert.notEqual(mod.handlePrompt('revisa isso', flagFile), null);
  });

  test('off state does not render the badge', () => {
    if (process.platform === 'win32') return;
    writeFlag('pt', 0);
    mod.handlePrompt('critique off', flagFile);
    const script = path.resolve(__dirname, '..', 'critica-statusline.sh');
    const out = require('child_process').execSync('bash "' + script + '"', {
      encoding: 'utf8',
      env: Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: tmpDir }),
    });
    assert.equal(out, '');
  });

  test('active state renders the badge', () => {
    if (process.platform === 'win32') return;
    writeFlag('pt', 0);
    const script = path.resolve(__dirname, '..', 'critica-statusline.sh');
    const out = require('child_process').execSync('bash "' + script + '"', {
      encoding: 'utf8',
      env: Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: tmpDir }),
    });
    assert.ok(out.includes('[CRITIQUE]'));
  });
});

describe('handlePrompt — deactivation patterns', () => {
  beforeEach(setup);
  afterEach(teardown);

  const deactivationPhrases = [
    'critique off',
    'critica off',
    'disable critique',
    'stop critique',
    'turn off critique',
    'desativa critica',
    'desativar a critica',
    'sem critica',
    'desactiva critica',
    'sin critica',
    'désactive critique',
    'sans critique',
    'desativa a crítica por favor',
  ];

  for (const phrase of deactivationPhrases) {
    test('deactivates on: ' + phrase, () => {
      writeFlag('en', 0);
      mod.handlePrompt(phrase, flagFile);
      assert.equal(mod.parseFlag(flagFile).state, 'off');
    });
  }
});

describe('handlePrompt — no false-positive deactivation', () => {
  beforeEach(setup);
  afterEach(teardown);

  // Every one of these turned critique off before adjacency was required.
  const innocentPhrases = [
    'critique this file and then stop the server',
    'sem problemas, faz a critica disso',
    'can you stop using critique.md as reference',
    'write a critique of this design and stop when done',
    'sem pressa, quero uma critica detalhada',
    'sin prisa, dame una critica completa',
    'review my code please',
    'the critique plugin has no tests — disable the cache instead',
  ];

  for (const phrase of innocentPhrases) {
    test('stays active on: ' + phrase, () => {
      writeFlag('en', 0);
      mod.handlePrompt(phrase, flagFile);
      assert.equal(mod.parseFlag(flagFile).state, 'active', 'wrongly deactivated by: ' + phrase);
    });
  }
});

describe('handlePrompt — reactivation patterns', () => {
  beforeEach(setup);
  afterEach(teardown);

  const reactivationPhrases = [
    'enable critique',
    'turn on critique',
    'critique on',
    'critica on',
    'ativa critica',
    'reativa critica',
    'ativar a critica',
    'activa la critica',
    'reactiva la critica',
    'réactive critique',
    'activer la critique',
  ];

  for (const phrase of reactivationPhrases) {
    test('reactivates on: ' + phrase, () => {
      writeFlag('en', 0, 'off');
      mod.handlePrompt(phrase, flagFile);
      const flag = mod.parseFlag(flagFile);
      assert.equal(flag.state, 'active');
      assert.ok(Math.floor(Date.now() / 1000) - flag.ts < 5);
    });
  }

  test('reactivates an expired flag', () => {
    writeFlag('en', mod.TTL + 1);
    mod.handlePrompt('critique on', flagFile);
    assert.notEqual(mod.handlePrompt('review this', flagFile), null);
  });

  test('reactivation wins when a prompt matches both patterns', () => {
    writeFlag('en', 0, 'off');
    mod.handlePrompt('enable critique, not disable critique', flagFile);
    assert.equal(mod.parseFlag(flagFile).state, 'active');
  });
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
    assert.ok(flagContent().startsWith('active:en:'));
  });

  test('injects on the first turn after a mid-session install', () => {
    assert.notEqual(mod.handlePrompt('hello', flagFile), null);
  });

  test('a deactivation phrase on a missing flag does not trigger first-run activation', () => {
    mod.handlePrompt('critique off', flagFile);
    assert.equal(mod.parseFlag(flagFile).state, 'off');
    assert.equal(mod.handlePrompt('next prompt', flagFile), null);
  });
});
