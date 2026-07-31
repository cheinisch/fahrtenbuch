[CmdletBinding()]
param(
  [ValidateSet("up", "down", "pull", "logs", "restart")]
  [string]$Action = "up"
)

$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
Push-Location $root
try {
  switch ($Action) {
    "up"      { docker compose up -d }
    "down"    { docker compose down }
    "pull"    { docker compose pull }
    "logs"    { docker compose logs -f }
    "restart" { docker compose restart }
  }

  if ($LASTEXITCODE -ne 0) {
    throw "Docker-Compose-Befehl fehlgeschlagen."
  }
}
finally {
  Pop-Location
}
