"""Exercise wheel input through the real launcher, tmux and a pseudo terminal."""
import fcntl
import os
from pathlib import Path
import pty
import select
import shutil
import struct
import subprocess
import sys
import tempfile
import termios
import threading
import time
import unittest


ROOT = Path(__file__).resolve().parent.parent


@unittest.skipUnless(shutil.which('tmux') and shutil.which('node'), 'tmux and Node are required')
class TerminalTests(unittest.TestCase):
    def test_wheel_scrolls_transcript_without_changing_prompt(self):
        with tempfile.TemporaryDirectory(prefix='rail-scroll-') as temporary:
            directory = Path(temporary)
            received = directory/'input'
            ready = directory/'ready'
            fake = directory/'codex'
            fake.write_text(f'''#!{sys.executable}
import os, sys, tty
from pathlib import Path
if sys.argv[1:4] == ['app-server', 'daemon', 'start']:
    print('{{}}')
    raise SystemExit
tty.setraw(0)
for index in range(200):
    os.write(1, f'Conversation line {{index:03d}}\\r\\n'.encode())
os.write(1, b'Current prompt: ')
Path({str(ready)!r}).touch()
with open({str(received)!r}, 'ab', buffering=0) as output:
    while True:
        data = os.read(0, 1024)
        if not data:
            break
        output.write(data)
''')
            fake.chmod(0o700)
            master, slave = pty.openpty()
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 100, 0, 0))
            env = dict(os.environ, TERM='xterm-256color', TMUX='', CODEX_RAIL_NATIVE_BIN=str(fake))
            launcher = subprocess.Popen(['node', str(ROOT/'src/cli.mjs')], cwd=ROOT,
                                        stdin=slave, stdout=slave, stderr=slave, env=env)
            os.close(slave)
            server = f'codex-rail-{launcher.pid}'
            stopped = threading.Event()

            def drain():
                # Keep consuming terminal redraws during shutdown as well as assertions.
                while not stopped.is_set():
                    if select.select([master], [], [], 0.05)[0]:
                        try:
                            if not os.read(master, 65536):
                                return
                        except OSError:
                            return

            reader = threading.Thread(target=drain, daemon=True)
            reader.start()
            try:
                def tm(*args):
                    return subprocess.check_output(['tmux', '-L', server, *args],
                                                   env=env, text=True, stderr=subprocess.DEVNULL,
                                                   timeout=5).strip()

                def wait_for(condition):
                    deadline = time.monotonic() + 10
                    while time.monotonic() < deadline:
                        if launcher.poll() is not None:
                            self.fail(f'Launcher exited with {launcher.returncode}')
                        if condition():
                            return
                        time.sleep(0.02)
                    self.fail('Timed out waiting for terminal state')

                wait_for(lambda: ready.exists())
                wait_for(lambda: bool(tm('list-clients', '-F', '#{client_name}')))
                pane, hud = tm('list-panes', '-F', '#{pane_id}').splitlines()
                wait_for(lambda: int(tm('display-message', '-p', '-t', pane, '#{history_size}')) > 100)
                os.write(master, b'\x1b[<64;10;5M' * 4)
                wait_for(lambda: tm('display-message', '-p', '-t', pane, '#{pane_in_mode}') == '1')
                self.assertGreater(int(tm('display-message', '-p', '-t', pane, '#{scroll_position}')), 0)
                self.assertEqual(tm('display-message', '-p', '-t', hud, '#{pane_in_mode}'), '0')
                self.assertEqual(received.read_bytes() if received.exists() else b'', b'')
                os.write(master, b'\x1b[<65;10;5M' * 30)
                wait_for(lambda: tm('display-message', '-p', '-t', pane, '#{pane_in_mode}') == '0')
                os.write(master, b'hello\x1b[A')
                wait_for(lambda: received.exists() and received.read_bytes().endswith(b'hello\x1b[A'))
                self.assertEqual(received.read_bytes(), b'hello\x1b[A')
            finally:
                if launcher.poll() is None:
                    launcher.terminate()
                    try:
                        launcher.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        launcher.kill()
                        launcher.wait()
                try:
                    subprocess.run(['tmux', '-L', server, 'kill-server'], capture_output=True, timeout=5)
                finally:
                    stopped.set()
                    reader.join(timeout=1)
                os.close(master)


if __name__ == '__main__':
    unittest.main()
