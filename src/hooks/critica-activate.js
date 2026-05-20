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
setupStatusline();

function setupStatusline() {
  try {
    const isWindows = process.platform === 'win32';
    const hooksDir = path.join(claudeDir, 'hooks');
    try { fs.mkdirSync(hooksDir, { recursive: true }); } catch (e) {}

    const scriptName = isWindows ? 'critica-statusline.ps1' : 'critica-statusline.sh';
    const scriptPath = path.join(hooksDir, scriptName);

    if (isWindows) {
      const ps1 = [
        '$ClaudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME ".claude" }',
        '$Flag = Join-Path $ClaudeDir ".critique-active"',
        'if (-not (Test-Path $Flag)) { exit 0 }',
        'try {',
        '    $Item = Get-Item -LiteralPath $Flag -Force -ErrorAction Stop',
        '    if ($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { exit 0 }',
        '    if ($Item.Length -gt 64) { exit 0 }',
        '} catch { exit 0 }',
        '$Esc = [char]27',
        '[Console]::Write("${Esc}[38;5;196m[CRITIQUE]${Esc}[0m")',
      ].join('\r\n');
      fs.writeFileSync(scriptPath, ps1, { encoding: 'utf8' });
    } else {
      const sh = [
        '#!/usr/bin/env bash',
        'CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"',
        'FLAG="$CLAUDE_DIR/.critique-active"',
        '[ -f "$FLAG" ] || exit 0',
        '[ -L "$FLAG" ] && exit 0',
        'SIZE=$(wc -c < "$FLAG" 2>/dev/null || echo 999)',
        '[ "$SIZE" -le 64 ] || exit 0',
        "printf '\\033[38;5;196m[CRITIQUE]\\033[0m'",
      ].join('\n');
      fs.writeFileSync(scriptPath, sh, { encoding: 'utf8', mode: 0o755 });
    }

    // Set statusLine in settings.json only if not already configured
    const settingsPath = path.join(claudeDir, 'settings.json');
    let settings = {};
    try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch (e) {}
    if (!settings.statusLine) {
      const cmd = isWindows
        ? 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + scriptPath.replace(/\\/g, '\\\\') + '"'
        : 'bash "' + scriptPath + '"';
      settings.statusLine = { type: 'command', command: cmd };
      const tmp = settingsPath + '.' + process.pid + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), { encoding: 'utf8' });
      fs.renameSync(tmp, settingsPath);
    }
  } catch (e) {
    if (process.env.DEBUG_CRITIQUE) process.stderr.write('[critica-activate] statusline: ' + e.message + '\n');
  }
}

function detectLang() {
  // Explicit override via env var (most reliable on Windows)
  const override = (process.env.CRITIQUE_LANG || '').toLowerCase();
  if (/^pt/.test(override)) return 'pt';
  if (/^es/.test(override)) return 'es';
  if (/^fr/.test(override)) return 'fr';
  if (/^en/.test(override)) return 'en';

  // POSIX env vars (Linux/Mac — not set on Windows)
  const envLang = process.env.LANG || process.env.LC_ALL || process.env.LANGUAGE || '';
  if (/^pt/i.test(envLang)) return 'pt';
  if (/^es/i.test(envLang)) return 'es';
  if (/^fr/i.test(envLang)) return 'fr';

  // System locale via Intl (unreliable on Windows — returns display language, not Claude lang)
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

process.stdout.write(MESSAGES[detectLang()]);
