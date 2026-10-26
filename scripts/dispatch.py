#!/usr/bin/env python3
"""Route interactive shell invocations; never shadow the native executable on PATH."""
import json
import os
from pathlib import Path
import shutil
import sys
import tomllib

VALUE_OPTIONS = {'-c', '--config', '-m', '--model', '-p', '--profile', '-s', '--sandbox',
                 '-a', '--ask-for-approval', '-C', '--cd', '-i', '--image', '--enable',
                 '--disable', '--add-dir', '--local-provider', '--remote-auth-token-env'}
NATIVE_COMMANDS = {'exec', 'e', 'review', 'login', 'logout', 'mcp', 'plugin', 'app-server',
                   'remote-control', 'app', 'completion', 'update', 'doctor', 'sandbox',
                   'debug', 'apply', 'a', 'queue', 'archive', 'delete', 'migrate-rollouts',
                   'migrate-nfs-db', 'unarchive', 'cloud', 'exec-server', 'features', 'help', 'execpolicy'}

def should_wrap(args):
    """Parse only before the prompt; quoted prompt content is never interpreted as flags."""
    index = 0
    while index < len(args):
        arg = args[index]
        if arg == '--':
            return True
        if arg in {'--help', '-h', '--version', '-V', '--remote', '--no-daemon'} or arg.startswith('--remote='):
            return False
        if arg in VALUE_OPTIONS:
            index += 2
            continue
        if arg.startswith('-'):
            index += 1
            continue
        if arg in NATIVE_COMMANDS:
            return False
        if arg in {'resume', 'fork', 'agents'}:
            return not any(a in {'--help', '-h', '--version', '-V', '--remote', '--no-daemon'} or a.startswith('--remote=')
                           for a in args[index + 1:])
        return True
    return True

def plugin_enabled(plugin_id, home=None, cwd=None):
    home = Path(home or os.environ.get('CODEX_HOME', Path.home()/'.codex'))
    config_files = [home/'config.toml']
    current = Path(cwd or Path.cwd()).resolve()
    config_files += [p/'.codex/config.toml' for p in reversed([current, *current.parents])]
    enabled = True
    for path in dict.fromkeys(config_files):
        if not path.is_file():
            continue
        try:
            config = tomllib.loads(path.read_text())
        except (OSError, tomllib.TOMLDecodeError):
            return False
        value = config.get('plugins', {}).get(plugin_id, {}).get('enabled')
        if value is not None:
            enabled = value is True
    return enabled

def main():
    settings_path = Path(sys.argv[1])
    args = sys.argv[2:]
    if args[:1] == ['--']:
        args = args[1:]
    native = shutil.which('codex')
    settings = {}
    try:
        settings = json.loads(settings_path.read_text())
        if Path(settings['native']).is_file():
            native = settings['native']
    except (OSError, ValueError, KeyError):
        pass
    if not native:
        raise SystemExit('Native codex executable was not found.')
    root = Path(settings.get('plugin_root', '/nonexistent'))
    node = settings.get('node', '')
    enabled = (settings and (root/'plugin.json').is_file() and (root/'src/cli.mjs').is_file()
               and Path(node).is_file() and os.isatty(0) and os.isatty(1)
               and os.environ.get('CODEX_RAIL_DISABLE') != '1'
               and os.environ.get('CODEX_RAIL_ACTIVE') != '1'
               and should_wrap(args) and shutil.which('tmux')
               and shutil.get_terminal_size().lines >= 20
               and plugin_enabled(settings['plugin_id']))
    if enabled:
        env = dict(os.environ, CODEX_RAIL_NATIVE_BIN=native)
        os.execve(node, [node, str(root/'src/cli.mjs'), *args], env)
    os.execv(native, [native, *args])

if __name__ == '__main__':
    main()
