#!/usr/bin/env python3
"""Idempotent, reversible zsh and PowerShell integration for Codex Rail."""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

BEGIN = '# >>> Codex Rail plugin >>>'
END = '# <<< Codex Rail plugin <<<'
BLOCK = re.compile(re.escape(BEGIN) + r'.*?' + re.escape(END) + r'\n?', re.S)

def find_node():
    candidates = [shutil.which('node')]
    candidates += [str(p) for p in sorted((Path.home()/'.nvm/versions/node').glob('*/bin/node'), reverse=True)]
    candidates += ['/opt/homebrew/bin/node', '/usr/local/bin/node']
    for candidate in dict.fromkeys(candidates):
        if not candidate or not Path(candidate).is_file():
            continue
        result = subprocess.run([candidate, '-p', 'process.versions.node.split(".")[0]'], capture_output=True, text=True)
        if result.returncode == 0 and result.stdout.strip().isdigit() and int(result.stdout.strip()) >= 22:
            return str(Path(candidate).resolve())
    raise SystemExit('Node 22 or newer is required.')

def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--install', action='store_true')
    mode.add_argument('--status', action='store_true')
    mode.add_argument('--remove', action='store_true')
    parser.add_argument('--plugin-id', default='codex-rail@blossom-local')
    parser.add_argument('--shell', choices=['zsh', 'powershell'], default='powershell' if os.name == 'nt' else 'zsh')
    parser.add_argument('--profile', help='Exact current-user PowerShell profile path')
    args = parser.parse_args()
    if sys.version_info < (3,11):
        raise SystemExit('Python 3.11 or newer is required for Codex configuration parsing.')
    root = Path(__file__).resolve().parent.parent
    if args.shell == 'powershell':
        from powershell import install
        install(args, root, find_node, backup, BEGIN, END, BLOCK)
        return
    directory = Path(os.environ.get('XDG_CONFIG_HOME', Path.home()/'.config'))/'codex-rail'
    rc = Path(os.environ.get('ZDOTDIR', Path.home()))/'.zshrc'
    source = directory/'integration.zsh'
    settings = directory/'settings.json'
    launchers = directory/'bin'
    text = rc.read_text() if rc.exists() else ''
    if args.status:
        print(json.dumps({'plugin_root':str(root), 'shell_file':str(rc), 'integration':str(source),
                          'launcher':str(launchers/'codex-rail'),
                          'configured':BEGIN in text and source.is_file() and settings.is_file()
                            and (launchers/'codex').is_file() and (launchers/'codex-rail').is_file()}, ensure_ascii=False))
        return
    if args.remove:
        updated = BLOCK.sub('',text)
        if updated != text:
            backup(rc)
            rc.write_text(updated)
        for p in [source, settings]:
            p.unlink(missing_ok=True)
        for p in [launchers/'codex', launchers/'codex-rail']:
            if p.is_file() and not p.is_symlink() and b'# Managed by Codex Rail launcher' in p.read_bytes()[:256]:
                p.unlink()
        directory.mkdir(parents=True, exist_ok=True)
        (directory/'auto-setup.disabled').touch()
        print('Codex Rail shell integration removed. New shells use native codex.')
        return
    from dispatch import native_executable
    from zsh import launcher, integration
    from shlex import quote
    try:
        previous = json.loads(settings.read_text(encoding='utf-8'))
        if not isinstance(previous, dict):
            previous = {}
    except (OSError, ValueError):
        previous = {}
    native = native_executable(previous.get('native'), launchers)
    if not native:
        raise SystemExit('Codex CLI is required.')
    if not shutil.which('tmux'):
        raise SystemExit('tmux is required. Install with brew install tmux, then rerun setup.')
    node = find_node()
    directory.mkdir(parents=True, exist_ok=True)
    launchers.mkdir(mode=0o700, exist_ok=True)
    for name in ['codex', 'codex-rail']:
        target = launchers/name
        if target.is_symlink() or (target.exists() and b'# Managed by Codex Rail launcher' not in target.read_bytes()[:256]):
            raise SystemExit(f'An unrelated launcher already exists at {target}; setup left it unchanged.')
    settings.write_text(json.dumps({'plugin_id':args.plugin_id,'plugin_root':str(root),
                                    'native':native,'node':node,'integration_mode':'path'},indent=2)+'\n')
    settings.chmod(0o600)
    for name in ['codex', 'codex-rail']:
        target = launchers/name
        target.write_text(launcher(sys.executable, root/'scripts/dispatch.py', settings, native, launchers))
        target.chmod(0o700)
    source.write_text(integration(launchers, native))
    block=f'{BEGIN}\n[[ -r {quote(str(source))} ]] && source {quote(str(source))}\n{END}\n'
    updated=BLOCK.sub('',text).rstrip()+'\n\n'+block
    if updated != text:
        if rc.exists():
            backup(rc)
        rc.write_text(updated)
    (directory/'auto-setup.disabled').unlink(missing_ok=True)
    print(json.dumps({'configured':True,'plugin_root':str(root),'node':node,'native':native,
                      'activate_current_shell':f'source {quote(str(source))}'},ensure_ascii=False))

def backup(path):
    timestamp=datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    destination=path.with_name(path.name+'.codex-rail-backup-'+timestamp)
    shutil.copy2(path,destination)
    destination.chmod(0o600)

if __name__ == '__main__':
    main()
