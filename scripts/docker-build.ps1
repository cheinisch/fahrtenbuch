[CmdletBinding()]
param(
  [string]$ImageName = "ghcr.io/cheinisch/fahrtenbuch",
  [string]$ImageTag = "dev"
)

$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))

& (Join-Path $PSScriptRoot "increment-build.ps1")

$version = (Get-Content (Join-Path $root "VERSION") -Raw).Trim()
$build = (Get-Content (Join-Path $root "BUILD") -Raw).Trim()
$versionBuildTag = "$version-build$build"

Push-Location $root
try {
  docker build `
    --build-arg "APP_VERSION=$version" `
    --build-arg "BUILD_NUMBER=$build" `
    --tag "${ImageName}:${ImageTag}" `
    --tag "${ImageName}:${versionBuildTag}" `
    .

  if ($LASTEXITCODE -ne 0) {
    throw "Docker-Build fehlgeschlagen."
  }
}
finally {
  Pop-Location
}
