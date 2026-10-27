#!/usr/bin/env python3
"""Idempotent, reversible zsh and PowerShell integration for Codex Rail."""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import shlex
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
    text = rc.read_text() if rc.exists() else ''
    if args.status:
        print(json.dumps({'plugin_root':str(root), 'shell_file':str(rc), 'integration':str(source),
                          'configured':BEGIN in text and source.is_file() and settings.is_file()}, ensure_ascii=False))
        return
    if args.remove:
        updated = BLOCK.sub('',text)
        if updated != text:
            backup(rc)
            rc.write_text(updated)
        for p in [source, settings]:
            p.unlink(missing_ok=True)
        print('Codex Rail shell integration removed. New shells use native codex.')
        return
    existing = BLOCK.sub('',text)
    if re.search(r'^\s*(?:alias\s+codex=|(?:function\s+)?codex\s*\()', existing, re.M):
        raise SystemExit('An existing codex alias/function needs to be preserved and reconciled before setup.')
    native = shutil.which('codex')
    if not native:
        raise SystemExit('Codex CLI is required.')
    if not shutil.which('tmux'):
        raise SystemExit('tmux is required. Install with brew install tmux, then rerun setup.')
    node = find_node()
    directory.mkdir(parents=True, exist_ok=True)
    settings.write_text(json.dumps({'plugin_id':args.plugin_id,'plugin_root':str(root),
                                    'native':native,'node':node},indent=2)+'\n')
    settings.chmod(0o600)
    python = shlex.quote(sys.executable)
    dispatcher = shlex.quote(str(root/'scripts/dispatch.py'))
    config = shlex.quote(str(settings))
    source.write_text(f'''# Managed by the Codex Rail plugin. Native executable stays untouched.
function codex() {{
  if [[ ! -t 0 || ! -t 1 || "${{CODEX_RAIL_DISABLE:-0}}" == 1 || ! -f {dispatcher} ]]; then
    command codex "$@"
    return $?
  fi
  {python} {dispatcher} {config} -- "$@"
}}
''')
    block=f'{BEGIN}\n[[ -r {shlex.quote(str(source))} ]] && source {shlex.quote(str(source))}\n{END}\n'
    updated=BLOCK.sub('',text).rstrip()+'\n\n'+block
    if updated != text:
        if rc.exists():
            backup(rc)
        rc.write_text(updated)
    print(json.dumps({'configured':True,'plugin_root':str(root),'node':node,'native':native,
                      'activate_current_shell':f'source {shlex.quote(str(source))}'},ensure_ascii=False))

def backup(path):
    timestamp=datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    destination=path.with_name(path.name+'.codex-rail-backup-'+timestamp)
    shutil.copy2(path,destination)
    destination.chmod(0o600)

if __name__ == '__main__':
    main()
