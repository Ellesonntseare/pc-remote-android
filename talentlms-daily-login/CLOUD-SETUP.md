# TalentLMS cloud login — one-time setup

This automation runs from GitHub Actions. Your Windows PC may be completely switched off.

## Schedule
- **Login:** Every **Monday–Friday at 08:00 Africa/Johannesburg**, starting **Monday 19 October 2026**.
- **Private GitHub report:** Every day including weekends. Weekends say **NOT_SCHEDULED** (no login is attempted).
- **ChatGPT report:** A separate daily ChatGPT notification checks the GitHub result after the login window, beginning 19 October.
- GitHub can occasionally delay or drop scheduled jobs; the report will explain missing results when possible.

## Complete setup (required before login can work)

1. Open [the private repository](https://github.com/Ellesonntseare/pc-remote-android).
2. Go to **Settings → Secrets and variables → Actions**.
3. Click **New repository secret**. Name: `TALENTLMS_USERNAME`. Value: your TalentLMS username or email. Save.
4. Click **New repository secret** again. Name: `TALENTLMS_PASSWORD`. Value: your TalentLMS password. Save.
5. Open [TalentLMS Daily Login and Report](https://github.com/Ellesonntseare/pc-remote-android/actions/workflows/talentlms-cloud-login.yml). Select **Run workflow**, use branch **main**, then select **Run workflow**.
6. After the job completes, check the workflow's summary and the [private Issues report](https://github.com/Ellesonntseare/pc-remote-android/issues). It will show SUCCESS, SETUP_REQUIRED, LOGIN_NOT_VERIFIED, HUMAN_VERIFICATION, or another explicit status.
7. For GitHub email/push alerts, enable GitHub notification emails and watch the private repository. Issues are assigned to the repository owner when GitHub allows.

**Never paste your password in an Issue, ChatGPT conversation, workflow file, commit, or screenshot.** Use repository secrets.

## Where files live

- Scheduled GitHub workflow: `main/.github/workflows/talentlms-cloud-login.yml`
- Login/reporting Python code: `talentlms-daily-login/talentlms-daily-login/cloud_talentlms/` (on the private `talentlms-daily-login` branch).
- Existing Windows automation remains separate; it is not needed for cloud login.

## Important limitations

- GitHub uses a fresh Playwright/Chromium browser for each run, with no persistent cookies.
- A successful report means the signed-in **My Training** page was verified **after reloading**, not that coursework was completed or attendance was recorded.
- If TalentLMS demands 2FA, CAPTCHA, single-sign-on or interactive verification, a headless run may fail. The workflow does not bypass those protections.
- The login form's exact structure is not known until an authenticated first run. Report failures allow the automation to be adjusted safely.
- The automation uses GitHub Free's included minutes while available; your other workflows share that quota.

## Disable

To pause, open the [workflow in Actions](https://github.com/Ellesonntseare/pc-remote-android/actions/workflows/talentlms-cloud-login.yml), select the three-dot menu, then **Disable workflow**. You can also delete the workflow from the main branch.

