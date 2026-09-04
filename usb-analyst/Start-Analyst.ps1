# Local Analyst — everything lives on the USB stick.
# Uses only Windows (PowerShell + a browser). No Python, no Ollama, no install.

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Root) { $Root = 'F:\gemma' }
Set-Location $Root

$DashDir    = Join-Path $Root 'dashboard'
$BinDir     = Join-Path $Root 'bin\llama'
$ModelDir   = Join-Path $Root 'models'
$TmpDir     = Join-Path $Root 'tmp'
$CacheDir   = Join-Path $Root 'cache'
$StateDir   = Join-Path $Root 'state'
$DataDir    = Join-Path $Root 'data'
$ReportsDir = Join-Path $Root 'reports'
$ChatFile   = Join-Path $StateDir 'chats.json'
$ApiPort    = 8091
$UiPort     = 8050
$ApiBase    = "http://127.0.0.1:$ApiPort"
$script:ModelPath = $null
$MaxReadBytes = 400000
$MaxWriteBytes = 200000
$MaxProfileBytes = 2000000

New-Item -ItemType Directory -Force -Path $DashDir, $BinDir, $ModelDir, $TmpDir, $CacheDir, $StateDir, $DataDir, $ReportsDir | Out-Null

function Test-Port($port) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $c.Connect('127.0.0.1', $port)
    $c.Close()
    return $true
  } catch { return $false }
}

function Get-Model {
  $all = @(Get-ChildItem -Path $ModelDir -Filter *.gguf -ErrorAction SilentlyContinue)
  if (-not $all.Count) { throw "No .gguf in $ModelDir. Put a GGUF (Qwen2.5-7B or Gemma 3n) there." }
  $prefer = @('qwen2.5-7b','qwen2.5','qwen','gemma-3n','medgemma','openbio','meditron','ayurparam','biomistral','gemma')
  foreach ($p in $prefer) {
    $hit = $all | Where-Object { $_.Name -match [regex]::Escape($p) } | Select-Object -First 1
    if ($hit) { return $hit.FullName }
  }
  return ($all | Sort-Object Length -Descending | Select-Object -First 1).FullName
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
    try { $tag = (Invoke-WebRequest -Uri $nightly.browser_download_url -UseBasicParsing).Content.Trim() } catch {}
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
  $exe = Join-Path $BinDir 'llama-server.exe'
  if (Test-Path $exe) { return $exe }

  Write-Host 'Downloading llama.cpp onto the USB stick (Vulkan, portable)...'
  $asset = Get-LlamaVulkanZip
  Write-Host "Using $($asset.name)"
  $zip = Join-Path $TmpDir $asset.name
  curl.exe -L --fail --retry 5 -o $zip $asset.browser_download_url
  Expand-Archive -Path $zip -DestinationPath $BinDir -Force
  $found = Get-ChildItem $BinDir -Recurse -Filter 'llama-server.exe' | Select-Object -First 1
  if (-not $found) { throw 'llama-server.exe missing after unzip.' }
  if ($found.DirectoryName -ne $BinDir) {
    Get-ChildItem $found.DirectoryName | Copy-Item -Destination $BinDir -Force
  }
  if (-not (Test-Path $exe)) { throw 'Failed to place llama-server.exe on the USB stick.' }
  Remove-Item $zip -ErrorAction SilentlyContinue
  return $exe
}

