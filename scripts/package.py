#!/usr/bin/env python3
"""Build a small, reproducible ZIP for private Codex Rail testing."""
import hashlib
import json
from pathlib import Path
import re
import zipfile


def main():
    root = Path(__file__).resolve().parent.parent
    plugin = json.loads((root / '.codex-plugin/plugin.json').read_text(encoding='utf-8'))
    package = json.loads((root / 'package.json').read_text(encoding='utf-8'))
    lock = json.loads((root / 'package-lock.json').read_text(encoding='utf-8'))
    version = plugin['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?', version):
        raise SystemExit('Invalid plugin version.')
    if any(v != version for v in (package['version'], lock['version'], lock['packages']['']['version'])):
        raise SystemExit('Plugin, package and lockfile versions must match.')
    files = {Path(p) for p in (
        '.codex-plugin/plugin.json', 'package.json', 'package-lock.json', 'README.md',
        '.agents/plugins/marketplace.json', 'skills/setup/SKILL.md',
        'scripts/setup.py', 'scripts/dispatch.py', 'scripts/package.py',
        'vendor/ws/package.json', 'vendor/ws/README.md', 'vendor/ws/LICENSE',
    )}
    for pattern in ('src/*.mjs', 'scripts/*.mjs', 'scripts/*.py', 'scripts/*.ps1', 'hooks/*.json', 'test/*.mjs', 'test/*.ps1', 'test/test_*.py', 'vendor/ws/*.js',
                    'vendor/ws/*.mjs', 'vendor/ws/lib/*.js'):
        files.update(p.relative_to(root) for p in root.glob(pattern))
    for relative in files:
        path = root / relative
        if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(root):
            raise SystemExit(f'Missing or unsafe package file: {relative}')
    output = root / 'dist'
    output.mkdir(exist_ok=True)
    name = f'codex-rail-{version}'
    archive = output / f'{name}-test.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as bundle:
        for relative in sorted(files, key=lambda p: p.as_posix()):
            info = zipfile.ZipInfo(f'{name}/{relative.as_posix()}', date_time=(2026, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            bundle.writestr(info, (root / relative).read_bytes())
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    checksum = archive.with_suffix(archive.suffix + '.sha256')
    checksum.write_text(f'{digest}  {archive.name}\n')
    print(f'{archive}\n{checksum}\n{len(files)} files, {archive.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()
