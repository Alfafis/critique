#!/usr/bin/env node
// critique — Claude Code SessionStart activation hook

const fs = require('fs');
const path = require('path');
const os = require('os');

const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const flagPath = path.join(claudeDir, '.critique-active');
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..', '..');

const BADGE_BEGIN = '# >>> critique badge >>>';
const BADGE_END = '# <<< critique badge <<<';
const BADGE_BEGIN_PS = '# >>> critique badge >>>';
const BADGE_END_PS = '# <<< critique badge <<<';

// Sentinel for "settings.json exists but could not be understood". Distinct from {}
// (file absent), because overwriting an unreadable settings.json destroys the user's
// entire global config — model, permissions, env, MCP servers.
const UNREADABLE = Symbol('settings-unreadable');

function debug(where, message) {
  if (process.env.DEBUG_CRITIQUE) process.stderr.write('[critica-activate] ' + where + ': ' + message + '\n');
}

// Refusing to write through a symlink stops an attacker from redirecting the flag at an
// arbitrary file. Refusing and stopping there was a dead end: the flag stayed a symlink,
// every later write refused too, and critique never activated again in any session with
// no error anywhere. Unlinking removes the link itself, never its target, so the guard
// holds and the plugin recovers on the next session start.
function safeWriteFlag(filePath, content) {
  try {
    try { if (fs.lstatSync(path.dirname(filePath)).isSymbolicLink()) return; } catch (e) {}
    try { if (fs.lstatSync(filePath).isSymbolicLink()) fs.unlinkSync(filePath); } catch (e) {}
    const tmp = filePath + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, filePath);
  } catch (e) {}
}

// --- settings.json access -------------------------------------------------

