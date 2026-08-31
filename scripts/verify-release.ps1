$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $projectRoot 'release'
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$artifacts = @(
  (Join-Path $releaseDir "Lumina-$version-x64.exe"),
  (Join-Path $releaseDir "Lumina-$version-portable.exe")
)

foreach ($artifact in $artifacts) {
  if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
    throw "Missing release artifact: $artifact"
  }

  $signature = Get-AuthenticodeSignature -LiteralPath $artifact
  if ($signature.Status -ne 'Valid' -and $env:LUMINA_ALLOW_UNSIGNED -ne '1') {
    throw "Release artifact is not signed by a trusted publisher: $artifact ($($signature.Status))"
  }

  $hash = Get-FileHash -LiteralPath $artifact -Algorithm SHA256
  $versionInfo = (Get-Item -LiteralPath $artifact).VersionInfo
  if ($versionInfo.ProductName -ne 'Lumina' -or $versionInfo.ProductVersion -ne $version) {
    throw "Release metadata does not match Lumina $version in $artifact"
  }
  Write-Output "$($hash.Hash)  $([System.IO.Path]::GetFileName($artifact))"
}

$asar = Join-Path $releaseDir 'win-unpacked\resources\app.asar'
if (-not (Test-Path -LiteralPath $asar -PathType Leaf)) {
  throw "Missing packaged application archive: $asar"
}

$asarCli = Join-Path $projectRoot 'node_modules\@electron\asar\bin\asar.js'
$contents = & node $asarCli list $asar
foreach ($required in @(
  '\out\main\index.js',
  '\out\preload\index.js',
  '\out\renderer\index.html',
  '\package.json'
)) {
  if ($contents -notcontains $required) {
    throw "Packaged application is missing $required"
  }
}

Write-Output 'Release artifacts passed signature, hash, and package-content checks.'
