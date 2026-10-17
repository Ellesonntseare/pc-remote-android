@echo off
setlocal
cd /d "%~dp0"
title TalentLMS Weekday Login - Setup
echo ===================================================
echo TalentLMS Weekday Login - Windows setup
echo Mon-Fri, 08:00, beginning 2026-10-19
echo ===================================================
echo.
where py >nul 2>&1
if errorlevel 1 (
 echo Python 3 was not found. Install it from https://www.python.org/downloads/windows/
 pause
 exit /b 1
)
if not exist ".venv\Scripts\python.exe" (
 echo Creating Python environment...
 py -3 -m venv .venv
 if errorlevel 1 goto :failed
)
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto :failed
".venv\Scripts\python.exe" -m playwright install chromium
if errorlevel 1 goto :failed
echo Step 1: Save credentials securely on your PC.
".venv\Scripts\python.exe" talentlms_login.py --setup
if errorlevel 1 goto :failed
echo Step 2: Test in a visible browser.
".venv\Scripts\python.exe" talentlms_login.py --visible
if errorlevel 1 (
 echo Login test failed. Fix it and retry before scheduling.
 pause
 exit /b 1
)
echo Step 3: Set Mon-Fri at 08:00 starting 2026-10-19.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0SCHEDULE-WEEKDAYS.ps1"
if errorlevel 1 goto :failed
echo Setup completed.
pause
exit /b 0
:failed
echo Setup failed. Review the messages above.
pause
exit /b 1
