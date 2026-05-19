#!/usr/bin/env node
// critique — UserPromptSubmit hook
// Per-turn reinforcement: keeps critique mindset in model attention every message

const fs = require('fs');
const path = require('path');
const os = require('os');

const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const flagPath = path.join(claudeDir, '.critique-active');

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const prompt = (data.prompt || '').trim();

    // Deactivation — EN + PT
    if (/\b(critique|critica)\b.*\b(off|disable|stop|desativa)\b/i.test(prompt) ||
        /\b(disable|turn off|stop|desativa|sem)\b.*\b(critique|critica)\b/i.test(prompt) ||
        /\bcritica\s+off\b/i.test(prompt)) {
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
  } catch (e) {}
});
