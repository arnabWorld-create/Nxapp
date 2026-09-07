$base = "http://localhost:3001"

function Call($uri, $method, $body, $sess) {
  $params = @{ Uri = "$base$uri"; Method = $method; UseBasicParsing = $true }
  if ($body) { $params.ContentType = "application/json"; $params.Body = $body }
  if ($sess) { $params.WebSession = $sess }
  try {
    $r = Invoke-WebRequest @params
    return "$($r.StatusCode): $($r.Content)"
  } catch {
    $sc = $_.Exception.Response.StatusCode.value__
    $ct = $_.Exception.Response.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($ct)
    $bodytxt = $reader.ReadToEnd()
    return "HTTP $sc : $bodytxt"
  }
}

$session = $null
Write-Host "=== LOGIN (admin) ==="
Call "/api/auth/login" POST '{"email":"admin@nxapp.local","password":"admin123"}' $null
# capture session via SessionVariable
$r = $null
try { $r = Invoke-WebRequest -Uri "$base/api/auth/login" -Method POST -ContentType "application/json" -Body '{"email":"admin@nxapp.local","password":"admin123"}' -SessionVariable s -UseBasicParsing } catch { $s = $null }
$session = $s
Write-Host "LOGIN RAW: $($r.StatusCode): $($r.Content)"

Write-Host "=== ME (authed) ==="
Call "/api/auth/me" GET $null $session

Write-Host "=== LOGOUT ==="
Call "/api/auth/logout" POST '{}' $session

Write-Host "=== ME (after logout) ==="
Call "/api/auth/me" GET $null $session

Write-Host "=== LOGIN wrong password ==="
Call "/api/auth/login" POST '{"email":"admin@nxapp.local","password":"wrong"}' $null
