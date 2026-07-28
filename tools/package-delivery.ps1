# myPDM delivery packaging script
# Usage: .\package-delivery.ps1 [-Version "v3.1.1"]
# Output: ..\myPDM-Delivery-{version}\

param(
  [string]$Version = "v3.1.1"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pkgDir = Join-Path (Split-Path -Parent $root) "myPDM-Delivery-$Version"

if (Test-Path $pkgDir) { Remove-Item -Recurse -Force $pkgDir }
New-Item -ItemType Directory -Force $pkgDir | Out-Null

# 1. docker-compose.prod.yml
Copy-Item "$root\docker-compose.prod.yml"               "$pkgDir\" -Force
Write-Host "[1/7] docker-compose.prod.yml"

# 2. nginx
Copy-Item "$root\nginx\nginx.conf"                      "$pkgDir\nginx.conf" -Force
Write-Host "[2/7] nginx.conf"

# 3. certs
if (Test-Path "$root\certs") {
  Copy-Item "$root\certs"                               "$pkgDir\certs" -Recurse -Force
  Write-Host "[3/7] certs/"
} else { Write-Warning "[3/7] certs/ not found" }

# 4. initdb
if (Test-Path "$root\initdb") {
  Copy-Item "$root\initdb"                              "$pkgDir\initdb" -Recurse -Force
  Write-Host "[4/7] initdb/"
} else { Write-Warning "[4/7] initdb/ not found" }

# 5. frontend dist
if (Test-Path "$root\frontend\dist") {
  Copy-Item "$root\frontend\dist"                       "$pkgDir\frontend\dist" -Recurse -Force
  Write-Host "[5/7] frontend/dist/"
} else { Write-Warning "[5/7] frontend/dist/ not found - run: cd frontend; npm run build" }

# 6. backend image tar
$img = "mypdm-backend-${Version}.tar"
if (Test-Path "$root\backend\$img") {
  Copy-Item "$root\backend\$img"                        "$pkgDir\" -Force
  Write-Host "[6/7] $img"
} else { Write-Warning "[6/7] $img not found - run: docker save -o backend\$img mypdm-backend:${Version}" }

# 7. .env template
if (Test-Path "$root\.env") {
  Copy-Item "$root\.env"                                "$pkgDir\env.template" -Force
  Write-Host "[7/7] env.template"
} else { Write-Warning "[7/7] .env not found" }

Write-Host ""
Write-Host "Done: $pkgDir"