// Returns {} when the file does not exist, UNREADABLE when it exists but is not
// valid JSON object. Never returns {} for a file we failed to understand.
function readSettings(settingsPath) {
  let raw;
  try {
    raw = fs.readFileSync(settingsPath, 'utf8');
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
function writeSettings(settingsPath, settings) {
  let mode = 0o600;
  try { mode = fs.statSync(settingsPath).mode & 0o777; } catch (e) {}
  const tmp = settingsPath + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', { encoding: 'utf8', mode });
    fs.renameSync(tmp, settingsPath);
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

// --- legacy hook cleanup --------------------------------------------------

function isCritiqueHook(hook) {
  const cmd = (hook && hook.command) || '';
  return cmd.includes('critica-activate') || cmd.includes('critica-tracker');
}

// Versions up to 1.3.1 copied this plugin's hooks into ~/.claude/settings.json
// while hooks/hooks.json already declared them. Both fired, so every session start
// and every prompt ran the hook twice. The settings.json copy also hardcoded the
// versioned plugin cache path, so it pointed at a deleted directory after any
// upgrade and survived uninstall. Remove those entries; hooks/hooks.json is the
// single source of registration.
function cleanupLegacyHooks() {
  const settingsPath = path.join(claudeDir, 'settings.json');
  try {
    return runCleanup(settingsPath);
  } catch (e) {
    debug('cleanupLegacyHooks', e.message);
    return false;
  }
}

function runCleanup(settingsPath) {
  return withSettingsLock(claudeDir, () => {
    const settings = readSettings(settingsPath);
    if (settings === UNREADABLE) {
      process.stderr.write(
        '[critique] ' + settingsPath + ' is not valid JSON — skipping legacy hook cleanup.\n' +
        'Fix the file to remove duplicated critique hooks.\n'
      );
      return false;
    }
    if (!settings.hooks || typeof settings.hooks !== 'object') return false;

    let changed = false;
    for (const event of ['SessionStart', 'UserPromptSubmit']) {
      const groups = settings.hooks[event];
      if (!Array.isArray(groups)) continue;
      const kept = [];
      for (const group of groups) {
        if (!group || !Array.isArray(group.hooks)) { kept.push(group); continue; }
        const hooks = group.hooks.filter(h => !isCritiqueHook(h));
        if (hooks.length !== group.hooks.length) changed = true;
        if (hooks.length > 0) kept.push(Object.assign({}, group, { hooks }));
      }
      if (kept.length > 0) settings.hooks[event] = kept;
      else if (groups.length > 0) { delete settings.hooks[event]; changed = true; }
    }
    if (!changed) return false;
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
    return writeSettings(settingsPath, settings);
  });
}

// --- statusline badge -----------------------------------------------------

function setupStatusline() {
  try {
    const isWindows = process.platform === 'win32';
    const hooksDir = path.join(claudeDir, 'hooks');
    try { fs.mkdirSync(hooksDir, { recursive: true }); } catch (e) {}

    const scriptName = isWindows ? 'critica-statusline.ps1' : 'critica-statusline.sh';
    const destPath = path.join(hooksDir, scriptName);
    const srcPath = path.join(pluginRoot, 'src', 'hooks', scriptName);

    fs.copyFileSync(srcPath, destPath);
    if (!isWindows) fs.chmodSync(destPath, 0o755);

    const settingsPath = path.join(claudeDir, 'settings.json');
    withSettingsLock(claudeDir, () => {
      const settings = readSettings(settingsPath);
      if (settings === UNREADABLE) {
        process.stderr.write(
          '[critique] ' + settingsPath + ' is not valid JSON — statusline badge not registered.\n' +
          'Fix the file, or add the badge manually: ' + destPath + '\n'
        );
        return false;
      }
      if (!settings.statusLine) {
        settings.statusLine = { type: 'command', command: buildStatusLineCommand(destPath, isWindows) };
        return writeSettings(settingsPath, settings);
      }
      const injected = injectIntoBadgeAggregator(settings.statusLine, destPath, isWindows);
      if (!injected) {
        process.stderr.write(
          '[critique] statusline badge could not be injected — existing statusLine is not a shell script.\n' +
          'To enable the [CRITIQUE] badge, set DEBUG_CRITIQUE=1 for details or manually add: ' + destPath + '\n'
        );
      }
      return injected;
    });
  } catch (e) {
    debug('statusline', e.message);
  }
}

// The statusLine command is handed to a shell by Claude Code. On Windows that shell is
// cmd.exe, which does not treat single quotes as quoting — a single-quoted path would
// reach powershell.exe with the quotes intact and -File would fail. Double quotes are
// required there. The backslashes are NOT escaped: JSON.stringify handles that when
// settings.json is serialized, and pre-escaping produced a literal C:\\dir\\x.ps1.
function buildStatusLineCommand(destPath, isWindows) {
  return isWindows
    ? 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + destPath + '"'
    : 'bash "' + destPath + '"';
}

function extractScriptPath(cmd, extension) {
  for (const quote of ['"', "'"]) {
    const m = cmd.match(new RegExp(quote + '([^' + quote + ']+\\.' + extension + ')' + quote, 'i'));
    if (m) return m[1];
  }
  const bare = cmd.match(new RegExp('(\\S+\\.' + extension + ')', 'i'));
  return bare ? bare[1] : null;
}

// Single-quote for the shell that will actually parse the injected line. Both bash and
// PowerShell interpolate inside double quotes, so a path containing $ (legal in a
// Windows username, e.g. C:\Users\dev$\...) would be mangled. Neither expands inside
// single quotes; both escape an embedded single quote by their own rule.
function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function powershellQuote(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function buildBadgeCallBlock(critiqueBadgePath, isWindows) {
  if (isWindows) {
    const p = powershellQuote(critiqueBadgePath);
    return [BADGE_BEGIN_PS, 'if (Test-Path ' + p + ') { & ' + p + ' }', BADGE_END_PS];
  }
  const p = shellQuote(critiqueBadgePath);
  return [BADGE_BEGIN, '[ -f ' + p + ' ] && bash ' + p, BADGE_END];
}

function detectEol(content) {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

// Splices the badge call into the user's own statusline script, delimited by markers
// so it can be located and removed later. Appending blindly is wrong: aggregator
// scripts commonly end in `exit 0`, which makes a trailing line unreachable — the
// badge silently never renders while this function reports success.
//
// blockLines is a line array, not a pre-joined string, so the target file's own line
// ending wins. Splicing LF lines into a CRLF .ps1 leaves mixed endings.
function spliceBadgeCall(content, blockLines, isWindows) {
  const block = Array.isArray(blockLines) ? blockLines : String(blockLines).split(/\r?\n/);
  const eol = detectEol(content);
  const lines = content.split(/\r?\n/);
  const exitRe = /^\s*exit\b/i;
  let insertAt = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (exitRe.test(lines[i])) { insertAt = i; break; }
  }
  if (insertAt === -1) {
    const needsEol = content.length > 0 && !/\r?\n$/.test(content);
    return content + (needsEol ? eol : '') + block.join(eol) + eol;
  }
  lines.splice(insertAt, 0, ...block);
  return lines.join(eol);
}

function injectIntoBadgeAggregator(statusLine, critiqueBadgePath, isWindows) {
  try {
    if (!statusLine || statusLine.type !== 'command') return false;
    const cmd = statusLine.command || '';
    const targetScript = extractScriptPath(cmd, isWindows ? 'ps1' : 'sh');
    if (!targetScript) return false;
    if (path.resolve(targetScript) === path.resolve(critiqueBadgePath)) return true;

    let content;
    try { content = fs.readFileSync(targetScript, 'utf8'); } catch (e) { return false; }
    if (content.includes('critica-statusline')) return true;

    const block = buildBadgeCallBlock(critiqueBadgePath, isWindows);
    fs.writeFileSync(targetScript, spliceBadgeCall(content, block, isWindows), { encoding: 'utf8' });
    return true;
  } catch (e) {
    debug('inject', e.message);
    return false;
  }
}

// --- language detection ---------------------------------------------------

function detectLang() {
  const override = (process.env.CRITIQUE_LANG || '').toLowerCase();
  if (/^pt/.test(override)) return 'pt';
  if (/^es/.test(override)) return 'es';
  if (/^fr/.test(override)) return 'fr';
  if (/^en/.test(override)) return 'en';

  const envLang = process.env.LANG || process.env.LC_ALL || process.env.LANGUAGE || '';
  if (/^pt/i.test(envLang)) return 'pt';
  if (/^es/i.test(envLang)) return 'es';
  if (/^fr/i.test(envLang)) return 'fr';

  if (process.platform === 'win32') {
    try {
      const { execSync } = require('child_process');
      const culture = execSync(
        'powershell -NoProfile -Command "(Get-Culture).Name"',
        { encoding: 'utf8', timeout: 2000 }
      ).trim();
      if (/^pt/i.test(culture)) return 'pt';
      if (/^es/i.test(culture)) return 'es';
      if (/^fr/i.test(culture)) return 'fr';
    } catch (e) {}
  }

  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (/^pt/i.test(locale)) return 'pt';
    if (/^es/i.test(locale)) return 'es';
    if (/^fr/i.test(locale)) return 'fr';
  } catch (e) {}

  return 'en';
}

const MESSAGES = {
  en:
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
    '"desativa critica" / "sem critica" / "critica off" / "desactiva critica" / "désactive critique".',

  pt:
    'MODO CRÍTICA ATIVO — mindset crítico permanente\n\n' +
    'Em todo trabalho — código, brainstorm, plano, arquitetura, decisões:\n\n' +
    '**Problemas reais** — bugs, falhas de segurança, comportamentos inesperados, edge cases não tratados. ' +
    'Só o que realmente quebra ou causa dano.\n\n' +
    '**Decisões questionáveis** — escolhas de design, arquitetura ou implementação que vão criar problema no futuro. ' +
    'Explique por que e qual seria a alternativa melhor.\n\n' +
    '**O que está bom** — só mencione se for não óbvio e vale reforçar. Não elogie o básico.\n\n' +
    '**Prioridade** — ordene os achados por impacto real, não por facilidade de fix.\n\n' +
    'Sem suavizar. Sem "mas no geral está ótimo". Se tem problema sério, diga que é sério.\n\n' +
    '## Persistência\n\n' +
    'ATIVO EM TODO TRABALHO. Não reverte. Aplica a: código, revisão, brainstorm, plano, arquitetura, decisões.\n' +
    'Desativa só se o usuário pedir explicitamente: "critica off" / "sem critica" / "desativa critica" / ' +
    '"critique off" / "disable critique" / "stop critique".',

  es:
    'MODO CRÍTICA ACTIVO — mentalidad crítica permanente\n\n' +
    'En todo trabajo — código, brainstorm, plan, arquitectura, decisiones:\n\n' +
    '**Problemas reales** — bugs, fallos de seguridad, comportamientos inesperados, casos límite no manejados. ' +
    'Solo lo que realmente rompe o causa daño.\n\n' +
    '**Decisiones cuestionables** — elecciones de diseño, arquitectura o implementación que causarán problemas en el futuro. ' +
    'Explica por qué y cuál sería la mejor alternativa.\n\n' +
    '**Lo que está bien** — menciona solo si no es obvio y vale la pena reforzar. No elogies lo básico.\n\n' +
    '**Prioridad** — ordena los hallazgos por impacto real, no por facilidad de fix.\n\n' +
    'Sin suavizar. Sin "pero en general se ve bien". Si hay un problema serio, di que es serio.\n\n' +
    '## Persistencia\n\n' +
    'ACTIVO EN TODO EL TRABAJO. No se revierte. Aplica a: código, revisión, brainstorm, plan, arquitectura, decisiones.\n' +
    'Desactiva solo si el usuario lo pide explícitamente: "critica off" / "desactiva critica" / "sin critica" / ' +
    '"critique off" / "disable critique" / "stop critique".',

  fr:
    'MODE CRITIQUE ACTIF — esprit critique permanent\n\n' +
    'Dans tout travail — code, brainstorm, plan, architecture, décisions :\n\n' +
    '**Vrais problèmes** — bugs, failles de sécurité, comportements inattendus, cas limites non traités. ' +
    'Seulement ce qui casse vraiment ou cause des dégâts.\n\n' +
    '**Décisions discutables** — choix de conception, d\'architecture ou d\'implémentation qui causeront des problèmes plus tard. ' +
    'Expliquer pourquoi et quelle est la meilleure alternative.\n\n' +
    '**Ce qui est bien** — mentionner seulement si non évident et mérite d\'être souligné. Ne pas louer l\'évident.\n\n' +
    '**Priorité** — ordonner les résultats par impact réel, non par facilité de correction.\n\n' +
    'Pas de ménagement. Pas de "mais dans l\'ensemble ça a l\'air bien". S\'il y a un problème sérieux, dire que c\'est sérieux.\n\n' +
    '## Persistance\n\n' +
    'ACTIF DANS TOUT LE TRAVAIL. Ne se réinitialise pas. S\'applique à : code, révision, brainstorm, plan, architecture, décisions.\n' +
    'Désactiver seulement si l\'utilisateur le demande explicitement : "critique off" / "désactive critique" / "sans critique" / ' +
    '"disable critique" / "stop critique".',
};

if (require.main === module) {
  const lang = detectLang();
  safeWriteFlag(flagPath, 'active:' + lang + ':' + Math.floor(Date.now() / 1000));
  cleanupLegacyHooks();
  setupStatusline();
  process.stdout.write(MESSAGES[lang] || MESSAGES['en']);
}

module.exports = {
  UNREADABLE,
  safeWriteFlag,
  readSettings,
  writeSettings,
  withSettingsLock,
  cleanupLegacyHooks,
  setupStatusline,
  buildStatusLineCommand,
  buildBadgeCallBlock,
  shellQuote,
  powershellQuote,
  extractScriptPath,
  spliceBadgeCall,
  injectIntoBadgeAggregator,
  detectLang,
  MESSAGES,
};
