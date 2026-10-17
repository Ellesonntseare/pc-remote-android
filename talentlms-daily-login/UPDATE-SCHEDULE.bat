@echo off
setlocal
cd /d "%~dp0"
echo Updating TalentLMS schedule to Mon-Fri 08:00 from 2026-10-19...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0SCHEDULE-WEEKDAYS.ps1"
if errorlevel 1 (
  echo Update failed. Review the error message above.
  pause
  exit /b 1
)
echo.
echo Schedule updated. To see it, run CHECK-SCHEDULE.bat.
pause
