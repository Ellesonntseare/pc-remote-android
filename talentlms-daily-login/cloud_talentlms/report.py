"""Publish a daily TalentLMS status in Actions summary and private GitHub Issues."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

OUTPUT = Path(__file__).with_name('result.json')
API = 'https://api.github.com'


def load_result() -> dict:
    if OUTPUT.is_file():
        result = json.loads(OUTPUT.read_text(encoding='utf-8'))
    else:
        now = datetime.now(ZoneInfo('Africa/Johannesburg'))
        result = dict(
            date=now.date().isoformat(),
            time_zone='Africa/Johannesburg',
            scheduled_time='08:00',
            manual=os.getenv('GITHUB_EVENT_NAME') == 'workflow_dispatch',
            status='RUNNER_ERROR',
            reason='Workflow stopped before the login check could start.',
        )
    if result.get('status') == 'PENDING':
        result.update(status='RUNNER_ERROR', reason='The browser dependencies or login step did not complete.')
    return result


def report_text(result: dict, run_url: str) -> str:
    status = result['status']
    headline = {
        'SUCCESS': '✅ Success — authenticated My Training page verified',
        'NOT_SCHEDULED': '⏭️ Skipped — weekend (no login planned)',
        'NOT_STARTED': '⏳ Not started — schedule starts 19 October 2026',
        'SETUP_REQUIRED': '⚙️ Action required — add your TalentLMS login secrets',
    }.get(status, '❌ Login not confirmed')
    return (
        f'## TalentLMS login report — {result["date"]}\n\n'
        f'**Result:** {headline}\n\n'
        f'**Detail:** {result.get("reason", "Not available")}\n\n'
        f'**Scheduled login:** 08:00 SAST, Monday–Friday (from 19 October 2026)\n\n'
        f'**Run type:** {"Manual test" if result.get("manual") else "Daily scheduled report"}\n\n'
        f'**Checked at:** {result.get("checked_at", "Not available")}\n\n'
        f'**[Open the workflow run]({run_url})**\n\n'
        '_A verified login means the My Training page opened; it does not prove course attendance or lesson completion._\n'
    )


def api_request(method: str, path: str, token: str, data: dict | None = None):
    encoded = json.dumps(data).encode('utf-8') if data is not None else None
    req = urllib.request.Request(
        API + path, data=encoded, method=method,
        headers={
            'Authorization': 'Bearer ' + token,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'talentlms-login-report',
        },
    )
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.load(response)


def upsert_issue(token: str, repo: str, owner: str, result: dict, body: str) -> str:
    path = f'/repos/{repo}/issues'
    heading = f'TalentLMS login report — {result["date"]}'
    existing = api_request('GET', path + '?state=all&per_page=100&sort=created&direction=desc', token)
    for issue in existing:
        if issue.get('title', '').startswith(heading):
            updated = api_request(
                'PATCH', f'{path}/{issue["number"]}', token,
                {'title': f'{heading} — {result["status"]}', 'body': body + f'\n@{owner}\n'},
            )
            return updated['html_url']
    payload = {
        'title': f'{heading} — {result["status"]}',
        'body': body + f'\n@{owner}\n',
        'assignees': [owner],
    }
    try:
        created = api_request('POST', path, token, payload)
    except urllib.error.HTTPError as error:
        if error.code != 422:
            raise
        # Assignments may be restricted. Save the report regardless.
        del payload['assignees']
        created = api_request('POST', path, token, payload)
    return created['html_url']


def main() -> int:
    result = load_result()
    repo = os.environ.get('GITHUB_REPOSITORY', '')
    run_url = f'https://github.com/{repo}/actions/runs/{os.getenv("GITHUB_RUN_ID", "")}'
    body = report_text(result, run_url)
    summary_path = os.getenv('GITHUB_STEP_SUMMARY')
    if summary_path:
        with open(summary_path, 'a', encoding='utf-8') as summary:
            summary.write(body + '\n')
    OUTPUT.write_text(json.dumps(result, indent=2), encoding='utf-8')
    token = os.getenv('GITHUB_TOKEN', '')
    if not token or not repo:
        print('Could not create private GitHub Issue: GitHub job token unavailable.')
        return 1
    try:
        issue_url = upsert_issue(token, repo, os.environ.get('GITHUB_REPOSITORY_OWNER', ''), result, body)
    except Exception as error:
        # Do not print raw API responses that could contain private information.
        print(f'GitHub Issue report could not be saved ({type(error).__name__}). Check Issues and GITHUB_TOKEN permissions.')
        return 1
    print(f'Daily report saved privately: {issue_url}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
