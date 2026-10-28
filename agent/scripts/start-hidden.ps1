# Arranque con Windows: lanza "npm run arrancar" (agent/src/start.ts) sin ventana.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
& (Get-Command node).Source --disable-warning=ExperimentalWarning agent/src/start.ts
