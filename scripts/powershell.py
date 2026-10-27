"""Generate a PowerShell integration without passing user arguments through shell code."""
import json
import locale
from pathlib import Path


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def read_profile(path):
    if not path.exists():
        return ''
    data = path.read_bytes()
    if data.startswith((b'\xff\xfe', b'\xfe\xff')):
        return data.decode('utf-16')
    try:
        return data.decode('utf-8-sig')
    except UnicodeDecodeError:
        return data.decode(locale.getencoding())


def native_command(native, node):
    if native.suffix.lower() in {'.cmd', '.ps1'}:
        script = native.parent/'node_modules/@openai/codex/bin/codex.js'
        if not script.is_file():
            raise SystemExit('Cannot find the official npm Codex entry point. Reinstall Codex or use codex.exe.')
        return [node, str(script)]
    if native.suffix.lower() != '.exe':
        raise SystemExit('Native Windows requires codex.exe or the official npm installation.')
    return [str(native)]


def integration(python, dispatcher, settings):
    # Base64 JSON avoids PowerShell 5.1's lossy native argv quoting rules.
    invocation = f'& {quote(python)} {quote(dispatcher)} {quote(settings)} --encoded-args $railEncoded'
    return f'''# Managed by the Codex Rail plugin. Native executable stays untouched.
function global:codex {{
    $railArguments = @($args)
    $railJson = ConvertTo-Json -InputObject $railArguments -Compress -Depth 4
    $railEncoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($railJson))
    if ($MyInvocation.ExpectingInput) {{
        $input | {invocation}
    }} else {{
        {invocation}
    }}
}}
'''


def install(args, root, find_node, backup, begin, end, block):
    import os
    import re
    import shutil
    import sys

    if not args.profile:
        raise SystemExit('Use scripts/setup.ps1 from the target PowerShell to select its actual $PROFILE.')
    rc = Path(args.profile).expanduser().resolve()
    directory = Path(os.environ.get('APPDATA', Path.home()/'AppData/Roaming'))/'codex-rail'
    source = directory/'integration.ps1'
    settings = directory/'settings.json'
    text = read_profile(rc)
    if args.status:
        print(json.dumps({'plugin_root': str(root), 'shell_file': str(rc), 'integration': str(source),
                          'configured': begin in text and source.is_file() and settings.is_file()}))
        return
    if args.remove:
        updated = block.sub('', text)
        if updated != text:
            backup(rc)
            rc.write_text(updated, encoding='utf-8-sig')
        for path in [source, settings]:
            path.unlink(missing_ok=True)
        directory.mkdir(parents=True, exist_ok=True)
        (directory/'auto-setup.disabled').touch()
        print('Codex Rail PowerShell integration removed. Open a new PowerShell tab.')
        return
    existing = block.sub('', text)
    if re.search(r'(?im)^\s*(?:function\s+(?:global:)?codex\b|(?:Set|New)-Alias\s+(?:-Name\s+)?codex\b)', existing):
        raise SystemExit('An existing codex alias/function needs to be preserved and reconciled before setup.')
    native = shutil.which('codex')
    if not native:
        raise SystemExit('Codex CLI is required.')
    if not shutil.which('wt.exe'):
        raise SystemExit('Windows Terminal (wt.exe) is required. Install it from Microsoft Store, then retry.')
    node = find_node()
    command = native_command(Path(native), node)
    directory.mkdir(parents=True, exist_ok=True)
    settings.write_text(json.dumps({'plugin_id': args.plugin_id, 'plugin_root': str(root),
        'native': native, 'native_command': command, 'node': node}, indent=2)+'\n', encoding='utf-8')
    source.write_text(integration(sys.executable, root/'scripts/dispatch.py', settings), encoding='utf-8-sig')
    owned = f'{begin}\nif (Test-Path -LiteralPath {quote(source)}) {{ . {quote(source)} }}\n{end}\n'
    updated = block.sub('', text).rstrip()+'\n\n'+owned
    if updated != text:
        if rc.exists():
            backup(rc)
        rc.parent.mkdir(parents=True, exist_ok=True)
        rc.write_text(updated, encoding='utf-8-sig')
    (directory/'auto-setup.disabled').unlink(missing_ok=True)
    print(json.dumps({'configured': True, 'plugin_root': str(root), 'node': node, 'native': native,
                      'shell_file': str(rc), 'activate_current_shell': f'. {quote(source)}'}))
