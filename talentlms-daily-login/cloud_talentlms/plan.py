"""Plan a scheduled TalentLMS run without exposing credentials."""
from __future__ import annotations
import json
import os
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

TIME_ZONE = 'Africa/Johannesburg'
START_DATE = date(2026, 10, 19)
OUTPUT = Path(__file__).with_name('result.json')


def schedule_plan(local_date: date, manual: bool, has_credentials: bool) -> dict:
    result = {
        'date': local_date.isoformat(),
        'time_zone': TIME_ZONE,
        'scheduled_time': '08:00',
        'scheduled_days': 'Monday-Friday',
        'manual': manual,
        'status': 'PENDING',
        'reason': 'Login not yet attempted.',
        'should_login': True,
    }
    if not manual and local_date < START_DATE:
        result.update(status='NOT_STARTED', reason='Schedule starts 19 October 2026.', should_login=False)
    elif not manual and local_date.weekday() >= 5:
        result.update(status='NOT_SCHEDULED', reason='No login is scheduled on Saturday or Sunday.', should_login=False)
    elif not has_credentials:
        result.update(status='SETUP_REQUIRED', reason='TalentLMS GitHub Actions credentials are not configured.', should_login=False)
    return result


def main() -> None:
    now = datetime.now(ZoneInfo(TIME_ZONE))
    has_credentials = bool(os.getenv('TALENTLMS_USERNAME', '').strip() and os.getenv('TALENTLMS_PASSWORD', ''))
    manual = os.getenv('GITHUB_EVENT_NAME') == 'workflow_dispatch'
    result = schedule_plan(now.date(), manual, has_credentials)
    result['checked_at'] = now.isoformat(timespec='seconds')
    OUTPUT.write_text(json.dumps(result, indent=2), encoding='utf-8')
    with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as f:
        f.write('should_login=' + ('true' if result['should_login'] else 'false') + '\n')
    print(f"TalentLMS schedule: {result['date']} {result['status']} (Africa/Johannesburg)")


if __name__ == '__main__':
    main()
