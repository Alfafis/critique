#!/usr/bin/env node
// critique — Claude Code SessionStart activation hook

const fs = require('fs');
const path = require('path');

const S = require('./critica-settings.js');
const badge = require('./critica-badge.js');

const claudeDir = S.claudeDir();
const flagPath = path.join(claudeDir, '.critique-active');

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

function isCritiqueHook(hook) {
  const cmd = (hook && hook.command) || '';
  return cmd.includes('critica-activate') || cmd.includes('critica-tracker');
}

// MIGRATION — remove in 1.6.0.
//
// Versions up to 1.3.1 copied this plugin's hooks into ~/.claude/settings.json while
// hooks/hooks.json already declared them. Both fired, so every session start and every
// prompt ran the hook twice. The settings.json copy also hardcoded the versioned plugin
// cache path, so it pointed at a deleted directory after any upgrade and survived
// uninstall. hooks/hooks.json is now the single source of registration.
//
// This is the only thing that writes to settings.json without the user asking, and it
// only ever removes this plugin's own stale entries — it never adds anything, and it
// does not write at all when there is nothing to remove.
function cleanupLegacyHooks() {
  try {
    return runCleanup(S.settingsPath(claudeDir));
  } catch (e) {
    S.debug('cleanupLegacyHooks', e.message);
    return false;
  }
}

function runCleanup(file) {
  return S.withSettingsLock(claudeDir, () => {
    const settings = S.readSettings(file);
    if (settings === S.UNREADABLE) {
      process.stderr.write(
        '[critique] ' + file + ' is not valid JSON — skipping legacy hook cleanup.\n' +
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
    return S.writeSettings(file, settings);
  });
}

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
  // Only refreshes a badge the user installed with /critique:badge. Never creates one.
  badge.refreshIfInstalled(claudeDir, process.platform === 'win32');
  process.stdout.write(MESSAGES[lang] || MESSAGES['en']);
}

module.exports = { safeWriteFlag, cleanupLegacyHooks, detectLang, MESSAGES };
