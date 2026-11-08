# Builds resources/launcher/Lumina Quick Note.exe from build/quicknote-launcher.
# See Launcher.cs for why the stub exists. Uses the .NET Framework 4.x compiler
# that is part of Windows itself, so a clean build machine needs nothing extra.
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $csc -PathType Leaf)) {
  throw "csc.exe not found at $csc (.NET Framework 4.x is required to build the Quick Note launcher)"
}

$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
# AssemblyVersion needs four numeric parts; drop any prerelease suffix.
$numeric = ($version -split '[-+]')[0]
$parts = @($numeric.Split('.')) + @('0', '0', '0', '0')
$assemblyVersion = ($parts[0..3]) -join '.'

$src = Join-Path $projectRoot 'build\quicknote-launcher\Launcher.cs'
$icon = Join-Path $projectRoot 'resources\quicknote-icon.ico'
$outDir = Join-Path $projectRoot 'resources\launcher'
$out = Join-Path $outDir 'Lumina Quick Note.exe'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# Version comes from package.json at build time rather than being hard-coded in
# the .cs file, so the stub can never ship with a stale version number.
$versionSrc = Join-Path $outDir 'LauncherVersion.g.cs'
Set-Content -LiteralPath $versionSrc -Encoding UTF8 -Value "static class LauncherVersion { public const string Value = `"$assemblyVersion`"; }"

# /codepage:65001 — the source is BOM-less UTF-8 (the © in the copyright attribute).
& $csc /nologo /codepage:65001 /target:winexe /optimize+ /platform:anycpu "/win32icon:$icon" "/out:$out" $src $versionSrc
if ($LASTEXITCODE -ne 0) { throw "csc.exe failed with exit code $LASTEXITCODE" }
Remove-Item -LiteralPath $versionSrc
Write-Output "Built $out ($assemblyVersion)"
