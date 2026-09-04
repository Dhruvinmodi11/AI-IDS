# Local Analyst — starts llama.cpp + the business dashboard (no KoboldCpp).
# Double-click "Start Analyst.bat" on the USB stick.

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Root) { $Root = 'F:\gemma' }
Set-Location $Root

$DashDir = Join-Path $Root 'dashboard'
$BinDir  = Join-Path $Root 'bin\llama'
$ModelDir = Join-Path $Root 'models'
$ApiPort = 8091
$UiPort  = 8050
$ApiBase = "http://127.0.0.1:$ApiPort"

function Test-Port($port) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $c.Connect('127.0.0.1', $port)
    $c.Close()
    return $true
  } catch { return $false }
}

function Get-Model {
  $m = Get-ChildItem -Path $ModelDir -Filter *.gguf -ErrorAction SilentlyContinue |
    Sort-Object Length -Descending | Select-Object -First 1
  if (-not $m) { throw "No .gguf model in $ModelDir. Keep google_gemma-3n-E4B-it-Q4_K_M.gguf there." }
  return $m.FullName
}

function Find-VulkanAsset($rel) {
  return $rel.assets | Where-Object { $_.name -match 'llama-.*-bin-win-vulkan-x64\.zip$' } | Select-Object -First 1
}

function Get-LlamaVulkanZip {
  $headers = @{ 'User-Agent' = 'LocalAnalyst' }
  $api = 'https://api.github.com/repos/ggml-org/llama.cpp'

  $latest = Invoke-RestMethod -Uri "$api/releases/latest" -Headers $headers
  $asset = Find-VulkanAsset $latest
  if ($asset) { return $asset }

  $tag = $null
  $nightly = $latest.assets | Where-Object { $_.name -eq 'nightly-tag.txt' } | Select-Object -First 1
  if ($nightly) {
    try {
      $tag = (Invoke-WebRequest -Uri $nightly.browser_download_url -UseBasicParsing).Content.Trim()
    } catch {}
  }
  if (-not $tag -and $latest.body -match '\[(b\d+)\]') { $tag = $Matches[1] }
  if (-not $tag) { $tag = 'b10621' }

  $tagged = Invoke-RestMethod -Uri "$api/releases/tags/$tag" -Headers $headers
  $asset = Find-VulkanAsset $tagged
  if ($asset) { return $asset }

  $rels = Invoke-RestMethod -Uri "$api/releases?per_page=20" -Headers $headers
  foreach ($rel in $rels) {
    $asset = Find-VulkanAsset $rel
    if ($asset) { return $asset }
  }
  throw 'Could not find a Windows Vulkan llama.cpp zip on GitHub releases.'
}

function Install-LlamaServer {
  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  $exe = Join-Path $BinDir 'llama-server.exe'
  if (Test-Path $exe) { return $exe }

  Write-Host 'Downloading llama.cpp Windows Vulkan build (portable GPU)...'
  $asset = Get-LlamaVulkanZip
  Write-Host "Using $($asset.name)"
  $zip = Join-Path $env:TEMP $asset.name
  curl.exe -L --fail --retry 5 -o $zip $asset.browser_download_url
  Expand-Archive -Path $zip -DestinationPath $BinDir -Force
  $found = Get-ChildItem $BinDir -Recurse -Filter 'llama-server.exe' | Select-Object -First 1
  if (-not $found) { throw 'llama-server.exe missing after unzip.' }
  if ($found.DirectoryName -ne $BinDir) {
    Get-ChildItem $found.DirectoryName | Copy-Item -Destination $BinDir -Force
  }
  if (-not (Test-Path $exe)) { throw 'Failed to place llama-server.exe' }
  return $exe
}

function Start-Engine($exe, $model) {
  if (Test-Port $ApiPort) {
    Write-Host "llama.cpp already listening on $ApiPort"
    return $null
  }
  Write-Host "Starting llama-server with $model"
  $arg = @(
    '-m', $model,
    '--host', '127.0.0.1',
    '--port', "$ApiPort",
    '-c', '8192',
    '-ngl', '99',
    '--jinja'
  )
  $p = Start-Process -FilePath $exe -ArgumentList $arg -WorkingDirectory $BinDir -PassThru -WindowStyle Minimized
  return $p
}

function Wait-Engine {
  Write-Host 'Waiting for the model to load (first GPU start can take a minute)...'
  for ($i = 0; $i -lt 90; $i++) {
    foreach ($u in @("$ApiBase/health", "$ApiBase/v1/models")) {
      try {
        $r = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300) { return }
      } catch {}
    }
    Start-Sleep -Seconds 2
  }
  throw 'llama.cpp did not become ready. Check the llama-server window for errors.'
}

