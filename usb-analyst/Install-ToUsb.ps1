# Copies Local Analyst onto the USB stick (default F:\).
# Run in PowerShell AFTER you copy this usb-analyst folder onto the PC,
# or run it from the cloned repo:  .\usb-analyst\Install-ToUsb.ps1

param(
  [string]$Drive = 'F:',
  [string]$Source = ''
)

$ErrorActionPreference = 'Stop'
if (-not $Source) { $Source = Split-Path -Parent $MyInvocation.MyCommand.Path }

$dest = Join-Path $Drive 'gemma'
if (-not (Test-Path "$Drive\")) { throw "Drive $Drive not found. Plug in the SanDisk and pass -Drive E: if needed." }

New-Item -ItemType Directory -Force -Path $dest, "$dest\dashboard", "$dest\models", "$dest\data", "$dest\bin" | Out-Null

Copy-Item -Force "$Source\Start-Analyst.ps1" $dest
Copy-Item -Force "$Source\Start Analyst.bat" $dest
Copy-Item -Force "$Source\dashboard\*" "$dest\dashboard" -Recurse
Copy-Item -Force "$Source\USB-Root-Start-Analyst.bat" (Join-Path $Drive 'Start Analyst.bat')

Write-Host ""
Write-Host "Installed to $dest"
Write-Host "Launcher on USB root: $Drive\Start Analyst.bat"
Write-Host ""
Write-Host "Keep your GGUF at $dest\models\google_gemma-3n-E4B-it-Q4_K_M.gguf"
Write-Host "Windows will NOT auto-start on insert. Double-click Start Analyst.bat"
Write-Host "First run downloads llama.cpp (~30 MB) into $dest\bin\llama"
