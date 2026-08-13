#!/usr/bin/env node
// critique — shared ~/.claude/settings.json access
//
// Extracted so critica-activate.js and critica-badge.js can both use it without a
// circular require.

const fs = require('fs');
const path = require('path');
const os = require('os');

// Sentinel for "settings.json exists but could not be understood". Distinct from {}
// (file absent), because overwriting an unreadable settings.json destroys the user's
// entire global config — model, permissions, env, MCP servers.
const UNREADABLE = Symbol('settings-unreadable');

function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function settingsPath(dir) {
  return path.join(dir || claudeDir(), 'settings.json');
}

function debug(where, message) {
  if (process.env.DEBUG_CRITIQUE) process.stderr.write('[critique] ' + where + ': ' + message + '\n');
}

// Returns {} when the file does not exist, UNREADABLE when it exists but is not a
// valid JSON object. Never returns {} for a file we failed to understand.
function readSettings(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    debug('readSettings', e.message);
    return UNREADABLE;
  }
  if (raw.trim() === '') return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    debug('readSettings', 'invalid JSON — ' + e.message);
    return UNREADABLE;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return UNREADABLE;
  return parsed;
}

// Returns true on success. On Windows renameSync can throw EPERM/EBUSY when another
// process (editor, antivirus, a concurrent Claude Code) has the target open, so the
// temp file is always removed and the failure is reported rather than thrown — an
// escaping exception would surface as a SessionStart hook crash.
function writeSettings(file, settings) {
  let mode = 0o600;
  try { mode = fs.statSync(file).mode & 0o777; } catch (e) {}
  const tmp = file + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', { encoding: 'utf8', mode });
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    debug('writeSettings', e.message);
    try { fs.unlinkSync(tmp); } catch (e2) {}
    return false;
  }
}

// Cross-process mutex around the read-modify-write cycle on settings.json.
// mkdir is atomic on every platform; a lock older than STALE_MS is assumed
// orphaned by a killed process and broken.
function withSettingsLock(dir, fn) {
  const lockDir = path.join(dir, '.critique-settings.lock');
  const STALE_MS = 10000;
  const ATTEMPTS = 50;
  const sleepMs = 20;
  for (let i = 0; i < ATTEMPTS; i++) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.mkdirSync(lockDir);
    } catch (e) {
      if (e.code !== 'EEXIST') { debug('lock', e.message); return false; }
      try {
        if (Date.now() - fs.statSync(lockDir).mtimeMs > STALE_MS) {
          fs.rmdirSync(lockDir);
          continue;
        }
      } catch (e2) {}
      try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleepMs); } catch (e3) {}
      continue;
    }
    try {
      return fn();
    } finally {
      try { fs.rmdirSync(lockDir); } catch (e) {}
    }
  }
  debug('lock', 'timed out waiting for settings lock');
  return false;
}

module.exports = { UNREADABLE, claudeDir, settingsPath, debug, readSettings, writeSettings, withSettingsLock };
