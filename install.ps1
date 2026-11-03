# install.ps1 — 把 dsh-files-menu 装进 DSH profile
# 用法：powershell -ExecutionPolicy Bypass -File .\install.ps1 [-Profile desktop]
#
# 只做三件事：建目录联结、改 profile 的 package.json、自检。
# 不联网、不装依赖、不启动 DSH。装完请手动完全退出 DSH 再打开。

param(
    [string]$Profile = '',
    [string]$DshHome = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$packageName = 'dsh-files-menu'

function Ok($m)   { Write-Host "  [OK] " -ForegroundColor Green -NoNewline; Write-Host $m }
function Warn2($m){ Write-Host "  [!!] " -ForegroundColor Yellow -NoNewline; Write-Host $m }
function Fail($m) { Write-Host "  [XX] " -ForegroundColor Red -NoNewline; Write-Host $m }

if (-not (Test-Path (Join-Path $root 'package.json'))) {
    Fail "找不到 package.json，请在插件目录里运行本脚本。"
    exit 1
}

$dshHome = if (-not [string]::IsNullOrWhiteSpace($DshHome)) { $DshHome }
           elseif (-not [string]::IsNullOrWhiteSpace($env:DSH_HOME)) { $env:DSH_HOME }
           else { Join-Path $env:USERPROFILE '.dsh' }

$profilesDir = Join-Path $dshHome 'profiles'
if (-not (Test-Path $profilesDir)) {
    Fail "找不到 profiles 目录：$profilesDir（DSH 至少启动过一次才会生成）"
    exit 1
}

if (-not [string]::IsNullOrWhiteSpace($Profile)) { $profileName = $Profile }
elseif (Test-Path (Join-Path $profilesDir 'desktop')) { $profileName = 'desktop' }
else {
    $all = @(Get-ChildItem $profilesDir -Directory -ErrorAction SilentlyContinue)
    if ($all.Count -ne 1) {
        Fail "无法判断用哪个 profile，请用 -Profile 指定。现有：$($all.Name -join ', ')"
        exit 1
    }
    $profileName = $all[0].Name
}

$profileDir = Join-Path $profilesDir $profileName
$pkgPath = Join-Path $profileDir 'package.json'
$nmDir = Join-Path $profileDir 'node_modules'
if (-not (Test-Path $pkgPath)) { Fail "profile 里没有 package.json：$pkgPath"; exit 1 }
Ok "profile：$profileName（$profileDir）"

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item $pkgPath "$pkgPath.bak-$stamp" -Force
Ok "已备份 package.json → package.json.bak-$stamp"

if (-not (Test-Path $nmDir)) { New-Item -ItemType Directory -Force -Path $nmDir | Out-Null }
$dst = Join-Path $nmDir $packageName
if (Test-Path $dst) {
    try { (Get-Item $dst -Force).Delete() } catch { cmd /c rmdir "$dst" 2>$null }
}
try {
    New-Item -ItemType Junction -Path $dst -Target $root -ErrorAction Stop | Out-Null
    Ok "联结 $packageName → $root"
} catch {
    Fail "建联结失败：$($_.Exception.Message)"
    Write-Host '  需要管理员权限的 PowerShell 窗口。' -ForegroundColor DarkGray
    exit 1
}

$utf8 = New-Object System.Text.UTF8Encoding $false
$json = [System.IO.File]::ReadAllText($pkgPath, $utf8) | ConvertFrom-Json

if ($null -eq $json.dependencies) { $json | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) }
if ($null -eq $json.dsh) { $json | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{}) }
if ($null -eq $json.dsh.profile) { $json.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{}) }
if ($null -eq $json.dsh.profile.bundles) { $json.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue @() }

$link = 'link:' + ($root -replace '\\', '/')
$json.dependencies | Add-Member -NotePropertyName $packageName -NotePropertyValue $link -Force
$bundles = @($json.dsh.profile.bundles)
if ($bundles -notcontains $packageName) { $bundles += $packageName }
$json.dsh.profile.bundles = @($bundles)

[System.IO.File]::WriteAllText($pkgPath, ($json | ConvertTo-Json -Depth 12) + "`n", $utf8)
Ok "已登记依赖与 bundle"

$check = [System.IO.File]::ReadAllText($pkgPath, $utf8) | ConvertFrom-Json
$ok = $check.dependencies.PSObject.Properties.Name.Contains($packageName) -and
      (@($check.dsh.profile.bundles) -contains $packageName) -and
      (Test-Path $dst)
if ($ok) { Ok '自检通过' } else { Fail '自检未通过，请检查 package.json' }

Write-Host ''
Write-Host '安装完成。请完全退出 DSH（含托盘）再重新打开，然后：' -ForegroundColor Green
Write-Host '  右侧栏「工作区文件」→ 右键任意一行 → 应出现「复制文件地址」等菜单项。'
Write-Host ''