# Arranca el agente en segundo plano, sin ventana. Lo usan el arranque con
# Windows y "npm run arrancar". Si ya hay un agente en marcha, no hace nada.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$logs = Join-Path $env:LOCALAPPDATA 'contador'
$port = if ($env:CONTADOR_PORT) { [int]$env:CONTADOR_PORT } else { 5611 }

if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
  Write-Output 'El agente ya estaba en marcha.'
  exit 0
}

New-Item -ItemType Directory -Force $logs | Out-Null
$node = (Get-Command node).Source
Start-Process -FilePath $node `
  -ArgumentList '--disable-warning=ExperimentalWarning', 'agent/src/index.ts' `
  -WorkingDirectory $root -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logs 'agente.log') `
  -RedirectStandardError (Join-Path $logs 'agente-error.log')
Write-Output "Agente arrancado en segundo plano. Panel: http://127.0.0.1:$port"
