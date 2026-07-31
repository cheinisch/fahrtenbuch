[CmdletBinding()]
param([string]$BuildFile = (Join-Path $PSScriptRoot "..\BUILD"))
$ErrorActionPreference = "Stop"
$BuildFile = [IO.Path]::GetFullPath($BuildFile)
if (-not (Test-Path $BuildFile)) { Set-Content $BuildFile "1" -NoNewline; exit 0 }
[int]$current = (Get-Content $BuildFile -Raw).Trim()
$next = $current + 1
Set-Content $BuildFile $next -NoNewline
Write-Host "Buildnummer: $current -> $next"
