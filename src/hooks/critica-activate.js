#!/usr/bin/env node
// critique — Claude Code SessionStart activation hook

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

safeWriteFlag(flagPath, 'active');

const output =
  'CRITIQUE MODE ACTIVE — permanent critical mindset\n\n' +
  'In all work — code, brainstorm, plan, architecture, decisions:\n\n' +
  '**Real problems** — bugs, security flaws, unexpected behaviors, unhandled edge cases. ' +
  'Only what actually breaks or causes damage.\n\n' +
  '**Questionable decisions** — design, architecture or implementation choices that will cause problems later. ' +
  'Explain why and what the better alternative is.\n\n' +
  '**What\'s good** — mention only if non-obvious and worth reinforcing. Do not praise the obvious.\n\n' +
  '**Priority** — order findings by real impact, not ease of fix.\n\n' +
  'No sugarcoating. No "but overall it looks great". If there\'s a serious problem, say it\'s serious.\n\n' +
  '## Persistence\n\n' +
  'ACTIVE IN ALL WORK. Does not revert. Applies to: code, review, brainstorm, plan, architecture, decisions.\n' +
  'Off only if user explicitly asks: "critique off" / "disable critique" / "stop critique" / ' +
  '"desativa critica" / "sem critica" / "critica off".';

process.stdout.write(output);
