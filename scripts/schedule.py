"""Read Örebro's public HTML timetable without third-party dependencies."""
import json
import re
from datetime import datetime
from html.parser import HTMLParser
from zoneinfo import ZoneInfo

SOURCE_URL = ('https://schema.oru.se/setup/jsp/Schema.jsp?startDatum=idag'
              '&intervallTyp=m&intervallAntal=6&sokMedAND=false&sprak=SV'
              '&resurser=l.Konsertsal-Konsert%2C')
TZ = ZoneInfo('Europe/Stockholm')
MONTHS = {name: index + 1 for index, name in enumerate(
    ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'])}
RULES = {'16:00-21:00': ('evening', '19:00'), '18:00-21:00': ('evening', '19:00'),
         '12:00-14:00': ('lunch', '12:30')}


class TableParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.rows = []
        self.row = None
        self.cell = None
        self.found = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'table':
            if self.depth:
                self.depth += 1
            elif 'schemaTabell' in attrs.get('class', '').split():
                self.depth = 1
                self.found = True
        if self.depth == 1:
            if tag == 'tr':
                self.row = []
            elif tag in ('td', 'th'):
                self.cell = []
            elif tag == 'br' and self.cell is not None:
                self.cell.append('\n')

    def handle_endtag(self, tag):
        if self.depth == 1:
            if tag in ('td', 'th') and self.cell is not None:
                if self.row is not None:
                    self.row.append(' '.join(''.join(self.cell).split()))
                self.cell = None
            elif tag == 'tr' and self.row is not None:
                self.rows.append(self.row)
                self.row = None
        if tag == 'table' and self.depth:
            self.depth -= 1

    def handle_data(self, data):
        if self.depth and self.cell is not None:
            self.cell.append(data)


def parse_schedule(html):
    parser = TableParser()
    parser.feed(html)
    if not parser.found:
        raise ValueError('Schematabellen saknas; behåller föregående schema.')
    headers = next((r for r in parser.rows if 'Moment' in r and 'Start-Slut' in r), None)
    if not headers or 'Datum' not in headers:
        raise ValueError('Schemat har ändrat format; behåller föregående schema.')
    columns = {name: headers.index(name) for name in ('Moment', 'Start-Slut', 'Datum')}
    year = None
    date = None
    events, excluded, seen = [], [], set()
    for row in parser.rows:
        week = re.fullmatch(r'Vecka (\d+), (\d{4})', ' '.join(row))
        if week:
            year = int(week[2])
            date = None
            continue
        if len(row) != len(headers):
            continue
        interval = re.sub(r'\s+', '', row[columns['Start-Slut']]).replace('–', '-')
        if interval == 'Start-Slut':
            continue
        if not re.fullmatch(r'\d{2}:\d{2}-\d{2}:\d{2}', interval):
            raise ValueError('Okänt tidsformat i schemat.')
        date_text = row[columns['Datum']]
        if date_text:
            match = re.fullmatch(r'(\d{1,2}) ([A-Za-zåäöÅÄÖ]+)', date_text)
            if not match or year is None or match[2].lower()[:3] not in MONTHS:
                raise ValueError('Okänt datumformat i schemat.')
            date = datetime(year, MONTHS[match[2].lower()[:3]], int(match[1])).date().isoformat()
        if not date:
            raise ValueError('Bokningen saknar datum.')
        title = row[columns['Moment']]
        if interval not in RULES:
            excluded.append({'date': date, 'interval': interval, 'title': title})
            continue
        kind, start = RULES[interval]
        # The public table exposes no booking ID. Date + room + slot survives title edits.
        event_id = f'konsertsal:{date}:{interval}'
        if event_id in seen:
            raise ValueError('Flera bokningar i samma tidsintervall; kräver manuell kontroll.')
        seen.add(event_id)
        stamp = lambda clock: datetime.fromisoformat(f'{date}T{clock}').replace(tzinfo=TZ).isoformat()
        events.append({'id': event_id, 'date': date, 'title': title or 'Konsert',
                       'kind': kind, 'bookingInterval': interval, 'start': stamp(start),
                       'end': stamp(interval.split('-')[1])})
    return sorted(events, key=lambda e: e['start']), excluded


if __name__ == '__main__':
    import sys
    from pathlib import Path
    events, excluded = parse_schedule(Path(sys.argv[1]).read_text(encoding='utf-8'))
    print(json.dumps({'events': events, 'excluded': excluded}, ensure_ascii=False, indent=2))
