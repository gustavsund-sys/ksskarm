"""Publish content-versioned assets so a release cannot mix old/new modules."""
import hashlib
import json
import re
import shutil
from pathlib import Path


def build(source, target):
    source, target = Path(source), Path(target)
    files = sorted(p for p in source.rglob('*') if p.is_file())
    code = [p for p in files if p.suffix in ('.html', '.css', '.js', '.mjs')]
    digest = hashlib.sha256()
    for path in code:
        digest.update(str(path.relative_to(source)).encode())
        digest.update(path.read_bytes())
    version = digest.hexdigest()[:16]
    names = {p.name: f'{p.stem}.{version}{p.suffix}' for p in code if p.suffix != '.html'}
    target.mkdir(parents=True, exist_ok=True)
    for path in files:
        relative = path.relative_to(source)
        destination = target / relative.with_name(names.get(path.name, path.name))
        destination.parent.mkdir(parents=True, exist_ok=True)
        if path in code:
            text = path.read_text(encoding='utf-8')
            if path.name == 'index.html':
                text = text.replace('<head>', f'<head>\n  <meta name="app-version" content="{version}">', 1)
            for old, new in names.items():
                text = text.replace('./' + old, './' + new)
            destination.write_text(text, encoding='utf-8')
        else:
            shutil.copyfile(path, destination)
    (target / 'version.json').write_text(json.dumps({'version': version}), encoding='utf-8')
    (target / '.nojekyll').touch()
    return version


if __name__ == '__main__':
    root = Path(__file__).resolve().parent.parent
    print('Webbversion:', build(root / 'public', root / 'dist'))
