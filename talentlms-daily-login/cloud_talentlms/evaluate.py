"""Give scheduled runs a useful green/red status after the report was submitted."""
import json
from pathlib import Path

path = Path(__file__).with_name('result.json')
if not path.is_file():
    print('LOGIN STATUS: UNKNOWN (result was not written)')
    raise SystemExit(1)
status = json.loads(path.read_text(encoding='utf-8')).get('status', 'UNKNOWN')
print('LOGIN STATUS:', status)
raise SystemExit(0 if status in ('SUCCESS', 'NOT_SCHEDULED', 'NOT_STARTED') else 1)