function Start-Engine($exe, $model) {
  if (Test-Port $ApiPort) {
    Write-Host "llama.cpp already listening on $ApiPort"
    return $null
  }
  Write-Host "Starting llama-server from USB: $model"
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  $psi.WorkingDirectory = $BinDir
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.Arguments = "-m `"$model`" --host 127.0.0.1 --port $ApiPort -c 8192 -ngl 99 --jinja"
  $psi.EnvironmentVariables['TEMP'] = $TmpDir
  $psi.EnvironmentVariables['TMP'] = $TmpDir
  $psi.EnvironmentVariables['TMPDIR'] = $TmpDir
  $psi.EnvironmentVariables['LLAMA_CACHE'] = $CacheDir
  $psi.EnvironmentVariables['XDG_CACHE_HOME'] = $CacheDir
  return [Diagnostics.Process]::Start($psi)
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
  throw 'llama.cpp did not become ready. Check F:\gemma\tmp if the USB is full.'
}

function Start-Dashboard {
  $prefix = "http://127.0.0.1:$UiPort/"
  $listen = New-Object Net.HttpListener
  $listen.Prefixes.Add($prefix)
  try { $listen.Start() } catch {
    throw "Could not bind $prefix. Close other Local Analyst windows and try again."
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
    '.json' { 'application/json; charset=utf-8' }
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

function Send-Json($ctx, $obj, $code = 200) {
  $json = $obj | ConvertTo-Json -Depth 12 -Compress
  Send-Bytes $ctx $code 'application/json; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes($json))
}

function Read-JsonBody($ctx) {
  $ms = New-Object IO.MemoryStream
  $ctx.Request.InputStream.CopyTo($ms)
  $text = [Text.Encoding]::UTF8.GetString($ms.ToArray())
  if ([string]::IsNullOrWhiteSpace($text)) { return $null }
  return $text | ConvertFrom-Json
}

function Get-Arg($obj, $key, $default = $null) {
  if ($null -eq $obj) { return $default }
  $p = $obj.PSObject.Properties[$key]
  if ($p -and $null -ne $p.Value -and "$($p.Value)" -ne '') { return $p.Value }
  return $default
}

function Get-SandboxRoot($name) {
  switch ($name) {
    'data' { return [IO.Path]::GetFullPath($DataDir) }
    'reports' { return [IO.Path]::GetFullPath($ReportsDir) }
    default { return $null }
  }
}

function Test-UnderRoot($full, $root) {
  $full = [IO.Path]::GetFullPath($full)
  $root = [IO.Path]::GetFullPath($root)
  $prefix = if ($root.EndsWith('\')) { $root } else { "$root\" }
  return $full.Equals($root, [StringComparison]::OrdinalIgnoreCase) -or $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
}

function Resolve-SandboxFile($rel, [switch]$MustExist) {
  if ([string]::IsNullOrWhiteSpace($rel)) { throw 'path required' }
  $rel = "$rel".Trim().Replace('/', '\')
  if ($rel.Contains('..') -or $rel.Contains(':')) { throw 'path not allowed' }
  $rel = $rel.TrimStart('\')

  $folder = $null
  $rest = $rel
  if ($rel -match '^(data|reports)\\(.+)$') {
    $folder = $Matches[1]
    $rest = $Matches[2]
  } elseif ($rel -match '^(data|reports)$') {
    throw 'path must be a file, not a folder'
  }

  $candidates = @()
  if ($folder) {
    $candidates += [IO.Path]::GetFullPath((Join-Path (Get-SandboxRoot $folder) $rest))
  } else {
    $candidates += [IO.Path]::GetFullPath((Join-Path $DataDir $rel))
    $candidates += [IO.Path]::GetFullPath((Join-Path $ReportsDir $rel))
  }

  foreach ($full in $candidates) {
    $ok = $false
    foreach ($name in @('data','reports')) {
      if (Test-UnderRoot $full (Get-SandboxRoot $name)) { $ok = $true; break }
    }
    if (-not $ok) { continue }
    if (Test-Path -LiteralPath $full -PathType Leaf) { return $full }
    if (-not $MustExist) { return $full }
  }
  if ($MustExist) { throw "file not found: $rel" }
  throw "path not allowed: $rel"
}

function Get-RelPath($full) {
  $full = [IO.Path]::GetFullPath($full)
  foreach ($name in @('data','reports')) {
    $root = Get-SandboxRoot $name
    if (Test-UnderRoot $full $root) {
      $prefix = if ($root.EndsWith('\')) { $root } else { "$root\" }
      return ($name + '/' + $full.Substring($prefix.Length).Replace('\', '/'))
    }
  }
  return [IO.Path]::GetFileName($full)
}

function List-SandboxFiles($folder) {
  $dirs = @()
  if ($folder -eq 'data') { $dirs = @(@{ name = 'data'; path = $DataDir }) }
  elseif ($folder -eq 'reports') { $dirs = @(@{ name = 'reports'; path = $ReportsDir }) }
  else {
    $dirs = @(
      @{ name = 'data'; path = $DataDir },
      @{ name = 'reports'; path = $ReportsDir }
    )
  }
  $files = @()
  foreach ($d in $dirs) {
    if (-not (Test-Path $d.path)) { continue }
    Get-ChildItem -LiteralPath $d.path -File -ErrorAction SilentlyContinue | ForEach-Object {
      $files += [pscustomobject]@{
        name = $_.Name
        path = "$($d.name)/$($_.Name)"
        folder = $d.name
        bytes = $_.Length
        modified = $_.LastWriteTime.ToString('s')
      }
    }
  }
  return @($files)
}

function ConvertTo-Number($v) {
  if ($null -eq $v) { return $null }
  $t = "$v" -replace '[,₹$%\s]', ''
  if ($t -eq '') { return $null }
  $n = 0.0
  if ([double]::TryParse($t, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$n)) { return $n }
  return $null
}

function Read-TableRecords($full) {
  $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()
  $text = [IO.File]::ReadAllText($full)
  if ($ext -eq '.json') {
    $data = $text | ConvertFrom-Json
    if ($data.PSObject.Properties['data'] -and $data.data) { $data = $data.data }
    $arr = @($data)
    if (-not $arr.Count) { return @{ columns = @(); records = @() } }
    $first = $arr[0]
    $columns = @($first.PSObject.Properties.Name)
    $records = @()
    foreach ($row in $arr) {
      $o = [ordered]@{}
      foreach ($c in $columns) { $o[$c] = if ($null -eq $row.$c) { '' } else { "$($row.$c)" } }
      $records += [pscustomobject]$o
    }
    return @{ columns = $columns; records = $records }
  }
  $delim = ','
  if ($ext -eq '.tsv') { $delim = "`t" }
  $csv = @(Import-Csv -LiteralPath $full -Delimiter $delim)
  if (-not $csv.Count) { return @{ columns = @(); records = @() } }
  $columns = @($csv[0].PSObject.Properties.Name)
  return @{ columns = $columns; records = $csv }
}

