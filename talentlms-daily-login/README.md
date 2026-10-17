# TalentLMS Daily Login (Windows)

Website: https://intersect-alfharon.talentlms.com/plus/my/training

## Setup

1. Install **Python 3** from https://www.python.org/downloads/windows/ (with the Python launcher).
2. Extract the entire ZIP into a permanent folder on your Windows PC, e.g. `Documents\TalentLMS-Daily-Login`. Do not delete or move the folder after scheduling.
3. Double-click **START-HERE.bat**. It installs Playwright/Chromium and saves **your own credentials** using Windows Credential Manager.
4. A visible browser opens once for a test login. If the site asks for 2FA or CAPTCHA, solve it yourself in that window. If login succeeds, the script will close the browser.
5. Choose your preferred daily time in `HH:mm` (e.g. `08:00` or `19:30`). The script creates a Windows Task Scheduler task called `TalentLMS Daily Login`.

## How it operates

At the chosen time Windows opens a headless browser, navigates to the **exact My Training URL** above, uses an existing session if possible, otherwise submits the securely stored username/password, and checks that it reached My Training. It then closes the browser. It does **not** complete lessons or mark attendance/completion. Login events are saved to:

`%LOCALAPPDATA%\TalentLMSDailyLogin\activity.log`

The task uses **your own Windows user** and runs when you are signed into Windows. Your computer must be awake and connected to the internet. Windows may attempt a missed run when it becomes available. It won't automatically wake a fully powered-off PC.

### Helper files

- `START-HERE.bat` — installation, credentials, first test and daily schedule.
- `SET-LOGIN.bat` — change your saved credentials.
- `RUN-VISIBLE-TEST.bat` — debug login with a visible browser (2FA may be handled manually).
- `RUN-NOW.bat` — run the same headless login used by Task Scheduler.
- `SCHEDULE-DAILY.ps1` — change the scheduled time (open PowerShell inside this folder and run with `powershell -ExecutionPolicy Bypass -File .\SCHEDULE-DAILY.ps1`).
- `REMOVE-LOGIN.bat` — unregister schedule and clear stored credentials + browser cookies.

## Privacy and limitations

- **Never send your password to anyone.** `keyring` stores credentials in Windows Credential Manager, not in plaintext files or task arguments.
- The dedicated browser profile is at `%LOCALAPPDATA%\TalentLMSDailyLogin\browser-profile` and contains session cookies. Protect your Windows account, and use `REMOVE-LOGIN.bat` to clear it when finished.
- If the portal requires CAPTCHA, email verification, authenticator codes, or company single sign-on, unattended login may not be possible. Run the visible test to handle prompts manually; the script **does not bypass security checks**.
- Login selectors are based on common TalentLMS forms, not a live authenticated inspection of your private portal. If its form differs, adjust `talentlms_login.py` or share a screenshot of the login screen (with no credentials).
- Automation must be allowed by your training provider's policies.