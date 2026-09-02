"""Local preview with SQLite. Not a GitHub Spark deployment server."""
import argparse
import json
import os
import sqlite3
import threading
import urllib.request
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from scripts.schedule import SOURCE_URL, TZ, parse_schedule

ROOT = Path(__file__).parent
DB = ROOT / 'data' / 'concerts.sqlite3'
LOCK = threading.Lock()
PUBLIC = ROOT / 'public'


def connect():
    db = sqlite3.connect(DB)
    db.execute('CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    db.execute('CREATE TABLE IF NOT EXISTS edits (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
    db.execute('CREATE TABLE IF NOT EXISTS manual (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
    return db


def read_state(db, key, fallback=None):
    row = db.execute('SELECT value FROM state WHERE key=?', (key,)).fetchone()
    return json.loads(row[0]) if row else fallback


def put_state(db, key, value):
    db.execute('INSERT OR REPLACE INTO state VALUES (?,?)', (key, json.dumps(value)))


def sync(html=None):
    with LOCK:
        try:
            if html is None:
                request = urllib.request.Request(SOURCE_URL, headers={'User-Agent': 'Konsertsalen-display/1.0'})
                with urllib.request.urlopen(request, timeout=25) as response:
                    html = response.read(2_000_001)
                    if len(html) > 2_000_000:
                        raise ValueError('Schemat är oväntat stort.')
                    html = html.decode(response.headers.get_content_charset() or 'utf-8')
            events, excluded = parse_schedule(html)
            with connect() as db:
                put_state(db, 'schedule', {'events': events, 'excluded': excluded,
                    'syncedAt': datetime.now(timezone.utc).isoformat(), 'source': SOURCE_URL})
                put_state(db, 'error', None)
            return True
        except Exception as exc:
            with connect() as db:
                put_state(db, 'error', 'Schemat kunde inte uppdateras. Senast hämtade uppgifter visas.')
            print('Schedule sync failed:', str(exc), flush=True)
            return False


def snapshot():
    with connect() as db:
        result = read_state(db, 'schedule', {'events': [], 'excluded': [], 'syncedAt': None, 'source': SOURCE_URL})
        legacy_image = read_state(db, 'imageProgram')
        result['imagePrograms'] = read_state(db, 'imagePrograms', [dict(legacy_image, id='program')] if legacy_image else [])
        result['error'] = read_state(db, 'error')
        result['edits'] = {row[0]: json.loads(row[1]) for row in db.execute('SELECT id,value FROM edits')}
        result['events'].extend(json.loads(row[0]) for row in db.execute('SELECT value FROM manual'))
        result['events'].sort(key=lambda event: event['start'])
    return result


class Handler(BaseHTTPRequestHandler):
    def reply(self, code, payload, mime='application/json; charset=utf-8'):
        data = json.dumps(payload, ensure_ascii=False).encode() if isinstance(payload, (dict, list)) else payload
        self.send_response(code)
        self.send_header('Content-Type', mime)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def valid_host(self):
        return self.headers.get('Host') in (f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}')

    def do_GET(self):
        if not self.valid_host():
            return self.reply(403, {'error': 'Ogiltig värd.'})
        path = urlparse(self.path).path
        if path == '/api/schedule':
            return self.reply(200, snapshot())
        if path == '/schedule.json':
            with connect() as db:
                return self.reply(200, read_state(db, 'schedule', {}))
        files = {'/': ('index.html', 'text/html'), '/admin': ('index.html', 'text/html'),
                 '/app.js': ('app.js', 'text/javascript'), '/program.mjs': ('program.mjs', 'text/javascript'),
                 '/style.css': ('style.css', 'text/css'),
                 '/assets/oru-logo.png': ('assets/oru-logo.png', 'image/png')}
        for name in ('firebase-config.mjs', 'firebase-store.mjs', 'stockholm.mjs', 'clock.mjs', 'image-program.mjs'):
            files['/' + name] = (name, 'text/javascript')
        if path not in files:
            return self.reply(404, {'error': 'Sidan finns inte.'})
        name, mime = files[path]
        self.reply(200, (PUBLIC / name).read_bytes(), mime + '; charset=utf-8')

    def do_POST(self):
        expected_origins = (f'http://127.0.0.1:{self.server.server_port}', f'http://localhost:{self.server.server_port}')
        if not self.valid_host() or self.headers.get('Origin') not in expected_origins:
            return self.reply(403, {'error': 'Redigering tillåts bara från den lokala appen.'})
        try:
            length = int(self.headers.get('Content-Length', 0))
            if not 0 < length <= (900000 if urlparse(self.path).path == '/api/image' else 16000):
                raise ValueError('Ogiltig storlek.')
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError('Ogiltiga uppgifter.')
            if urlparse(self.path).path == '/api/image':
                record = payload.get('record')
                if record is not None:
                    if not isinstance(record, dict) or set(record) != {'title', 'image', 'start', 'end'}:
                        raise ValueError('Ogiltig bildpost.')
                    if not isinstance(record['title'], str) or not 0 < len(record['title']) <= 120:
                        raise ValueError('Ange ett namn på högst 120 tecken.')
                    if not isinstance(record['image'], str) or not (record['image'].startswith('data:image/jpeg;base64,') or (record['image'].startswith('https://') and len(record['image']) <= 4000)) or len(record['image']) > 850000:
                        raise ValueError('Ogiltig bild.')
                    start, end = (datetime.fromisoformat(record[k].replace('Z', '+00:00')) for k in ('start', 'end'))
                    if start.tzinfo is None or end.tzinfo is None or end <= start:
                        raise ValueError('Kontrollera bildens visningstider.')
                with connect() as db:
                    legacy_image = read_state(db, 'imageProgram')
                    images = read_state(db, 'imagePrograms', [dict(legacy_image, id='program')] if legacy_image else [])
                    image_id = payload.get('id') or str(uuid.uuid4())
                    images = [image for image in images if image['id'] != image_id]
                    if record:
                        images.append(dict(record, id=image_id))
                    put_state(db, 'imagePrograms', images)
                return self.reply(200, snapshot())
            event_type = payload.get('eventType', '')
            if not isinstance(event_type, str) or len(event_type) > 40:
                raise ValueError('Evenemangstypen får vara högst 40 tecken.')
            event_type = event_type.strip()
            path = urlparse(self.path).path
            if path not in ('/api/edit', '/api/manual'):
                return self.reply(404, {'error': 'Sidan finns inte.'})
            if path == '/api/manual':
                event_id = payload.get('id')
                if event_id and not any(e['id'] == event_id and e.get('manual') for e in snapshot()['events']):
                    raise ValueError('Den extra konserten finns inte längre.')
                if payload.get('delete') is True:
                    if not event_id:
                        raise ValueError('Konsertens id saknas.')
                    with connect() as db:
                        db.execute('DELETE FROM manual WHERE id=?', (event_id,))
                    return self.reply(200, snapshot())
                title, description = payload.get('title'), payload.get('description', '')
                if not isinstance(title, str) or not title.strip() or len(title) > 240:
                    raise ValueError('Rubriken behöver vara 1–240 tecken.')
                if not isinstance(description, str) or len(description) > 600:
                    raise ValueError('Beskrivningen får vara högst 600 tecken.')
                date = payload.get('date', '')
                start = datetime.fromisoformat(date + 'T' + payload.get('startTime', '')).replace(tzinfo=TZ)
                end = datetime.fromisoformat(date + 'T' + payload.get('endTime', '')).replace(tzinfo=TZ)
                if end <= start:
                    raise ValueError('Sluttiden måste vara efter starttiden samma dag.')
                # Reject nonexistent local times during the spring clock change.
                for stamp in (start, end):
                    if stamp.astimezone(timezone.utc).astimezone(TZ).replace(tzinfo=None) != stamp.replace(tzinfo=None):
                        raise ValueError('Den valda tiden finns inte på grund av sommartidsomställningen.')
                if type(payload.get('hidden')) is not bool:
                    raise ValueError('Ogiltig synlighet.')
                event_id = event_id or 'manual:' + str(uuid.uuid4())
                event = {'id': event_id, 'manual': True, 'date': start.date().isoformat(),
                    'start': start.isoformat(), 'end': end.isoformat(), 'kind': 'extra',
                    'title': title.strip(), 'eventType': event_type, 'description': description.strip(), 'hidden': payload['hidden'],
                    'updatedAt': datetime.now(timezone.utc).isoformat()}
                with connect() as db:
                    db.execute('INSERT OR REPLACE INTO manual VALUES (?,?)', (event_id, json.dumps(event)))
                return self.reply(200, snapshot())
            event = next((e for e in snapshot()['events'] if e['id'] == payload.get('id')), None)
            if not event or event.get('manual'):
                raise ValueError('Bokningen finns inte längre i det aktuella schemat.')
            with connect() as db:
                if payload.get('reset') is True:
                    db.execute('DELETE FROM edits WHERE id=?', (event['id'],))
                else:
                    title, description = payload.get('title'), payload.get('description', '')
                    if not isinstance(title, str) or not title.strip() or len(title) > 240:
                        raise ValueError('Rubriken behöver vara 1–240 tecken.')
                    if not isinstance(description, str) or len(description) > 600:
                        raise ValueError('Beskrivningen får vara högst 600 tecken.')
                    if type(payload.get('hidden')) is not bool:
                        raise ValueError('Ogiltig synlighet.')
                    edit = {'title': title.strip(), 'eventType': event_type, 'description': description.strip(),
                            'hidden': payload['hidden'], 'updatedAt': datetime.now(timezone.utc).isoformat(),
                            'sourceTitle': event['title']}
                    db.execute('INSERT OR REPLACE INTO edits VALUES (?,?)', (event['id'], json.dumps(edit)))
            self.reply(200, snapshot())
        except (ValueError, TypeError) as exc:
            self.reply(400, {'error': str(exc)})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=4173)
    parser.add_argument('--import-html', type=Path)
    parser.add_argument('--offline', action='store_true')
    args = parser.parse_args()
    DB.parent.mkdir(exist_ok=True)
    with connect():
        pass
    if args.import_html:
        sync(args.import_html.read_text(encoding='utf-8'))
    if not args.offline:
        def refresh():
            while True:
                sync()
                threading.Event().wait(300)
        threading.Thread(target=refresh, daemon=True).start()
    print(f'Konsertsalen: http://127.0.0.1:{args.port} • Redigera: /admin', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
