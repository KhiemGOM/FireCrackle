[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1') -Force
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Archive/Microsoft.PowerShell.Archive.psd1') -Force
$project = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'retry.ps1')
$lock = Get-Content -LiteralPath (Join-Path $project 'release/runtime-lock.json') -Raw | ConvertFrom-Json
$cache = Join-Path $project '.release-cache'
$cacheKey = "ffmpeg-$($lock.version)-$($lock.sha256)"
$archive = Join-Path $cache "$cacheKey.$($lock.kind)"
$unpacked = Join-Path $cache $cacheKey
$runtime = Join-Path $project 'src-tauri/runtime'
New-Item -ItemType Directory -Path $cache -Force | Out-Null
if (!(Test-Path -LiteralPath $archive)) {
    Write-Host "Downloading pinned FFmpeg $($lock.version)..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    # A "service unavailable" from the host must not cost a whole release run: retry with a growing wait.
    Invoke-WithRetry -Attempts 4 -DelaySeconds 10 -Action {
        Remove-Item -LiteralPath "$archive.partial" -Force -ErrorAction SilentlyContinue
        Invoke-WebRequest -Uri $lock.url -OutFile "$archive.partial" -UseBasicParsing
    }
    Move-Item -LiteralPath "$archive.partial" -Destination $archive -Force
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $lock.sha256) {
    throw "FFmpeg checksum mismatch: $archive. Remove this cached archive and retry."
}
$extracted = Join-Path $unpacked '.extracted'
if (!(Test-Path -LiteralPath $extracted)) {
    if ($lock.kind -eq 'zip') {
        Expand-Archive -LiteralPath $archive -DestinationPath $unpacked -Force
    } elseif ($lock.kind -eq '7z') {
        New-Item -ItemType Directory -Path $unpacked -Force | Out-Null
        & (Join-Path $env:SystemRoot 'System32/tar.exe') -xf $archive -C $unpacked
        if ($LASTEXITCODE -ne 0) { throw 'Could not extract pinned FFmpeg archive.' }
    } else { throw "Unsupported FFmpeg archive: $($lock.kind)" }
    $lock.sha256 | Set-Content -LiteralPath $extracted -Encoding ASCII
}
$bins = @(Get-ChildItem -LiteralPath $unpacked -Recurse -File -Filter ffmpeg.exe)
if ($bins.Count -ne 1) { throw 'Expected one FFmpeg executable in pinned package.' }
$vendor = Split-Path $bins[0].DirectoryName -Parent
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
foreach ($name in @('ffmpeg.exe', 'ffprobe.exe')) {
    $source = Join-Path $bins[0].DirectoryName $name
    if (!(Test-Path -LiteralPath $source)) { throw "Missing $name in FFmpeg archive" }
    Copy-Item -LiteralPath $source -Destination (Join-Path $runtime $name) -Force
}
# Preserve the vendor's license and build/library attribution, rather than copying executables alone.
foreach ($item in Get-ChildItem -LiteralPath $vendor -File) {
    Copy-Item -LiteralPath $item.FullName -Destination $runtime -Force
}
if (!(Test-Path -LiteralPath (Join-Path $runtime 'LICENSE'))) { throw 'FFmpeg license file missing.' }
@"
FFmpeg $($lock.version), GPL-3.0-or-later. Separate executable tools, invoked by FireCrackle.
Unmodified binary archive: $($lock.url)
SHA-256: $($lock.sha256)
Build provider and external-library details: $($lock.homepage)
FFmpeg source: $($lock.source)
See the original LICENSE and README in this folder for build configuration and dependencies.
"@ | Set-Content -LiteralPath (Join-Path $runtime 'SOURCE.txt') -Encoding UTF8
foreach ($name in @('ffmpeg.exe', 'ffprobe.exe')) {
    $output = & (Join-Path $runtime $name) -version 2>&1
    if ($LASTEXITCODE -ne 0) { throw "$name failed its startup check: $output" }
}
Write-Host "Video tools ready: $runtime"
