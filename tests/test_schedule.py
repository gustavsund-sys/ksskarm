import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import server
from scripts.schedule import parse_schedule


def table(rows, year=2026):
    return '<table class="schemaTabell"><tr><th>Datum</th><th>Start-Slut</th><th>Moment</th></tr>' + f'<tr><td>Vecka 40, {year}</td></tr>' + ''.join(
        '<tr>' + ''.join(f'<td>{cell}</td>' for cell in row) + '</tr>' for row in rows) + '</table>'


class ScheduleTests(unittest.TestCase):
    def test_exact_intervals_and_start_times(self):
        events, excluded = parse_schedule(table([
            ('1 Okt', '16:00-21:00', 'Kväll A'), ('2 Okt', '18:00-21:00', 'Kväll B'),
            ('3 Okt', '12:00-14:00', 'Lunch'), ('4 Okt', '12:15-14:00', 'Annan'),
            ('5 Okt', '16:00-20:00', 'Annan'), ('6 Okt', '08:00-21:00', 'Heldag')]))
        self.assertEqual([e['start'][11:16] for e in events], ['19:00', '19:00', '12:30'])
        self.assertEqual(len(excluded), 3)

    def test_shared_date_entities_and_title_stable_id(self):
        a, _ = parse_schedule(table([('1 Okt', '12:00-14:00', 'A &amp; B'), ('', '18:00-21:00', 'Kväll')]))
        b, _ = parse_schedule(table([('1 Okt', '12:00-14:00', 'Ny titel')]))
        self.assertEqual(a[0]['title'], 'A & B')
        self.assertEqual(a[0]['id'], b[0]['id'])
        self.assertEqual(a[1]['date'], '2026-10-01')

    def test_winter_and_year_rollover(self):
        html = table([('1 Okt', '18:00-21:00', 'A')]).replace('</table>', '<tr><td>Vecka 1, 2027</td></tr><tr><td>5 Jan</td><td>12:00-14:00</td><td>B</td></tr></table>')
        events, _ = parse_schedule(html)
        self.assertTrue(events[0]['start'].endswith('+02:00'))
        self.assertEqual(events[1]['start'], '2027-01-05T12:30:00+01:00')

    def test_broken_source_and_duplicate_fail_closed(self):
        for html in ['<html>Logga in</html>', table([('', '12:00-14:00', 'A')]),
                     table([('1 Okt', '12:00-14:00', 'A'), ('', '12:00-14:00', 'B')])]:
            with self.assertRaises(ValueError):
                parse_schedule(html)


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_db = server.DB
        server.DB = Path(self.temp.name) / 'test.sqlite3'
        server.sync(table([('1 Okt', '12:00-14:00', 'Original')]))
        self.event = server.snapshot()['events'][0]

    def tearDown(self):
        server.DB = self.old_db
        self.temp.cleanup()

    def post(self, path, payload, origin='http://127.0.0.1:4173'):
        body = json.dumps(payload).encode()
        handler = object.__new__(server.Handler)
        handler.path = path
        handler.server = SimpleNamespace(server_port=4173)
        handler.headers = {'Content-Length': str(len(body)), 'Host': '127.0.0.1:4173', 'Origin': origin}
        handler.rfile = io.BytesIO(body)
        result = []
        handler.reply = lambda code, data: result.extend([code, data])
        handler.do_POST()
        return result

    def test_edit_survives_sync_and_reset(self):
        status, _ = self.post('/api/edit', {'id': self.event['id'], 'title': 'Egen titel', 'eventType': 'Föreläsning', 'hidden': False})
        self.assertEqual(status, 200)
        server.sync(table([('1 Okt', '12:00-14:00', 'Ändrad i källan')]))
        state = server.snapshot()
        self.assertEqual(state['events'][0]['title'], 'Ändrad i källan')
        self.assertEqual(state['edits'][self.event['id']]['title'], 'Egen titel')
        self.assertEqual(state['edits'][self.event['id']]['eventType'], 'Föreläsning')
        self.post('/api/edit', {'id': self.event['id'], 'reset': True})
        self.assertEqual(server.snapshot()['edits'], {})

    def test_extra_concert_create_update_hide_and_delete(self):
        values = {'title': 'Söndagskonsert', 'eventType': 'Konferens', 'date': '2026-10-04', 'startTime': '15:45', 'endTime': '17:00', 'description': 'Eget program', 'hidden': False}
        status, data = self.post('/api/manual', values)
        self.assertEqual(status, 200)
        manual = next(e for e in data['events'] if e.get('manual'))
        self.assertEqual(manual['eventType'], 'Konferens')
        self.assertEqual(manual['start'], '2026-10-04T15:45:00+02:00')
        server.sync(table([]))
        self.assertEqual(len(server.snapshot()['events']), 1)
        values.update(id=manual['id'], title='Ändrat program', hidden=True)
        status, data = self.post('/api/manual', values)
        self.assertTrue(data['events'][0]['hidden'])
        self.assertEqual(data['events'][0]['title'], 'Ändrat program')
        self.post('/api/manual', {'id': manual['id'], 'delete': True})
        self.assertEqual(server.snapshot()['events'], [])

    def test_failed_sync_preserves_snapshot(self):
        self.assertFalse(server.sync('<html>Serverfel</html>'))
        self.assertEqual(server.snapshot()['events'][0]['id'], self.event['id'])
        self.assertTrue(server.snapshot()['error'])

    def test_validation_and_cross_origin_write_rejected(self):
        self.assertEqual(self.post('/api/edit', {'id': self.event['id'], 'title': '', 'hidden': False})[0], 400)
        self.assertEqual(self.post('/api/manual', {'title': 'X', 'date': '2026-03-29', 'startTime': '02:30', 'endTime': '04:00', 'hidden': False})[0], 400)
        self.assertEqual(self.post('/api/manual', {'title': 'X', 'date': '2026-10-04', 'startTime': '19:00', 'endTime': '18:00', 'hidden': False})[0], 400)
        self.assertEqual(self.post('/api/edit', {'id': self.event['id'], 'reset': True}, 'https://another.example')[0], 403)


if __name__ == '__main__':
    unittest.main()
