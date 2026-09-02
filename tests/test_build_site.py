import tempfile
import unittest
from pathlib import Path
from scripts.build_site import build


class BuildTests(unittest.TestCase):
    def test_versions_change_together_and_schema_stays_at_stable_url(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'public'
            source.mkdir()
            (source / 'index.html').write_text('<script src="./app.js"></script>')
            (source / 'app.js').write_text("import('./store.mjs'); fetch('./schedule.json');")
            (source / 'store.mjs').write_text('export const type = "Konsert";')
            (source / 'schedule.json').write_text('{}')
            first = build(source, root / 'first')
            self.assertIn(f'./app.{first}.js', (root / 'first/index.html').read_text())
            script = (root / f'first/app.{first}.js').read_text()
            self.assertIn(f'./store.{first}.mjs', script)
            self.assertIn('./schedule.json', script)
            (source / 'schedule.json').write_text('{"updated":true}')
            self.assertEqual(first, build(source, root / 'same'))
            (source / 'store.mjs').write_text('export const type = "Konferens";')
            self.assertNotEqual(first, build(source, root / 'changed'))
