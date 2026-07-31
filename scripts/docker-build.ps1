[CmdletBinding()]
param(
  [string]$ImageName = "fahrtenbuch",
  [string]$ImageTag = "dev"
)
$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
& (Join-Path $PSScriptRoot "increment-build.ps1")
$version = (Get-Content (Join-Path $root "VERSION") -Raw).Trim()
$build = (Get-Content (Join-Path $root "BUILD") -Raw).Trim()
docker build --build-arg APP_VERSION=$version --build-arg BUILD_NUMBER=$build `
  --label "org.opencontainers.image.version=$version" `
  --label "de.fahrtenbuch.build=$build" `
  -t "${ImageName}:${ImageTag}" -t "${ImageName}:${version}" $root
if ($LASTEXITCODE -ne 0) { throw "Docker-Build fehlgeschlagen." }
