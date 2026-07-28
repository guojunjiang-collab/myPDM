# myPDM delivery packaging script
# Usage: .\package-delivery.ps1
# Output: ..\myPDM-Delivery\

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pkgDir = Join-Path (Split-Path -Parent $root) "myPDM-Delivery"

if (Test-Path $pkgDir) { Remove-Item -Recurse -Force $pkgDir }
New-Item -ItemType Directory -Force $pkgDir | Out-Null

# 1. docker-compose.prod.yml
Copy-Item "$root\docker-compose.prod.yml"               "$pkgDir\" -Force
Write-Host "[1/6] docker-compose.prod.yml"

# 2. nginx
New-Item -ItemType Directory -Force "$pkgDir\nginx" | Out-Null
Copy-Item "$root\nginx\nginx.conf"                      "$pkgDir\nginx\nginx.conf" -Force
Write-Host "[2/6] nginx/nginx.conf"

# 3. certs
if (Test-Path "$root\certs") {
  Copy-Item "$root\certs"                               "$pkgDir\certs" -Recurse -Force
  Write-Host "[3/6] certs/"
} else { Write-Warning "[3/6] certs/ not found" }

# 4. initdb
if (Test-Path "$root\initdb") {
  Copy-Item "$root\initdb"                              "$pkgDir\initdb" -Recurse -Force
  Write-Host "[4/6] initdb/"
} else { Write-Warning "[4/6] initdb/ not found" }

# 5. frontend dist
if (Test-Path "$root\frontend\dist") {
  Copy-Item "$root\frontend\dist"                       "$pkgDir\frontend\dist" -Recurse -Force
  Write-Host "[5/6] frontend/dist/"
} else { Write-Warning "[5/6] frontend/dist/ not found" }

# 6. backend image tar (wildcard match)
$tars = Get-ChildItem "$root\backend\*.tar" -ErrorAction SilentlyContinue
if ($tars) {
  foreach ($f in $tars) {
    Copy-Item $f.FullName "$pkgDir\" -Force
    Write-Host "[6/6] $($f.Name)"
  }
} else {
  Write-Warning "[6/6] no .tar found in backend\"
}

# 7. .env template
if (Test-Path "$root\.env") {
  Copy-Item "$root\.env"                                "$pkgDir\env.template" -Force
  Write-Host "[7/7] env.template"
} else { Write-Warning "[7/7] .env not found" }

Write-Host ""
Write-Host "Done: $pkgDir"
