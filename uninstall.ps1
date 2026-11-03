# uninstall.ps1 — 从 DSH profile 移除 dsh-files-menu
# 用法：powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 [-Profile desktop]
#
# 移除目录联结和 package.json 里的登记，不删除插件源码。改完请重启 DSH。

param(
    [string]$Profile = '',
    [string]$DshHome = ''
)

$ErrorActionPreference = 'Stop'
$packageName = 'dsh-files-menu'

function Ok($m)   { Write-Host "  [OK] " -ForegroundColor Green -NoNewline; Write-Host $m }
function Fail($m) { Write-Host "  [XX] " -ForegroundColor Red -NoNewline; Write-Host $m }

$dshHome = if (-not [string]::IsNullOrWhiteSpace($DshHome)) { $DshHome }
           elseif (-not [string]::IsNullOrWhiteSpace($env:DSH_HOME)) { $env:DSH_HOME }
           else { Join-Path $env:USERPROFILE '.dsh' }

$profilesDir = Join-Path $dshHome 'profiles'
if (-not (Test-Path $profilesDir)) { Fail "找不到 profiles 目录：$profilesDir"; exit 1 }

if (-not [string]::IsNullOrWhiteSpace($Profile)) { $profileName = $Profile }
elseif (Test-Path (Join-Path $profilesDir 'desktop')) { $profileName = 'desktop' }
else {
    $all = @(Get-ChildItem $profilesDir -Directory -ErrorAction SilentlyContinue)
    if ($all.Count -ne 1) { Fail "无法判断用哪个 profile，请用 -Profile 指定。"; exit 1 }
    $profileName = $all[0].Name
}

$profileDir = Join-Path $profilesDir $profileName
$pkgPath = Join-Path $profileDir 'package.json'
$dst = Join-Path (Join-Path $profileDir 'node_modules') $packageName
if (-not (Test-Path $pkgPath)) { Fail "profile 里没有 package.json：$pkgPath"; exit 1 }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item $pkgPath "$pkgPath.bak-$stamp" -Force
Ok "已备份 package.json → package.json.bak-$stamp"

if (Test-Path $dst) {
    try { (Get-Item $dst -Force).Delete() } catch { cmd /c rmdir "$dst" 2>$null }
    Ok "已移除联结 node_modules\$packageName"
} else {
    Ok '联结不存在，跳过'
}

$utf8 = New-Object System.Text.UTF8Encoding $false
$json = [System.IO.File]::ReadAllText($pkgPath, $utf8) | ConvertFrom-Json
if ($null -ne $json.dependencies) {
    $json.dependencies.PSObject.Properties.Remove($packageName)
}
if ($null -ne $json.dsh.profile.bundles) {
    $json.dsh.profile.bundles = @($json.dsh.profile.bundles | Where-Object { $_ -ne $packageName })
}
[System.IO.File]::WriteAllText($pkgPath, ($json | ConvertTo-Json -Depth 12) + "`n", $utf8)
Ok '已从 package.json 移除依赖与 bundle'

Write-Host ''
Write-Host '卸载完成。请完全退出 DSH 再重新打开。' -ForegroundColor Green
Write-Host ''