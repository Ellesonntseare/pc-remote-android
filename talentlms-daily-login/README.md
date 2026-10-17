# TalentLMS automated login — weekday schedule (Windows)

**Schedule:** starts Monday **19 October 2026**, **08:00 AM Windows local time**, repeats **Monday through Friday only**. No weekend logins.

**My Training:** https://intersect-alfharon.talentlms.com/plus/my/training

## Install

**Preferred complete package:** download `TalentLMS-Weekdays-08AM-Windows.zip` from the ChatGPT conversation where this schedule was generated. This repository's original `TalentLMS-Daily-Login-Windows.zip` is the **older daily version** and is retained for history; do not use it alone to install the new weekday schedule.

1. Install Python 3 for Windows from https://www.python.org/downloads/windows/.
2. Extract the **updated weekday ZIP** into a permanent folder.
3. Run `START-HERE.bat`; it installs Playwright, saves credentials in Windows Credential Manager and tests the login. The schedule installs automatically after a successful test.
4. To change an already-installed old daily schedule without re-entering your password, copy `SCHEDULE-WEEKDAYS.ps1`, `UPDATE-SCHEDULE.bat`, `CHECK-SCHEDULE.ps1` and `CHECK-SCHEDULE.bat` from this repository into the same folder as the previous script, then run `UPDATE-SCHEDULE.bat`.
5. Run `CHECK-SCHEDULE.bat` and check the next trigger (or inspect `Task Scheduler Library > TalentLMS Daily Login` using `taskschd.msc`).

The **Task Scheduler name remains `TalentLMS Daily Login`** intentionally, so the new Monday-Friday trigger replaces the previous daily trigger.

The PC must be awake, online and logged into Windows at 08:00. Missed runs are skipped, not run during weekends. This only signs in; it does not complete training lessons. Passwords and browser-session cookies are not checked into GitHub. Unattended login may fail if CAPTCHA, one-time codes or SSO verification are required.
