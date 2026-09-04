# Optional: put Qwen2.5-7B Instruct Q4_K_M onto the USB stick (~4.68 GB).
# Better at following tool calls than Gemma 3n. Needs ~8 GB VRAM (RTX 4060).
# Does NOT require an India-pharma-trained model — prompting + tools handle that.
#
# Usage (PowerShell):
#   powershell -NoProfile -ExecutionPolicy Bypass -File F:\gemma\Fetch-Qwen.ps1 -Drive F:

param([string]$Drive = 'F:')

$ErrorActionPreference = 'Stop'
$destDir = Join-Path $Drive 'gemma\models'
$out = Join-Path $destDir 'Qwen2.5-7B-Instruct-Q4_K_M.gguf'
if (-not (Test-Path "$Drive\")) { throw "Drive $Drive not found." }
New-Item -ItemType Directory -Force -Path $destDir | Out-Null

if (Test-Path $out) {
  $mb = [math]::Round((Get-Item $out).Length / 1MB, 1)
  if ($mb -gt 4000) {
    Write-Host "Already present: $out ($mb MB)"
    exit 0
  }
  Write-Host "Incomplete file ($mb MB). Resuming download..."
}

$url = 'https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf'
Write-Host "Downloading Qwen2.5-7B-Instruct Q4_K_M onto $out"
Write-Host "This is large. Leave the window open. curl will resume if interrupted."
curl.exe -L --fail --retry 5 -C - -o $out $url
Write-Host "Done. Close Local Analyst and double-click Start Analyst.bat — Qwen is preferred automatically."
