#!/usr/bin/env node
// critique — UserPromptSubmit hook
// Per-turn reinforcement: keeps critique mindset in model attention every message

const fs = require('fs');
const path = require('path');
const os = require('os');

const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const flagPath = path.join(claudeDir, '.critique-active');
const TTL = 86400; // seconds — badge auto-clears this long after last hook run

// Flag format: <state>:<lang>:<unix_ts>, state being "active" or "off".
// "off" is stored explicitly rather than by deleting the file: absence means
// "never installed" and triggers first-run activation, so deleting the flag to
// deactivate made the mode come back on the very next prompt.
const FLAG_RE = /^(active|off):([a-z]{2}):(\d+)$/;

const NAME = '(?:critique|critica|crítica)';
const ART = '(?:\\s+(?:the|a|o|la|le|el|les|los|las))?';
const OFF_VERB = '(?:disable|stop|turn\\s+off|switch\\s+off|desativa(?:r)?|desliga(?:r)?|' +
                 'desactiva(?:r)?|désactive(?:r)?|arrête(?:r)?|sem|sin|sans)';
const ON_VERB = '(?:enable|activate|turn\\s+on|switch\\s+on|reactivate|ativa(?:r)?|reativa(?:r)?|' +
                'liga(?:r)?|activa(?:r)?|reactiva(?:r)?|réactive(?:r)?|active(?:r)?)';

// Adjacency, not co-occurrence. The previous patterns put `.*` between the verb and
// the name, so any prompt containing both anywhere silently toggled the mode —
// "sem problemas, faz a critica disso" and "stop using critique.md" both turned it off.
const OFF_RE = new RegExp('\\b' + NAME + '\\s+off\\b|\\b' + OFF_VERB + ART + '\\s+' + NAME + '\\b', 'i');
const ON_RE = new RegExp('\\b' + NAME + '\\s+on\\b|\\b' + ON_VERB + ART + '\\s+' + NAME + '\\b', 'i');

const ADDITIONAL_CONTEXT =
  'CRITIQUE MODE ACTIVE (medium). Surface real problems first. ' +
  'Speak on: code with logic/auth/state, architecture decisions, specs being elaborated. ' +
  'Stay silent on: trivial tasks (typo/rename/<50 lines), mechanical execution of approved instructions, issues already raised. ' +
  'Adapt focus: code→bugs+security+edge cases; spec/plan→assumptions+YAGNI; architecture→coupling+tradeoffs. ' +
  'Questionable decisions: explain why and what\'s better. ' +
  'Praise only the non-obvious. Order by impact. No sugarcoating.';

// Kept in sync with critica-activate.js. Unlinking a symlinked flag removes the link,
// never its target: the redirect guard holds and the flag stops being a permanent
// dead end. See the comment there.
function safeWriteFlag(filePath, content) {
  try {
    try { if (fs.lstatSync(path.dirname(filePath)).isSymbolicLink()) return; } catch (e) {}
    try { if (fs.lstatSync(filePath).isSymbolicLink()) fs.unlinkSync(filePath); } catch (e) {}
    const tmp = filePath + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, filePath);
  } catch (e) {}
}

function readFlag(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || stat.size > 64) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) { return null; }
}

function fileExists(filePath) {
  try { fs.lstatSync(filePath); return true; } catch (e) { return false; }
}

// null when the file is absent, a symlink, oversized, or does not match FLAG_RE.
function parseFlag(filePath) {
  const content = readFlag(filePath);
  const m = content && content.trim().match(FLAG_RE);
  if (!m) return null;
  return { state: m[1], lang: m[2], ts: parseInt(m[3], 10) };
}

function refreshFlag(filePath) {
  const flag = parseFlag(filePath);
  const state = flag ? flag.state : 'active';
  const lang = flag ? flag.lang : 'en';
  safeWriteFlag(filePath, state + ':' + lang + ':' + Math.floor(Date.now() / 1000));
}

function spawnActivate() {
  try {
    const { spawn } = require('child_process');
    spawn(process.execPath, [path.join(__dirname, 'critica-activate.js')], {
      detached: true,
      stdio: 'ignore',
      env: process.env
    }).unref();
  } catch (e) {}
}

function injection() {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: ADDITIONAL_CONTEXT
    }
  });
}

// Extracted for testability. fp defaults to module-level flagPath.
function handlePrompt(prompt, fp) {
  const file = fp !== undefined ? fp : flagPath;
  const now = Math.floor(Date.now() / 1000);
  const flag = parseFlag(file);
  const lang = (flag && flag.lang) || 'en';

  if (ON_RE.test(prompt)) {
    safeWriteFlag(file, 'active:' + lang + ':' + now);
    return null;
  }
  if (OFF_RE.test(prompt)) {
    safeWriteFlag(file, 'off:' + lang + ':' + now);
    return null;
  }

  // First-run detection: flag absent means SessionStart was missed (mid-session install).
  if (!fileExists(file)) {
    spawnActivate();
    // Write flag now so critique injects this turn; activate.js will overwrite with correct locale
    safeWriteFlag(file, 'active:en:' + now);
    return injection();
  }

  // File is present but unreadable, symlinked, oversized, or malformed. Stay silent
  // rather than guessing — SessionStart rewrites a clean flag next session.
  if (!flag) return null;
  if (flag.state !== 'active') return null;
  if (now - flag.ts > TTL) return null;

  safeWriteFlag(file, 'active:' + flag.lang + ':' + now);
  return injection();
}

if (require.main === module) {
  let input = '';
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const data = JSON.parse(input);
      const prompt = (data.prompt || '').trim();
      const out = handlePrompt(prompt);
      if (out) process.stdout.write(out);
    } catch (e) {
      if (process.env.DEBUG_CRITIQUE) process.stderr.write('[critica-tracker] ' + e.stack + '\n');
    }
  });
}

module.exports = { safeWriteFlag, readFlag, parseFlag, refreshFlag, handlePrompt, OFF_RE, ON_RE, TTL };
