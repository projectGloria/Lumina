<#
.SYNOPSIS
  Populate resources/speech with the engines and models the installer carries.

.DESCRIPTION
  These are gigabytes of upstream binaries and model weights, so they are not
  in git. Run this once before `npm run build:win` if you want an installer
  that can set up dictation with no network; skip it and the build simply
  reports no packs bundled, which is what CI does.

  Everything lands under resources/speech/<pack-id>/, the layout
  src/main/speechPacks.ts expects.

.PARAMETER Packs
  Which to fetch. Default is all four.

.EXAMPLE
  pwsh scripts/fetch-speech-packs.ps1
  pwsh scripts/fetch-speech-packs.ps1 -Packs engine-cpu,model-base
#>
[CmdletBinding()]
param(
  [ValidateSet('engine-cpu', 'engine-cuda', 'model-base', 'model-small')]
  [string[]] $Packs = @('engine-cpu', 'engine-cuda', 'model-base', 'model-small')
)

$ErrorActionPreference = 'Stop'

# Pinned: a whisper.cpp release whose CLI is `whisper-cli` and whose server
# accepts --audio-ctx. Moving this forward is a deliberate act, not a default.
$Release = 'b4938'
$Base = "https://github.com/ggml-org/whisper.cpp/releases/download/$Release"
$Models = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'

$Root = Split-Path -Parent $PSScriptRoot
$Speech = Join-Path $Root 'resources/speech'

function Get-File($Url, $Destination) {
  Write-Host "  downloading $(Split-Path -Leaf $Destination)…"
  # -UseBasicParsing keeps this working on a machine with no IE profile, and
  # ProgressPreference off makes Invoke-WebRequest orders of magnitude faster
  # on large files.
  $previous = $ProgressPreference
  $ProgressPreference = 'SilentlyContinue'
  try {
    Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing
  } finally {
    $ProgressPreference = $previous
  }
}

function Expand-Engine($Url, $Target) {
  $zip = Join-Path ([System.IO.Path]::GetTempPath()) "lumina-$([guid]::NewGuid()).zip"
  $staging = Join-Path ([System.IO.Path]::GetTempPath()) "lumina-$([guid]::NewGuid())"
  try {
    Get-File $Url $zip
    Expand-Archive -Path $zip -DestinationPath $staging -Force

    # Both Windows archives nest everything one level down in Release\.
    $inner = Join-Path $staging 'Release'
    $source = if (Test-Path $inner) { $inner } else { $staging }

    New-Item -ItemType Directory -Force -Path $Target | Out-Null
    Get-ChildItem $source -File | Copy-Item -Destination $Target -Force
  } finally {
    Remove-Item $zip, $staging -Recurse -Force -ErrorAction SilentlyContinue
  }
}

foreach ($pack in $Packs) {
  $target = Join-Path $Speech $pack
  Write-Host "$pack"

  switch ($pack) {
    'engine-cpu' { Expand-Engine "$Base/whisper-bin-x64.zip" $target }
    'engine-cuda' { Expand-Engine "$Base/whisper-cublas-12.4.0-bin-x64.zip" $target }
    'model-base' {
      New-Item -ItemType Directory -Force -Path $target | Out-Null
      Get-File "$Models/ggml-base.bin" (Join-Path $target 'ggml-base.bin')
    }
    'model-small' {
      New-Item -ItemType Directory -Force -Path $target | Out-Null
      Get-File "$Models/ggml-small.bin" (Join-Path $target 'ggml-small.bin')
    }
  }

  # A model pack must not carry an engine and vice versa: the two are separate
  # choices in the installer, and a stray .bin inside an engine folder would be
  # copied twice onto the user's disk.
  if ($pack -like 'engine-*') { Remove-Item (Join-Path $target '*.bin') -Force -ErrorAction SilentlyContinue }

  $mb = [math]::Round((Get-ChildItem $target -Recurse -File | Measure-Object Length -Sum).Sum / 1MB)
  Write-Host "  $pack ready — $mb MB" -ForegroundColor Green
}

$total = [math]::Round((Get-ChildItem $Speech -Recurse -File | Measure-Object Length -Sum).Sum / 1MB)
Write-Host "resources/speech is $total MB" -ForegroundColor Cyan
