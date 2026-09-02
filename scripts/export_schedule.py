"""Export a successful import atomically. Failure must stop the Pages deployment."""
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from schedule import SOURCE_URL, parse_schedule

request = urllib.request.Request(SOURCE_URL, headers={'User-Agent': 'Konsertsalen-display/1.0'})
with urllib.request.urlopen(request, timeout=45) as response:
    html = response.read(2_000_001)
    if len(html) > 2_000_000:
        raise ValueError('Schemat är oväntat stort.')
    html = html.decode(response.headers.get_content_charset() or 'utf-8')
events, excluded = parse_schedule(html)
result = {'events': events, 'excluded': excluded, 'source': SOURCE_URL,
          'syncedAt': datetime.now(timezone.utc).isoformat()}
target = Path(__file__).resolve().parent.parent / 'public' / 'schedule.json'
temporary = target.with_suffix('.tmp')
temporary.write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
temporary.replace(target)
print(f'{len(events)} konserter exporterade, {len(excluded)} andra bokningar bortfiltrerade.')
