# init.ps1 - Embinder startup harness (Windows PowerShell, pure ASCII).
# Installs deps, runs the baseline verification, and prints the start command.
# Usage:
#   .\init.ps1                 # install + verify + print start command
#   $env:RUN_START_COMMAND=1; .\init.ps1   # also launch the dev servers
#
# If verification fails, STOP and fix the baseline before doing anything else.

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

# --- edit these three for your project --------------------------------------
$INSTALL_CMD = 'npm install'
$VERIFY_CMD  = 'npm run typecheck; if ($LASTEXITCODE -ne 0) { exit 1 }; npm run e2e'
$START_CMD   = 'npm run dev'   # relay :7331 + todo :5173 together
# ----------------------------------------------------------------------------

Write-Host "[init] cwd: $(Get-Location)" -ForegroundColor Cyan
Write-Host "[init] node: $(node --version)  npm: $(npm --version)"

Write-Host "[init] install: $INSTALL_CMD" -ForegroundColor Cyan
Invoke-Expression $INSTALL_CMD
if ($LASTEXITCODE -ne 0) { Write-Host "[init] install FAILED" -ForegroundColor Red; exit 1 }

Write-Host "[init] verify: $VERIFY_CMD" -ForegroundColor Cyan
Invoke-Expression $VERIFY_CMD
if ($LASTEXITCODE -ne 0) {
  Write-Host "[init] VERIFY FAILED - fix the baseline before writing any code." -ForegroundColor Red
  exit 1
}
Write-Host "[init] baseline GREEN (typecheck + e2e)" -ForegroundColor Green

Write-Host ""
Write-Host "[init] start command:" -ForegroundColor Cyan
Write-Host "         $START_CMD"
Write-Host "         app:       http://localhost:5173"
Write-Host "         approvals: http://127.0.0.1:7331/approve   (keep on a 2nd window)"

if ($env:RUN_START_COMMAND -eq '1') {
  Write-Host "[init] RUN_START_COMMAND=1 -> launching start command" -ForegroundColor Cyan
  Invoke-Expression $START_CMD
}
