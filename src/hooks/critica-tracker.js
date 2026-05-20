#!/usr/bin/env node
// critique — UserPromptSubmit hook
// Per-turn reinforcement: keeps critique mindset in model attention every message

const fs = require('fs');
const path = require('path');
const os = require('os');

const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const flagPath = path.join(claudeDir, '.critique-active');
const TTL = 86400; // seconds — badge auto-clears this long after last hook run

function safeWriteFlag(filePath, content) {
  try {
    try { if (fs.lstatSync(filePath).isSymbolicLink()) return; } catch (e) {}
    try { if (fs.lstatSync(path.dirname(filePath)).isSymbolicLink()) return; } catch (e) {}
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

function refreshFlag(filePath) {
  const content = readFlag(filePath);
  const m = content && content.match(/^(active:[a-z]{2}):/);
  const prefix = m ? m[1] : 'active:en';
  safeWriteFlag(filePath, prefix + ':' + Math.floor(Date.now() / 1000));
}

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const prompt = (data.prompt || '').trim();

    // Reactivation — EN + PT + ES + FR
    if (/\b(ativa|enable|turn on|reactivate|reativa|activa|réactive)\b.*\b(critique|critica)\b/i.test(prompt) ||
        /\b(critique|critica)\b.*\b(on|ativa|enable|activa|réactive)\b/i.test(prompt)) {
      refreshFlag(flagPath);
      return;
    }

    // Deactivation — EN + PT + ES + FR
    if (/\b(critique|critica)\b.*\b(off|disable|stop|desativa|desactiva|désactive|désactiver|desactivar|arrête)\b/i.test(prompt) ||
        /\b(disable|turn off|stop|desativa|sem|sin|sans|arrête|desactiva|désactive)\b.*\b(critique|critica)\b/i.test(prompt)) {
      try { fs.unlinkSync(flagPath); } catch (e) {}
      return;
    }

    const content = readFlag(flagPath);
    const m = content && content.match(/^active:[a-z]{2}:(\d+)/);
    const isActive = m && (Math.floor(Date.now() / 1000) - parseInt(m[1])) <= TTL;

    if (isActive) {
      refreshFlag(flagPath);
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext:
            'CRITIQUE MODE ACTIVE (medium). Surface real problems first. ' +
            'Speak on: code with logic/auth/state, architecture decisions, specs being elaborated. ' +
            'Stay silent on: trivial tasks (typo/rename/<50 lines), mechanical execution of approved instructions, issues already raised. ' +
            'Adapt focus: code→bugs+security+edge cases; spec/plan→assumptions+YAGNI; architecture→coupling+tradeoffs. ' +
            'Questionable decisions: explain why and what\'s better. ' +
            'Praise only the non-obvious. Order by impact. No sugarcoating.'
        }
      }));
    }
  } catch (e) {
    if (process.env.DEBUG_CRITIQUE) process.stderr.write('[critica-tracker] ' + e.stack + '\n');
  }
});