function Profile-TableFile($full) {
  $info = Read-TableRecords $full
  $columns = @($info.columns)
  $records = @($info.records)
  $stats = @()
  foreach ($c in $columns) {
    $vals = @()
    foreach ($row in $records) {
      $v = "$($row.$c)"
      if (-not [string]::IsNullOrWhiteSpace($v)) { $vals += $v.Trim() }
    }
    $nums = @()
    foreach ($v in $vals) {
      $n = ConvertTo-Number $v
      if ($null -ne $n) { $nums += $n }
    }
    if ($vals.Count -gt 0 -and ($nums.Count / [double]$vals.Count) -gt 0.7) {
      $sum = 0.0
      foreach ($n in $nums) { $sum += $n }
      $stats += [pscustomobject]@{
        column = $c
        kind = 'number'
        sum = $sum
        mean = [math]::Round($sum / $nums.Count, 6)
        min = ($nums | Measure-Object -Minimum).Minimum
        max = ($nums | Measure-Object -Maximum).Maximum
        n = $nums.Count
      }
    } else {
      $counts = @{}
      foreach ($v in $vals) {
        if ($counts.ContainsKey($v)) { $counts[$v]++ } else { $counts[$v] = 1 }
      }
      $top = @($counts.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 6 | ForEach-Object {
        [pscustomobject]@{ value = $_.Key; count = $_.Value }
      })
      $stats += [pscustomobject]@{
        column = $c
        kind = 'category'
        unique = $counts.Count
        top = @($top)
      }
    }
  }
  $sample = @($records | Select-Object -First 20)
  $metrics = @()
  foreach ($s in $stats) {
    if ($s.kind -eq 'number') {
      $metrics += "$($s.column): sum=$($s.sum), mean=$($s.mean), min=$($s.min), max=$($s.max), n=$($s.n)"
    } else {
      $topText = ($s.top | ForEach-Object { "$($_.value)($($_.count))" }) -join ', '
      $metrics += "$($s.column): unique=$($s.unique), top=$topText"
    }
  }
  return [pscustomobject]@{
    ok = $true
    path = Get-RelPath $full
    rows = $records.Count
    columns = @($columns)
    metrics = @($metrics)
    stats = @($stats)
    sample = @($sample)
  }
}

