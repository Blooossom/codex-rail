"""Check discovery and trust metadata through the actual Codex app-server API."""
import importlib.util
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
import zipfile


ROOT = Path(__file__).resolve().parent.parent
CODEX = shutil.which('codex')


@unittest.skipUnless(CODEX, 'Codex CLI is required for hook discovery regression coverage')
class PluginHookTests(unittest.TestCase):
    def test_packaged_plugin_hook_is_listed_and_requires_explicit_trust(self):
        command = [CODEX]
        if os.name == 'nt':
            spec = importlib.util.spec_from_file_location('rail_powershell', ROOT/'scripts/powershell.py')
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            command = module.native_command(Path(CODEX), shutil.which('node'))
        version = json.loads((ROOT/'package.json').read_text(encoding='utf-8'))['version']
        subprocess.run([sys.executable, str(ROOT/'scripts/package.py')], check=True, capture_output=True, timeout=30)
        with tempfile.TemporaryDirectory(prefix='rail-discovery-') as temporary:
            base = Path(temporary).resolve()
            with zipfile.ZipFile(ROOT/f'dist/codex-rail-{version}-test.zip') as bundle:
                bundle.extractall(base)
            plugin = base/f'codex-rail-{version}'
            home = base/'codex'
            home.mkdir()
            env = dict(os.environ, CODEX_HOME=str(home))
            for args in [['plugin', 'marketplace', 'add', str(plugin), '--json'],
                         ['plugin', 'add', 'codex-rail@blossom-local', '--json']]:
                subprocess.run([*command, *args], cwd=base, env=env, check=True,
                               capture_output=True, text=True, timeout=30)
            server = subprocess.Popen([*command, 'app-server', '--listen', 'stdio://'],
                                      cwd=base, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                      stderr=subprocess.DEVNULL, text=True, encoding='utf-8')
            messages = queue.Queue()

            def receive():
                for line in server.stdout:
                    messages.put(json.loads(line))

            reader = threading.Thread(target=receive, daemon=True)
            reader.start()

            def send(message):
                server.stdin.write(json.dumps(message)+'\n')
                server.stdin.flush()

            def response(identifier):
                while True:
                    message = messages.get(timeout=30)
                    if message.get('id') == identifier:
                        self.assertNotIn('error', message, message)
                        return message['result']

            try:
                send({'id': 1, 'method': 'initialize', 'params': {
                    'clientInfo': {'name': 'rail_hook_regression', 'version': version},
                    'capabilities': {'experimentalApi': True}}})
                response(1)
                send({'method': 'initialized'})
                send({'id': 2, 'method': 'hooks/list', 'params': {'cwds': [str(base)]}})
                entry = response(2)['data'][0]
                self.assertEqual(entry['errors'], [])
                hooks = [hook for hook in entry['hooks'] if hook.get('pluginId') == 'codex-rail@blossom-local']
                self.assertEqual(len(hooks), 1, entry)
                hook = hooks[0]
                self.assertEqual(hook['eventName'], 'sessionStart')
                self.assertEqual(hook['statusMessage'], 'Codex Rail: automatic shell setup')
                self.assertEqual(hook['source'], 'plugin')
                self.assertEqual(hook['trustStatus'], 'untrusted')
                self.assertTrue(hook['enabled'])
                self.assertFalse(hook['isManaged'])
                self.assertIn('auto-setup.mjs', hook['command'])
            finally:
                server.stdin.close()
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    if os.name == 'nt':
                        subprocess.run([str(Path(os.environ['SystemRoot'])/'System32/taskkill.exe'),
                                        '/PID', str(server.pid), '/T', '/F'], capture_output=True, timeout=5)
                    else:
                        server.kill()
                    server.wait(timeout=5)
                reader.join(timeout=1)
                server.stdout.close()


if __name__ == '__main__':
    unittest.main()
