#!/usr/bin/env node
// critique — UserPromptSubmit hook
// Per-turn reinforcement: keeps critique mindset in model attention every message

const fs = require('fs');
const path = require('path');
const os = require('os');

const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const flagPath = path.join(claudeDir, '.critique-active');

function safeWriteFlag(filePath, content) {
  try {
    try { if (fs.lstatSync(filePath).isSymbolicLink()) return; } catch (e) {}
    try { if (fs.lstatSync(path.dirname(filePath)).isSymbolicLink()) return; } catch (e) {}
    const tmp = filePath + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, filePath);
  } catch (e) {}
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
      safeWriteFlag(flagPath, 'active');
      return;
    }

    // Deactivation — EN + PT + ES + FR
    if (/\b(critique|critica)\b.*\b(off|disable|stop|desativa|desactiva|désactive|désactiver|desactivar|arrête)\b/i.test(prompt) ||
        /\b(disable|turn off|stop|desativa|sem|sin|sans|arrête|desactiva|désactive)\b.*\b(critique|critica)\b/i.test(prompt)) {
      try { fs.unlinkSync(flagPath); } catch (e) {}
      return;
    }

    // Refuse symlinks and oversized files
    let isActive = false;
    try {
      const stat = fs.lstatSync(flagPath);
      if (!stat.isSymbolicLink() && stat.size <= 64) isActive = true;
    } catch (e) {}

    if (isActive) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext:
            'CRITIQUE MODE ACTIVE. Surface real problems first. ' +
            'Questionable decisions: explain why and what\'s better. ' +
            'Praise only the non-obvious. Order by impact. No sugarcoating.'
        }
      }));
    }
  } catch (e) {
    if (process.env.DEBUG_CRITIQUE) process.stderr.write('[critica-tracker] ' + e.stack + '\n');
  }
});
