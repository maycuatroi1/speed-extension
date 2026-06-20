# FB Speed — install helper (Windows / PowerShell)
#
# Chrome (stable) blocks loading unpacked extensions from the command line, so
# the final "Load unpacked" click must happen in the UI. This script does
# everything around it: pulls the latest code, copies the folder path to your
# clipboard, and opens chrome://extensions for you.
#
# Usage:   powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = 'SilentlyContinue'
$dir = $PSScriptRoot
if (-not $dir) { $dir = (Get-Location).Path }

Write-Host "FB Speed extension folder:" -ForegroundColor Cyan
Write-Host "  $dir`n"

# 1) Update to latest if this is a git checkout
if (Test-Path (Join-Path $dir '.git')) {
  Write-Host "Pulling latest from GitHub..." -ForegroundColor Cyan
  git -C $dir pull --ff-only
  Write-Host ""
}

# 2) Put the path on the clipboard so you can paste it into the folder picker
Set-Clipboard -Value $dir
Write-Host "Path copied to clipboard (Ctrl+V in the folder picker)." -ForegroundColor Green

# 3) Open the extensions page
$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($chrome) {
  Start-Process $chrome "chrome://extensions"
} else {
  Write-Host "Chrome not found - open chrome://extensions manually." -ForegroundColor Yellow
}

Write-Host @"

Finish in the Chrome tab that just opened:
  1. Turn ON 'Developer mode' (top-right toggle)
  2. Click 'Load unpacked'
  3. Paste the path (Ctrl+V) or pick the folder above, then 'Select Folder'
  4. Open/refresh facebook.com - click the puzzle icon to pin 'FB Speed'

To update later: run this script again, then click the reload (circular arrow)
icon on the FB Speed card in chrome://extensions.
"@ -ForegroundColor White
