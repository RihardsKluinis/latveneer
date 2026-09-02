# LatVeneer local dev server — serves this folder on http://localhost:<port>
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1 [-Port 8124]
param([int]$Port = 8124)
$root = $PSScriptRoot
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Output "Serving $root on http://localhost:$Port/"

$mime = @{
  ".html"="text/html; charset=utf-8"; ".css"="text/css"; ".js"="application/javascript";
  ".mp4"="video/mp4"; ".webm"="video/webm"; ".webp"="image/webp"; ".jpg"="image/jpeg";
  ".jpeg"="image/jpeg"; ".png"="image/png"; ".svg"="image/svg+xml"; ".ico"="image/x-icon";
  ".xml"="application/xml"; ".txt"="text/plain"; ".woff"="font/woff"; ".woff2"="font/woff2"
}

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    $rel = [Uri]::UnescapeDataString($req.Url.AbsolutePath.TrimStart("/"))
    if ($rel -eq "") { $rel = "index.html" }
    elseif ($rel.EndsWith("/")) { $rel = $rel + "index.html" }
    elseif ((Test-Path (Join-Path $root $rel) -PathType Container)) { $rel = $rel + "/index.html" }
    if ($rel -match '\.\.') {
      $res.StatusCode = 400; $res.Close(); continue
    }
    # Dev-only upload endpoint: film frame extraction + image re-export (see DEV.md)
    if ($req.HttpMethod -eq "PUT" -and ($rel.StartsWith("assets/film/frames/") -or $rel.StartsWith("images/") -or $rel.StartsWith("content/"))) {
      $dest = Join-Path $root $rel
      $dir = Split-Path $dest
      if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
      $ms = New-Object IO.MemoryStream
      $req.InputStream.CopyTo($ms)
      [IO.File]::WriteAllBytes($dest, $ms.ToArray())
      $res.StatusCode = 200
      $ok = [Text.Encoding]::UTF8.GetBytes("ok")
      $res.OutputStream.Write($ok, 0, $ok.Length)
      $res.Close()
      continue
    }
    if ($req.HttpMethod -ne "GET" -and $req.HttpMethod -ne "HEAD") {
      $res.StatusCode = 405; $res.Close(); continue
    }
    $path = Join-Path $root $rel
    if (-not (Test-Path $path -PathType Leaf)) {
      $res.StatusCode = 404
      $bytes = [Text.Encoding]::UTF8.GetBytes("404")
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      $res.Close()
      continue
    }
    $ext = [IO.Path]::GetExtension($path).ToLower()
    $type = $mime[$ext]; if (-not $type) { $type = "application/octet-stream" }
    $res.ContentType = $type
    $res.AddHeader("Accept-Ranges", "bytes")
    $fs = [IO.File]::OpenRead($path)
    $len = $fs.Length
    $start = 0; $end = $len - 1
    $range = $req.Headers["Range"]
    if ($range -and $range -match "bytes=(\d*)-(\d*)") {
      if ($Matches[1] -ne "") { $start = [long]$Matches[1] }
      if ($Matches[2] -ne "") { $end = [long]$Matches[2] } else { $end = $len - 1 }
      if ($end -ge $len) { $end = $len - 1 }
      $res.StatusCode = 206
      $res.AddHeader("Content-Range", "bytes $start-$end/$len")
    }
    $count = $end - $start + 1
    $res.ContentLength64 = $count
    $fs.Seek($start, "Begin") | Out-Null
    $buf = New-Object byte[] 65536
    $remaining = $count
    while ($remaining -gt 0) {
      $chunk = [Math]::Min($buf.Length, $remaining)
      $read = $fs.Read($buf, 0, $chunk)
      if ($read -le 0) { break }
      $res.OutputStream.Write($buf, 0, $read)
      $remaining -= $read
    }
    $fs.Close()
    $res.Close()
  } catch {
    try { $fs.Close() } catch {}
    try { $res.Close() } catch {}
  }
}
