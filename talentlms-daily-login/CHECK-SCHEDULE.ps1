$ErrorActionPreference = 'Stop'
$taskName = 'TalentLMS Daily Login'
try {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
    $info = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction Stop
} catch {
    Write-Host 'The TalentLMS schedule is not installed yet.' -ForegroundColor Yellow
    Write-Host 'Run START-HERE.bat for new setup or UPDATE-SCHEDULE.bat for existing setup.'
    exit 1
}
Write-Host "Task: $taskName"
Write-Host "Status: $($task.State)"
Write-Host "Next run (Windows local time): $($info.NextRunTime)"
Write-Host "Previous run: $($info.LastRunTime)"
Write-Host "Previous result: $($info.LastTaskResult)"
foreach ($trigger in $task.Triggers) {
    Write-Host "Trigger type: $($trigger.CimClass.CimClassName)"
    Write-Host "Start boundary: $($trigger.StartBoundary)"
    if ($trigger.CimClass.CimClassName -eq 'MSFT_TaskWeeklyTrigger') {
        Write-Host "Weekday mask (Mon-Fri expected: 62): $($trigger.DaysOfWeek)"
        Write-Host "Weeks interval: $($trigger.WeeksInterval)"
    }
}
Write-Host "Activity log: $env:LOCALAPPDATA\TalentLMSDailyLogin\activity.log"