function Start-Dashboard {
  $prefix = "http://127.0.0.1:$UiPort/"
  if (-not ([Net.HttpListener]::IsSupported)) {
    $index = Join-Path $DashDir 'index.html'
    Start-Process $index
    Write-Host "Opened dashboard as a file. API is $ApiBase"
    return $null
  }
  $listen = New-Object Net.HttpListener
  $listen.Prefixes.Add($prefix)
  try {
    $listen.Start()
  } catch {
    Write-Host "Port $UiPort unavailable; opening dashboard file instead."
    Start-Process (Join-Path $DashDir 'index.html')
    return $null
  }
  Write-Host "Dashboard: $prefix"
  Start-Process $prefix
  return $listen
}

function Mime($path) {
  switch ([IO.Path]::GetExtension($path).ToLowerInvariant()) {
    '.html' { 'text/html; charset=utf-8' }
    '.css'  { 'text/css; charset=utf-8' }
    '.js'   { 'application/javascript; charset=utf-8' }
    '.svg'  { 'image/svg+xml' }
    '.json' { 'application/json' }
    default { 'application/octet-stream' }
  }
}

function Send-Bytes($ctx, $code, $type, $bytes) {
  $ctx.Response.StatusCode = $code
  $ctx.Response.ContentType = $type
  $ctx.Response.Headers.Add('Cache-Control', 'no-store')
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $ctx.Response.OutputStream.Close()
}

function Proxy-Api($ctx) {
  $url = $ApiBase + $ctx.Request.RawUrl
  $preq = [Net.HttpWebRequest]::Create($url)
  $preq.Method = $ctx.Request.HttpMethod
  $preq.Timeout = 180000
  $preq.ReadWriteTimeout = 180000
  if ($ctx.Request.ContentType) { $preq.ContentType = $ctx.Request.ContentType }
  if ($ctx.Request.AcceptTypes) { $preq.Accept = ($ctx.Request.AcceptTypes -join ',') }
  if ($ctx.Request.HttpMethod -in @('POST','PUT','PATCH')) {
    $ms = New-Object IO.MemoryStream
    $ctx.Request.InputStream.CopyTo($ms)
    $buf = $ms.ToArray()
    $preq.ContentLength = $buf.Length
    if (-not $preq.ContentType) { $preq.ContentType = 'application/json' }
    $os = $preq.GetRequestStream()
    $os.Write($buf, 0, $buf.Length)
    $os.Close()
  }
  try {
    $pres = $preq.GetResponse()
  } catch [Net.WebException] {
    $pres = $_.Exception.Response
    if (-not $pres) { throw }
  }
  $ctx.Response.StatusCode = [int]$pres.StatusCode
  if ($pres.ContentType) { $ctx.Response.ContentType = $pres.ContentType }
  $out = New-Object IO.MemoryStream
  $pres.GetResponseStream().CopyTo($out)
  $bytes = $out.ToArray()
  $pres.Close()
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $ctx.Response.OutputStream.Close()
}

$engineProc = $null
$listen = $null
try {
  $model = Get-Model
  $exe = Install-LlamaServer
  $engineProc = Start-Engine $exe $model
  Wait-Engine
  $listen = Start-Dashboard
  if (-not $listen) {
    Write-Host 'Leave this window open while you use the dashboard. Close it to stop the model.'
    if ($engineProc) { Wait-Process -Id $engineProc.Id }
    else { while ($true) { Start-Sleep 30 } }
    return
  }
  Write-Host 'Leave this window open. Close it to stop Local Analyst.'
  while ($listen.IsListening) {
    $ctx = $listen.GetContext()
    try {
      $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
      if ($path -eq '/') { $path = '/index.html' }
      if ($path.StartsWith('/v1') -or $path -eq '/health' -or $path.StartsWith('/props')) {
        Proxy-Api $ctx
        continue
      }
      $safe = $path.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
      if ($safe.Contains('..')) { Send-Bytes $ctx 400 'text/plain' ([Text.Encoding]::UTF8.GetBytes('bad path')); continue }
      $file = Join-Path $DashDir $safe
      $fullDash = [IO.Path]::GetFullPath($DashDir)
      $fullFile = [IO.Path]::GetFullPath($file)
      if (-not $fullFile.StartsWith($fullDash)) {
        Send-Bytes $ctx 403 'text/plain' ([Text.Encoding]::UTF8.GetBytes('forbidden')); continue
      }
      if (-not (Test-Path $file)) {
        Send-Bytes $ctx 404 'text/plain' ([Text.Encoding]::UTF8.GetBytes('not found')); continue
      }
      $bytes = [IO.File]::ReadAllBytes($file)
      Send-Bytes $ctx 200 (Mime $file) $bytes
    } catch {
      try { Send-Bytes $ctx 500 'text/plain' ([Text.Encoding]::UTF8.GetBytes($_.Exception.Message)) } catch {}
    }
  }
} finally {
  if ($listen) { try { $listen.Stop() } catch {} }
  if ($engineProc -and -not $engineProc.HasExited) { try { $engineProc.Kill() } catch {} }
}