function Invoke-Tool($name, $argsObj) {
  switch ($name) {
    'list_files' {
      $folder = Get-Arg $argsObj 'folder' 'all'
      $files = List-SandboxFiles $folder
      return @{ ok = $true; folder = $folder; files = @($files) }
    }
    'read_file' {
      $rel = Get-Arg $argsObj 'path'
      if (-not $rel) { $rel = Get-Arg $argsObj 'filename' }
      $full = Resolve-SandboxFile $rel -MustExist
      $len = (Get-Item -LiteralPath $full).Length
      if ($len -gt $MaxReadBytes) { throw "file too large to read ($len bytes). Use profile_table for CSVs." }
      $text = [IO.File]::ReadAllText($full)
      return @{ ok = $true; path = Get-RelPath $full; bytes = $len; content = $text }
    }
    'profile_table' {
      $rel = Get-Arg $argsObj 'path'
      if (-not $rel) { $rel = Get-Arg $argsObj 'filename' }
      $full = Resolve-SandboxFile $rel -MustExist
      $len = (Get-Item -LiteralPath $full).Length
      if ($len -gt $MaxProfileBytes) { throw "file too large to profile ($len bytes)" }
      return Profile-TableFile $full
    }
    'search_files' {
      $query = Get-Arg $argsObj 'query'
      if ([string]::IsNullOrWhiteSpace($query)) { throw 'query required' }
      $folder = Get-Arg $argsObj 'folder' 'all'
      $files = List-SandboxFiles $folder
      $matches = @()
      foreach ($f in $files) {
        if ($f.bytes -gt $MaxReadBytes) { continue }
        $full = Resolve-SandboxFile $f.path -MustExist
        $lines = [IO.File]::ReadAllLines($full)
        for ($i = 0; $i -lt $lines.Length; $i++) {
          if ($lines[$i].IndexOf($query, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            $snippet = $lines[$i]
            if ($snippet.Length -gt 240) { $snippet = $snippet.Substring(0, 240) }
            $matches += [pscustomobject]@{ path = $f.path; line = $i + 1; text = $snippet }
            if ($matches.Count -ge 40) { break }
          }
        }
        if ($matches.Count -ge 40) { break }
      }
      return @{ ok = $true; query = "$query"; matches = @($matches) }
    }
    'write_report' {
      $filename = Get-Arg $argsObj 'filename'
      $content = Get-Arg $argsObj 'content'
      if ([string]::IsNullOrWhiteSpace($filename)) { throw 'filename required' }
      if ($null -eq $content) { throw 'content required' }
      $base = [IO.Path]::GetFileName("$filename")
      if ($base -notmatch '^[\w.\- ]+\.(md|txt|csv|json)$') {
        throw 'filename must be a simple .md, .txt, .csv, or .json name'
      }
      $full = [IO.Path]::GetFullPath((Join-Path $ReportsDir $base))
      if (-not (Test-UnderRoot $full $ReportsDir)) { throw 'reports path not allowed' }
      $bytes = [Text.Encoding]::UTF8.GetByteCount("$content")
      if ($bytes -gt $MaxWriteBytes) { throw 'report too large' }
      [IO.File]::WriteAllText($full, "$content", [Text.UTF8Encoding]::new($false))
      return @{ ok = $true; filename = $base; path = "reports/$base"; bytes = $bytes }
    }
    default { throw "unknown tool: $name" }
  }
}

function Handle-Chats($ctx) {
  if ($ctx.Request.HttpMethod -eq 'GET') {
    if (-not (Test-Path $ChatFile)) {
      Send-Bytes $ctx 200 'application/json; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('[]'))
      return
    }
    Send-Bytes $ctx 200 'application/json; charset=utf-8' ([IO.File]::ReadAllBytes($ChatFile))
    return
  }
  if ($ctx.Request.HttpMethod -in @('POST','PUT')) {
    $ms = New-Object IO.MemoryStream
    $ctx.Request.InputStream.CopyTo($ms)
    [IO.File]::WriteAllBytes($ChatFile, $ms.ToArray())
    Send-Bytes $ctx 200 'application/json; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('{"ok":true}'))
    return
  }
  Send-Bytes $ctx 405 'text/plain' ([Text.Encoding]::UTF8.GetBytes('method'))
}

function Handle-Status($ctx) {
  $modelName = if ($script:ModelPath) { [IO.Path]::GetFileName($script:ModelPath) } else { $null }
  $files = List-SandboxFiles 'all'
  Send-Json $ctx @{
    ok = $true
    model = $modelName
    tools = @('list_files','read_file','profile_table','search_files','write_report')
    data = 'data'
    reports = 'reports'
    files = @($files)
  }
}

function Handle-Tools($ctx) {
  if ($ctx.Request.HttpMethod -ne 'POST') {
    Send-Bytes $ctx 405 'text/plain' ([Text.Encoding]::UTF8.GetBytes('method'))
    return
  }
  try {
    $body = Read-JsonBody $ctx
    $name = Get-Arg $body 'name'
    if ($name) { $name = "$name".ToLowerInvariant() }
    $argsObj = Get-Arg $body 'arguments'
    if (-not $argsObj) { $argsObj = Get-Arg $body 'args' }
    if (-not $name) { throw 'name required' }
    $result = Invoke-Tool $name $argsObj
    Send-Json $ctx $result
  } catch {
    Send-Json $ctx @{ ok = $false; error = $_.Exception.Message }
  }
}

function Proxy-Api($ctx) {
  $url = $ApiBase + $ctx.Request.RawUrl
  $preq = [Net.HttpWebRequest]::Create($url)
  $preq.Method = $ctx.Request.HttpMethod
  $preq.Timeout = 180000
  $preq.ReadWriteTimeout = 180000
  $preq.AllowWriteStreamBuffering = $false
  if ($ctx.Request.ContentType) { $preq.ContentType = $ctx.Request.ContentType }
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
  try { $pres = $preq.GetResponse() }
  catch [Net.WebException] {
    $pres = $_.Exception.Response
    if (-not $pres) { throw }
  }
  $ctx.Response.StatusCode = [int]$pres.StatusCode
  if ($pres.ContentType) { $ctx.Response.ContentType = $pres.ContentType }
  $ctx.Response.SendChunked = $true
  $in = $pres.GetResponseStream()
  $out = $ctx.Response.OutputStream
  $buffer = New-Object byte[] 4096
  while (($n = $in.Read($buffer, 0, $buffer.Length)) -gt 0) {
    $out.Write($buffer, 0, $n)
    $out.Flush()
  }
  $pres.Close()
  $out.Close()
}

$engineProc = $null
$listen = $null
try {
  $script:ModelPath = Get-Model
  $exe = Install-LlamaServer
  $engineProc = Start-Engine $exe $script:ModelPath
  Wait-Engine
  $listen = Start-Dashboard
  Write-Host "Model: $([IO.Path]::GetFileName($script:ModelPath))"
  Write-Host 'Agent tools: list_files, read_file, profile_table, search_files, write_report'
  Write-Host 'Leave this window open. Close it to stop. Nothing is installed on the PC.'
  while ($listen.IsListening) {
    $ctx = $listen.GetContext()
    try {
      $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
      if ($path -eq '/') { $path = '/index.html' }
      if ($path -eq '/api/chats') { Handle-Chats $ctx; continue }
      if ($path -eq '/api/status') { Handle-Status $ctx; continue }
      if ($path -eq '/api/tools') { Handle-Tools $ctx; continue }
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
      Send-Bytes $ctx 200 (Mime $file) ([IO.File]::ReadAllBytes($file))
    } catch {
      try { Send-Bytes $ctx 500 'text/plain' ([Text.Encoding]::UTF8.GetBytes($_.Exception.Message)) } catch {}
    }
  }
} finally {
  if ($listen) { try { $listen.Stop() } catch {} }
  if ($engineProc -and -not $engineProc.HasExited) { try { $engineProc.Kill() } catch {} }
}
