"""Verify real zsh lookup, user wrappers, and the real tmux/HUD launcher together."""
import contextlib
import json
import os
from pathlib import Path
import select
import shlex
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest

if os.name != 'nt':
    import fcntl
    import pty
    import termios

ROOT = Path(__file__).resolve().parent.parent
SUPPORTED = os.name != 'nt' and shutil.which('zsh') and shutil.which('node') and shutil.which('tmux')


@unittest.skipUnless(SUPPORTED, 'Real zsh, tmux and Node are required')
class ZshSetupTests(unittest.TestCase):
    @contextlib.contextmanager
    def fixture(self, definition='', unusual_path=False):
        with tempfile.TemporaryDirectory(prefix='rail-zsh-') as temporary:
            base = Path(temporary).resolve()
            if unusual_path:
                base = base/"space ' ; 한글"
                base.mkdir()
            bin_path = base/'native-bin'
            bin_path.mkdir()
            shell = base/'shell'
            shell.mkdir()
            # Global /etc/zshrc may prompt before our profile is loaded in CI.
            (shell/'.zshenv').write_text('unsetopt GLOBAL_RCS\n')
            (base/'project').mkdir()
            native = bin_path/'codex'
            native.write_text(f'''#!{sys.executable}
import json, os, sys
from pathlib import Path
args = sys.argv[1:]
if args[:3] == ['app-server', 'daemon', 'start']:
    print('{{}}')
    raise SystemExit
remote = args[args.index('--remote')+1] if '--remote' in args else ''
interactive = remote.startswith('unix://') and '/codex-rail-' in remote
data = {{'args': args, 'cwd': os.getcwd(), 'marker': os.environ.get('RAIL_WRAPPER_MARKER'), 'tmux': os.environ.get('TMUX')}}
if interactive:
    import tty
    tty.setraw(0)
    Path(os.environ['RAIL_CAPTURE']).write_text(json.dumps(data))
    for index in range(150):
        os.write(1, f'Conversation line {{index:03d}}\\r\\n'.encode())
    while True:
        if b'q' in os.read(0, 1024):
            raise SystemExit(23)
else:
    data['stdin'] = sys.stdin.read() if not sys.stdin.isatty() else ''
    print(json.dumps(data))
    raise SystemExit(int(os.environ.get('RAIL_NATIVE_EXIT', '0')))
''')
            native.chmod(0o700)
            definition = definition.replace('@NATIVE@', shlex.quote(str(native))).replace('@PROJECT@', shlex.quote(str(base/'project')))
            profile = shell/'.zshrc'
            original = '# Existing configuration\n'+definition+'\n'
            profile.write_text(original)
            env = dict(os.environ, PATH=str(bin_path)+os.pathsep+os.environ['PATH'],
                       ZDOTDIR=str(shell), XDG_CONFIG_HOME=str(base/'config'), CODEX_HOME=str(base/'codex'),
                       SHELL=shutil.which('zsh'), TERM='xterm-256color', TMUX='', RAIL_CAPTURE=str(base/'capture.json'))
            for name in ['CODEX_RAIL_DISABLE', 'CODEX_RAIL_ACTIVE', 'CODEX_RAIL_AUTO_SETUP_DISABLE']:
                env.pop(name, None)
            context = {'base':base, 'env':env, 'native':native, 'profile':profile, 'original':original,
                       'directory':base/'config/codex-rail'}
            before=self.shell(context,'print -r -- "${aliases[codex]-}"; print -r -- "${functions[codex]-}"')
            self.install(context)
            self.assertTrue(profile.read_text().startswith(original.rstrip()))
            after=self.shell(context,'print -r -- "${aliases[codex]-}"; print -r -- "${functions[codex]-}"')
            self.assertEqual(after.stdout,before.stdout,'Existing alias/function definition changed')
            yield context

    def install(self, context, mode='--install', env=None):
        result = subprocess.run([sys.executable,str(ROOT/'scripts/setup.py'),mode],
                                cwd=context['base'],env=env or context['env'],capture_output=True,text=True,timeout=15)
        self.assertEqual(result.returncode,0,result.stderr)
        return result

    def shell(self, context, code, args=(), input=None, env=None):
        return subprocess.run(['zsh','-i','-c',code,'--',*args],cwd=context['base'],
                              env=env or context['env'],input=input,capture_output=True,text=True,timeout=15)

    def definitions(self):
        return [
            ('plain','',[]),
            ('alias',"alias codex='codex --yolo'",['--yolo']),
            ('alias-command',"alias codex='command codex -m gpt-6-astra'",['-m','gpt-6-astra']),
            ('alias-absolute','alias codex='+shlex.quote('@NATIVE@ --yolo'),['--yolo']),
            ('function','codex() { command codex --yolo "$@"; }',['--yolo']),
            ('function-keyword','function codex { command codex -m gpt-6-sol "$@"; }',['-m','gpt-6-sol']),
            ('function-absolute','codex() { @NATIVE@ --yolo "$@"; }',['--yolo']),
        ]

    def test_aliases_and_functions_keep_exact_arguments_and_native_routing(self):
        tail=['exec','','two words','a"b',"it's",'한글','x; y & z','$(touch NEVER_RUN)','`literal`']
        for name,definition,prefix in self.definitions():
            with self.subTest(name=name), self.fixture(definition) as context:
                result=self.shell(context,'codex "$@"',tail)
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertEqual(json.loads(result.stdout)['args'],prefix+tail)
                self.assertFalse((context['base']/'NEVER_RUN').exists())
                self.assertIn(definition.replace('@NATIVE@',shlex.quote(str(context['native']))),context['profile'].read_text())

    def test_function_environment_working_directory_exit_status_and_pipeline_are_preserved(self):
        definition='codex() { export RAIL_WRAPPER_MARKER=preserved; cd @PROJECT@; command codex -c \'model="custom"\' "$@"; }'
        with self.fixture(definition) as context:
            env=dict(context['env'],RAIL_NATIVE_EXIT='37')
            result=self.shell(context,'codex exec -',input='한글\nsecond line\n',env=env)
            self.assertEqual(result.returncode,37,result.stderr)
            data=json.loads(result.stdout)
            self.assertEqual(data['args'],['-c','model="custom"','exec','-'])
            self.assertEqual(data['cwd'],str(context['base']/'project'))
            self.assertEqual(data['marker'],'preserved')
            self.assertEqual(data['stdin'],'한글\nsecond line\n')

    def test_paths_quotes_repeated_install_migration_and_removal(self):
        with self.fixture("alias codex='codex --yolo'",unusual_path=True) as context:
            result=self.shell(context,'source "$1"; source "$1"; codex --version',
                              [str(context['directory']/'integration.zsh')])
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(json.loads(result.stdout)['args'],['--yolo','--version'])
            # Reinstall while our launcher is already first on PATH.
            env=dict(context['env'],PATH=str(context['directory']/'bin')+os.pathsep+context['env']['PATH'])
            self.install(context,env=env)
            settings=json.loads((context['directory']/'settings.json').read_text())
            self.assertEqual(settings['native'],str(context['native']))
            self.assertEqual(context['profile'].read_text().count('# >>> Codex Rail plugin >>>'),1)
            self.assertTrue(list(context['profile'].parent.glob('.zshrc.codex-rail-backup-*')))
            self.install(context,'--remove')
            self.assertFalse((context['directory']/'bin/codex').exists())
            result=self.shell(context,'codex --version')
            self.assertEqual(json.loads(result.stdout)['args'],['--yolo','--version'])
            self.assertIn("alias codex='codex --yolo'",context['profile'].read_text())
            self.assertNotIn('# >>> Codex Rail plugin >>>',context['profile'].read_text())

    def test_damaged_settings_or_removed_plugin_fall_back_without_recursion(self):
        with self.fixture() as context:
            settings=context['directory']/'settings.json'
            original=settings.read_text()
            for damaged in ['{invalid','[]']:
                settings.write_text(damaged)
                result=self.shell(context,'codex --version')
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertEqual(json.loads(result.stdout)['args'],['--version'])
            settings.write_text(original)
            settings.unlink()
            result=self.shell(context,'codex --version')
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(json.loads(result.stdout)['args'],['--version'])

    def test_external_function_file_and_old_rail_block_are_migrated(self):
        with self.fixture() as context:
            external=context['base']/'functions.zsh'
            external.write_text('codex() { command codex --yolo "$@"; }\n')
            profile='source '+shlex.quote(str(external))+'\n'
            profile+='# >>> Codex Rail plugin >>>\ncodex() { print OLD_RAIL; }\n# <<< Codex Rail plugin <<<\n'
            context['profile'].write_text(profile)
            self.install(context)
            result=self.shell(context,'codex --version')
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(json.loads(result.stdout)['args'],['--yolo','--version'])
            self.assertNotIn('OLD_RAIL',context['profile'].read_text())
            self.assertEqual(external.read_text(),'codex() { command codex --yolo "$@"; }\n')

    def test_explicit_native_path_bypass_retains_its_original_behavior(self):
        with self.fixture('codex() { command @NATIVE@ --yolo "$@"; }') as context:
            result=self.shell(context,'codex --version')
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(json.loads(result.stdout)['args'],['--yolo','--version'])

    def run_train(self, context, command='codex', args=()):
        master,slave=pty.openpty()
        fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',30,100,0,0))
        child=subprocess.Popen(['zsh','-i','-c',command+' "$@"','--',*args],cwd=context['base'],
                               env=context['env'],stdin=slave,stdout=slave,stderr=slave,start_new_session=True)
        os.close(slave)
        stop=threading.Event()
        output=bytearray()
        def drain():
            while not stop.is_set():
                if select.select([master],[],[],0.05)[0]:
                    try:
                        data=os.read(master,65536)
                        if not data:return
                        output.extend(data)
                    except OSError:return
        reader=threading.Thread(target=drain,daemon=True);reader.start()
        socket=None
        try:
            capture=Path(context['env']['RAIL_CAPTURE'])
            deadline=time.monotonic()+15
            while not capture.exists():
                if child.poll() is not None:self.fail(output.decode(errors='replace')[-4000:])
                self.assertLess(time.monotonic(),deadline,output.decode(errors='replace')[-4000:])
                time.sleep(0.03)
            data=json.loads(capture.read_text())
            socket=data['tmux'].split(',')[0]
            def tm(*args):
                return subprocess.check_output(['tmux','-S',socket,*args],text=True,timeout=5).strip('\n')
            deadline=time.monotonic()+5
            while True:
                panes=tm('list-panes','-F','#{pane_id} #{pane_height}').splitlines()
                if len(panes)==2:
                    hud,height=panes[1].split()
                    screen=tm('capture-pane','-p','-t',hud)
                    if '┌' in screen and '└' in screen:
                        self.assertEqual(height,'6')
                        self.assertIn('─'*20,screen)
                        break
                self.assertLess(time.monotonic(),deadline,output.decode(errors='replace')[-4000:])
                time.sleep(0.03)
            os.write(master,b'q')
            self.assertEqual(child.wait(timeout=10),23,output.decode(errors='replace')[-4000:])
            return data
        finally:
            if socket:subprocess.run(['tmux','-S',socket,'kill-server'],capture_output=True,timeout=5)
            if child.poll() is None:
                os.killpg(child.pid,signal.SIGTERM)
                try:child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid,signal.SIGKILL);child.wait()
            stop.set();reader.join(timeout=1);os.close(master)

    def test_real_train_appears_through_existing_aliases_and_functions(self):
        for name,definition,prefix in self.definitions():
            with self.subTest(name=name), self.fixture(definition) as context:
                data=self.run_train(context,args=['two words','a"b','한글'])
                self.assertEqual(data['args'][-len(prefix+['two words','a"b','한글']):],prefix+['two words','a"b','한글'])

    def test_arbitrary_non_cli_function_is_retained_and_explicit_launcher_still_works(self):
        with self.fixture('codex() { return 19; }') as context:
            self.assertEqual(self.shell(context,'codex --version').returncode,19)
            data=self.run_train(context,command='codex-rail',args=['hello'])
            self.assertEqual(data['args'][-1],'hello')

    def test_yolo_alias_resume_goes_through_the_resume_permission_translation(self):
        with self.fixture("alias codex='codex --yolo'") as context:
            data=self.run_train(context,args=['resume','--last'])
            self.assertEqual(data['args'][-2:],['resume','--last'])
            self.assertNotIn('--yolo',data['args'])


if __name__=='__main__':unittest.main()
