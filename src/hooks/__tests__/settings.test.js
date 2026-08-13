'use strict';
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const S = require(path.resolve(__dirname, '..', 'critica-settings.js'));

let tmpDir;
let settingsPath;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'critique-settings-'));
  settingsPath = path.join(tmpDir, 'settings.json');
}

function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

describe('readSettings', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('returns {} when file is absent', () => {
    assert.deepEqual(S.readSettings(settingsPath), {});
  });

  test('returns {} for an empty file', () => {
    fs.writeFileSync(settingsPath, '   \n');
    assert.deepEqual(S.readSettings(settingsPath), {});
  });

  test('parses valid JSON object', () => {
    fs.writeFileSync(settingsPath, '{"model":"opus"}');
    assert.deepEqual(S.readSettings(settingsPath), { model: 'opus' });
  });

  test('returns UNREADABLE for malformed JSON — never {}', () => {
    fs.writeFileSync(settingsPath, '{"model":"opus",');
    const result = S.readSettings(settingsPath);
    assert.equal(result, S.UNREADABLE);
    assert.notDeepEqual(result, {});
  });

  test('returns UNREADABLE for a JSON array', () => {
    fs.writeFileSync(settingsPath, '[1,2,3]');
    assert.equal(S.readSettings(settingsPath), S.UNREADABLE);
  });

  test('returns UNREADABLE for JSON null', () => {
    fs.writeFileSync(settingsPath, 'null');
    assert.equal(S.readSettings(settingsPath), S.UNREADABLE);
  });
});

describe('writeSettings', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('writes pretty JSON and reports success', () => {
    assert.equal(S.writeSettings(settingsPath, { model: 'opus' }), true);
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), '{\n  "model": "opus"\n}\n');
  });

  test('preserves the existing file mode (unix only)', () => {
    if (process.platform === 'win32') return;
    fs.writeFileSync(settingsPath, '{}', { mode: 0o600 });
    S.writeSettings(settingsPath, { a: 1 });
    assert.equal(fs.statSync(settingsPath).mode & 0o777, 0o600);
  });

  test('reports failure and leaves no temp file behind', () => {
    const unwritable = path.join(tmpDir, 'nope', 'settings.json');
    assert.equal(S.writeSettings(unwritable, { a: 1 }), false);
    assert.equal(fs.readdirSync(tmpDir).filter(f => f.endsWith('.tmp')).length, 0);
  });
});

describe('withSettingsLock', () => {
  beforeEach(setup);
  afterEach(teardown);

  test('runs the callback and returns its value', () => {
    assert.equal(S.withSettingsLock(tmpDir, () => 'done'), 'done');
  });

  test('releases the lock even when the callback throws', () => {
    assert.throws(() => S.withSettingsLock(tmpDir, () => { throw new Error('boom'); }), /boom/);
    assert.equal(fs.existsSync(path.join(tmpDir, '.critique-settings.lock')), false);
  });

  test('breaks a stale lock left by a killed process', () => {
    const lockDir = path.join(tmpDir, '.critique-settings.lock');
    fs.mkdirSync(lockDir);
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(lockDir, old, old);
    assert.equal(S.withSettingsLock(tmpDir, () => 'acquired'), 'acquired');
  });

  test('creates the config directory when it does not exist yet', () => {
    const fresh = path.join(tmpDir, 'new-claude-dir');
    assert.equal(S.withSettingsLock(fresh, () => 'ok'), 'ok');
    assert.equal(fs.statSync(fresh).isDirectory(), true);
  });
});
