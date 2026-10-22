[CmdletBinding()]
param(
    [ValidateSet('zip', 'rar')][string]$Format = 'zip',
    [switch]$Installer,
    [switch]$SkipChecks,
    [switch]$CleanInstall,
    [switch]$ValidateOnly
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1') -Force
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Archive/Microsoft.PowerShell.Archive.psd1') -Force
$project = Split-Path $PSScriptRoot -Parent
function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed (exit $LASTEXITCODE): $($Arguments -join ' ')" }
}
$package = Get-Content -LiteralPath (Join-Path $project 'package.json') -Raw | ConvertFrom-Json
$tauri = Get-Content -LiteralPath (Join-Path $project 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
$cargo = Get-Content -LiteralPath (Join-Path $project 'src-tauri/Cargo.toml') -Raw
$cargoVersion = [regex]::Match($cargo, '(?m)^version\s*=\s*"([^"]+)"').Groups[1].Value
$version = $package.version
if ($version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { throw 'Invalid release version.' }
if ($tauri.version -ne $version -or $cargoVersion -ne $version) { throw 'package.json, Cargo.toml and tauri.conf.json versions must agree.' }
if ($env:GITHUB_REF -like 'refs/tags/*' -and $env:GITHUB_REF -ne "refs/tags/v$version") { throw "Tag must be v$version." }
if (![Environment]::Is64BitProcess -or $env:OS -ne 'Windows_NT') { throw 'Build this Windows x64 release in 64-bit PowerShell on Windows.' }
foreach ($program in @('node', 'npm.cmd', 'cargo', 'git')) {
    if (!(Get-Command $program -ErrorAction SilentlyContinue)) { throw "Install $program before building." }
}
$hostInfo = & rustc -vV | Out-String
if ($LASTEXITCODE -ne 0 -or $hostInfo -notmatch 'host: x86_64-pc-windows-msvc') {
    throw 'Use the x86_64-pc-windows-msvc Rust toolchain for this Windows x64 package.'
}
$rar = $null
if ($Format -eq 'rar') {
    $cmd = Get-Command rar.exe -ErrorAction SilentlyContinue
    if ($cmd) { $rar = $cmd.Source }
    elseif (Test-Path -LiteralPath "$env:ProgramFiles/WinRAR/Rar.exe") { $rar = "$env:ProgramFiles/WinRAR/Rar.exe" }
    else { throw 'RAR creation requires WinRAR (Rar.exe). Install it or use the default ZIP format.' }
}
if ($ValidateOnly) { Write-Host "Release configuration valid: FireCrackle v$version (Windows x64, $Format)"; return }
$oldPath = $env:PATH
$oldTarget = $env:CARGO_TARGET_DIR
$target = if ($oldTarget) { $oldTarget } else { Join-Path $project 'src-tauri/target' }
Push-Location $project
try {
    Invoke-Checked 'python' @((Join-Path $PSScriptRoot 'prepare-no-fire.py'))
    Invoke-Checked 'python' @((Join-Path $PSScriptRoot 'prepare-quad-phase.py'))
    & (Join-Path $PSScriptRoot 'prepare-runtime.ps1')
    $env:PATH = "$(Join-Path $project 'src-tauri/runtime');$oldPath"
    $env:CARGO_TARGET_DIR = $target
    if ($CleanInstall -or !(Test-Path -LiteralPath (Join-Path $project 'node_modules/.package-lock.json'))) {
        # Fail before npm ci removes anything when a running dev process has a native module loaded.
        foreach ($module in Get-ChildItem -LiteralPath (Join-Path $project 'node_modules') -Filter '*.node' -Recurse -File -ErrorAction SilentlyContinue) {
            try { $probe = [IO.File]::Open($module.FullName, 'Open', 'ReadWrite', 'None'); $probe.Dispose() }
            catch { throw "A development process is using $($module.Name). Stop that dev command before a clean dependency install." }
        }
        Invoke-Checked 'npm.cmd' @('ci')
    } else { Invoke-Checked 'npm.cmd' @('ls', '--depth=0') }
    if (!$SkipChecks) {
        Invoke-Checked 'npm.cmd' @('test')
        Invoke-Checked 'cargo' @('test', '--manifest-path', 'crates/studio_core/Cargo.toml', '--lib', '--tests')
        $env:FIRECRACKLE_TEST_ORT = (Resolve-Path 'src-tauri/runtime/ai/onnxruntime.dll').Path
        $env:FIRECRACKLE_TEST_MODEL = (Resolve-Path 'src-tauri/runtime/ai/no-fire-v3.onnx').Path
        Invoke-Checked 'cargo' @('test', '--manifest-path', 'crates/no_fire_cnn/Cargo.toml')
    }
    $buildArgs = @('run', 'tauri', '--', 'build', '--config', 'src-tauri/tauri.release.conf.json')
    if ($Installer) { $buildArgs += @('--bundles', 'nsis') } else { $buildArgs += '--no-bundle' }
    Invoke-Checked 'npm.cmd' $buildArgs
    $exe = Join-Path $target 'release/firecrackle.exe'
    if (!(Test-Path -LiteralPath $exe)) { throw 'Release executable missing after build.' }
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
    # Fresh output per run; a failed build never overwrites a previous tester package.
    $output = Join-Path $project "releases/v$version/$stamp-$([guid]::NewGuid().ToString('N').Substring(0,6))"
    $name = "FireCrackle-$version-windows-x64"
    $stage = Join-Path $output $name
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    Copy-Item -LiteralPath $exe -Destination (Join-Path $stage 'FireCrackle.exe')
    Copy-Item -LiteralPath (Join-Path $project 'src-tauri/runtime/ai') -Destination (Join-Path $stage 'ai') -Recurse
    $readme = (Get-Content -LiteralPath (Join-Path $project 'release/README-template.txt') -Raw).Replace('{{VERSION}}', $version)
    $readme | Set-Content -LiteralPath (Join-Path $stage 'README.txt') -Encoding UTF8
    $repo = Split-Path $project -Parent
    Copy-Item -LiteralPath (Join-Path $repo 'LICENSE') -Destination (Join-Path $stage 'LICENSE.txt')
    Copy-Item -LiteralPath (Join-Path $repo 'THIRD_PARTY_NOTICES.md') -Destination (Join-Path $stage 'THIRD_PARTY_NOTICES.txt')
    $commit = (& git -c "safe.directory=$($repo.Replace('\','/'))" rev-parse HEAD | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Cannot record release commit.' }
    $changes = @(& git -c "safe.directory=$($repo.Replace('\','/'))" status --porcelain)
    $dirty = $changes.Count -gt 0
    if ($dirty) { Write-Warning "Build tree is dirty:`n$($changes -join "`n")" }
    $runtime = Get-Content -LiteralPath (Join-Path $project 'release/runtime-lock.json') -Raw | ConvertFrom-Json
    [ordered]@{ product = 'FireCrackle'; version = $version; target = 'windows-x64'; builtUtc = $stamp;
        commit = $commit; workingTreeDirty = $dirty; checksRun = !$SkipChecks; externalTools = 'download-on-demand'; ffmpeg = $runtime } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $stage 'release.json') -Encoding UTF8
    Get-ChildItem -LiteralPath $stage -Recurse -File | ForEach-Object {
        "$( (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() )  $($_.FullName.Substring($stage.Length + 1).Replace('\','/'))"
    } | Set-Content -LiteralPath (Join-Path $stage 'SHA256SUMS.txt') -Encoding ASCII
    $archive = Join-Path $output "$name.$Format"
    if ($Format -eq 'zip') {
        . (Join-Path $PSScriptRoot 'release-archive.ps1')
        Write-ReleaseZip -Stage $stage -Destination $archive
    }
    else {
        Push-Location $output
        try { Invoke-Checked $rar @('a', '-r', '-ep1', '-idq', $archive, $name) }
        finally { Pop-Location }
    }
    if ($Format -eq 'zip') { & (Join-Path $PSScriptRoot 'release.test.ps1') -ArchivePath $archive }
    $deliverables = @($archive)
    if ($Installer) {
        $installers = @(Get-ChildItem -LiteralPath (Join-Path $target 'release/bundle/nsis') -Filter '*.exe' -File)
        if ($installers.Count -ne 1) { throw 'Expected one NSIS setup executable; inspect release/bundle/nsis.' }
        $setup = Join-Path $output "FireCrackle-$version-windows-x64-Setup.exe"
        Copy-Item -LiteralPath $installers[0].FullName -Destination $setup
        $deliverables += $setup
    }
    $deliverables | ForEach-Object { "$( (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant() )  $(Split-Path $_ -Leaf)" } |
        Set-Content -LiteralPath (Join-Path $output 'SHA256SUMS.txt') -Encoding ASCII
    Write-Host "Ready to share: $archive"
    if ($Installer) { Write-Host "Setup executable: $setup" }
    Write-Host "Release files: $output"
} finally {
    Pop-Location
    $env:PATH = $oldPath
    $env:CARGO_TARGET_DIR = $oldTarget
}
