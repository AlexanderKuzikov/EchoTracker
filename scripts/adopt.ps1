# Встраивает EchoTracker в проект: копирует всё кроме данных, сборок и секретов в <Target>\echo
param([Parameter(Mandatory = $true)][string]$Target)

$src = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $Target 'echo'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
robocopy $src $dest /E /XD node_modules .git data uploads dist web\dist api\data /XF .env | Out-Null
$ignore = Join-Path $Target '.gitignore'
$lines = @('echo/data/', 'echo/uploads/', 'echo/.env')
if (Test-Path -LiteralPath $ignore) {
  $have = Get-Content -LiteralPath $ignore
} else {
  $have = @()
  New-Item -ItemType File -Path $ignore | Out-Null
}
foreach ($l in $lines) {
  if ($have -notcontains $l) {
    Add-Content -LiteralPath $ignore -Value $l
  }
}
Write-Output "echo -> $dest"
Write-Output 'Caddy: handle /echo/* { reverse_proxy 127.0.0.1:8100 }'
Write-Output 'ENV: ECHO_BASE=/echo/ BASE_URL=https://<домен>/echo PORT=8100'
