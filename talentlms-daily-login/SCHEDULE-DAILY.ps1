# Backward-compatible shortcut. The schedule is now WEEKDAYS ONLY.
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'SCHEDULE-WEEKDAYS.ps1')
if (-not $?) { exit 1 }
