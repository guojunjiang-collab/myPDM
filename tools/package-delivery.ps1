# myPDM 交付物打包脚本
# 用法: .\package-delivery.ps1 [-Version "v3.1.1"]
# 输出: myPDM\..\myPDM-交付-{version}\

param(
  [string]$Version = "v3.1.1"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pkgDir = Join-Path (Split-Path -Parent $root) "myPDM-交付-$Version"

if (Test-Path $pkgDir) { Remove-Item -Recurse -Force $pkgDir }
New-Item -ItemType Directory -Force $pkgDir | Out-Null

# 1. docker-compose.prod.yml
Copy-Item "$root\docker-compose.prod.yml"               "$pkgDir\" -Force
Write-Host "✓ docker-compose.prod.yml"

# 2. nginx
Copy-Item "$root\nginx\nginx.conf"                      "$pkgDir\nginx.conf" -Force
Write-Host "✓ nginx.conf"

# 3. certs（如果存在）
if (Test-Path "$root\certs") {
  Copy-Item "$root\certs"                               "$pkgDir\certs" -Recurse -Force
  Write-Host "✓ certs/"
}

# 4. initdb
if (Test-Path "$root\initdb") {
  Copy-Item "$root\initdb"                              "$pkgDir\initdb" -Recurse -Force
  Write-Host "✓ initdb/"
}

# 5. 前端
if (Test-Path "$root\frontend\dist") {
  Copy-Item "$root\frontend\dist"                       "$pkgDir\frontend\dist" -Recurse -Force
  Write-Host "✓ frontend/dist/"
}
else {
  Write-Warning "请先构建前端: cd frontend && npm run build"
}

# 6. 后端镜像 tar
$img = "mypdm-backend-${Version}.tar"
if (Test-Path "$root\backend\$img") {
  Copy-Item "$root\backend\$img"                        "$pkgDir\" -Force
  Write-Host "✓ $img"
}
else {
  Write-Warning "请先导出镜像: docker save -o backend\$img mypdm-backend:${Version}"
}

# 7. .env（客户按模板填写）
if (Test-Path "$root\.env") {
  Copy-Item "$root\.env"                                "$pkgDir\env.template" -Force
  Write-Host "✓ env.template（客户需按实际修改后重命名为 .env）"
}

Write-Host ""
Write-Host "打包完成: $pkgDir"
