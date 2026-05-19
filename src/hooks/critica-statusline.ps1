$ClaudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME ".claude" }
$Flag = Join-Path $ClaudeDir ".critique-active"
if (-not (Test-Path $Flag)) { exit 0 }

try {
    $Item = Get-Item -LiteralPath $Flag -Force -ErrorAction Stop
    if ($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { exit 0 }
    if ($Item.Length -gt 64) { exit 0 }
} catch {
    exit 0
}

$Esc = [char]27
[Console]::Write("${Esc}[38;5;196m[CRITIQUE]${Esc}[0m")
