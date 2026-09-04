# Pull Local Analyst onto F:\ from this GitHub branch, then you double-click Start Analyst.bat
param([string]$Drive = 'F:', [string]$Branch = 'cursor/usb-business-analyst-2edd')

$ErrorActionPreference = 'Stop'
if (-not (Test-Path "$Drive\")) { throw "Drive $Drive not found." }

$dest = Join-Path $Drive 'gemma'
New-Item -ItemType Directory -Force -Path $dest, "$dest\dashboard", "$dest\models", "$dest\data" | Out-Null

$base = "https://raw.githubusercontent.com/Dhruvinmodi11/AI-IDS/$Branch/usb-analyst"
$files = @{
  'Start-Analyst.ps1' = "$dest\Start-Analyst.ps1"
  'Start Analyst.bat' = "$dest\Start Analyst.bat"
  'USB-Root-Start-Analyst.bat' = "$Drive\Start Analyst.bat"
  'dashboard/index.html' = "$dest\dashboard\index.html"
  'dashboard/styles.css' = "$dest\dashboard\styles.css"
  'dashboard/app.js' = "$dest\dashboard\app.js"
  'README.txt' = "$dest\README.txt"
}

foreach ($rel in $files.Keys) {
  $url = "$base/$($rel.Replace('\','/').Replace(' ','%20'))"
  $out = $files[$rel]
  Write-Host "GET $rel"
  curl.exe -L --fail --retry 5 -o $out $url
}

Write-Host ""
Write-Host "Done. Close KoboldCpp if it is still running."
Write-Host "Double-click $Drive\Start Analyst.bat"
Write-Host "Keep $dest\models\google_gemma-3n-E4B-it-Q4_K_M.gguf in place."
