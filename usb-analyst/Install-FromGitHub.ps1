# Pull Local Analyst onto F:\ from this GitHub branch, then you double-click Start Analyst.bat
param([string]$Drive = 'F:', [string]$Branch = 'cursor/usb-business-analyst-2edd')

$ErrorActionPreference = 'Stop'
if (-not (Test-Path "$Drive\")) { throw "Drive $Drive not found." }

$dest = Join-Path $Drive 'gemma'
New-Item -ItemType Directory -Force -Path $dest, "$dest\dashboard", "$dest\models", "$dest\data", "$dest\reports" | Out-Null

$base = "https://raw.githubusercontent.com/Dhruvinmodi11/AI-IDS/$Branch/usb-analyst"
$files = @{
  'Start-Analyst.ps1' = "$dest\Start-Analyst.ps1"
  'Start Analyst.bat' = "$dest\Start Analyst.bat"
  'USB-Root-Start-Analyst.bat' = "$Drive\Start Analyst.bat"
  'Fetch-Qwen.ps1' = "$dest\Fetch-Qwen.ps1"
  'dashboard/index.html' = "$dest\dashboard\index.html"
  'dashboard/styles.css' = "$dest\dashboard\styles.css"
  'dashboard/app.js' = "$dest\dashboard\app.js"
  'dashboard/agent-lib.js' = "$dest\dashboard\agent-lib.js"
  'README.txt' = "$dest\README.txt"
  'data/01_shop_small.csv' = "$dest\data\01_shop_small.csv"
  'data/02_monthly_spend.csv' = "$dest\data\02_monthly_spend.csv"
  'data/PROMPTS.txt' = "$dest\data\PROMPTS.txt"
  'data/EXPECTED_ANSWERS.txt' = "$dest\data\EXPECTED_ANSWERS.txt"
}

foreach ($rel in $files.Keys) {
  $url = "$base/$($rel.Replace('\','/').Replace(' ','%20'))"
  $out = $files[$rel]
  Write-Host "GET $rel"
  curl.exe -L --fail --retry 5 -o $out $url
}

Write-Host ""
Write-Host "Done. Close any old Local Analyst / Kobold window."
Write-Host "Double-click $Drive\Start Analyst.bat"
Write-Host "Keep the GGUF in $dest\models\. Optional: $dest\Fetch-Qwen.ps1"
