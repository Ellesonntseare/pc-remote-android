# TalentLMS scheduled login: weekdays at 08:00, starting 2026-10-19.
# Uses the Windows PC's local timezone.
$ErrorActionPreference = 'Stop'
$taskName = 'TalentLMS Daily Login' # Existing task name: replaces old daily schedule.
$projectDir = $PSScriptRoot
$python = Join-Path $projectDir '.venv\Scripts\pythonw.exe'
$script = Join-Path $projectDir 'talentlms_login.py'
if (-not (Test-Path -LiteralPath $python)) { throw 'Python environment missing. Run START-HERE.bat first.' }
if (-not (Test-Path -LiteralPath $script)) { throw 'Login script missing. Extract the full ZIP first.' }
$startDate = '2026-10-19'
$runTime = '08:00'
$startAt = [datetime]::ParseExact("$startDate $runTime", 'yyyy-MM-dd HH:mm', [System.Globalization.CultureInfo]::InvariantCulture)
if ($startAt.DayOfWeek -ne [System.DayOfWeek]::Monday) { throw "Configured date must be a Monday." }
$weekdays = @('Monday','Tuesday','Wednesday','Thursday','Friday')
$trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek $weekdays -At $startAt
$trigger.StartBoundary = $startAt.ToString('yyyy-MM-ddTHH:mm:ss', [System.Globalization.CultureInfo]::InvariantCulture)
$action = New-ScheduledTaskAction -Execute $python -Argument ('"{0}"' -f $script) -WorkingDirectory $projectDir
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
$saved = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
$weekly = @($saved.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskWeeklyTrigger' })
if ($weekly.Count -ne 1) { throw 'Registered task lacks expected weekly trigger. Inspect it in Task Scheduler.' }
Write-Host 'SUCCESS: TalentLMS login scheduled.' -ForegroundColor Green
Write-Host "First scheduled date: Monday $startDate"
Write-Host "Time: $runTime (your Windows local time)"
Write-Host 'Days: Monday, Tuesday, Wednesday, Thursday, Friday'
Write-Host 'No Saturday or Sunday login.'
Write-Host "Task name: $taskName (old daily schedule replaced)"
Write-Host "Activity log: $env:LOCALAPPDATA\TalentLMSDailyLogin\activity.log"
Write-Host 'Your PC must be on, awake and signed in to Windows.'
Write-Host 'Missed logins are not caught up late or on weekends.'
