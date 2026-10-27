import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { createBridge } from './bridge.mjs';
import { prepareLaunch } from './launch-options.mjs';

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const options = prepareLaunch(config.args);
const token = randomBytes(32).toString('hex');
let bridge, child, poll, finished = false;
function stopChild(processChild) {
  if (!processChild?.pid || processChild.exitCode !== null || processChild.signalCode !== null) return;
  if (process.platform === 'win32') {
    // npm's entry point owns a Rust executable; terminate the complete owned tree.
    const taskkill = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
    spawnSync(taskkill, ['/PID', String(processChild.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 5000 });
  } else processChild.kill();
}
const finish = async code => {
  if (finished) return;
  finished = true;
  clearInterval(poll);
  stopChild(child);
  await bridge?.close();
  writeFileSync(config.exitPath, JSON.stringify({ code }), { mode: 0o600 });
  process.exitCode = code;
};
try {
  bridge = await createBridge({ statePath: config.statePath, bearerToken: token,
    resumePermissions: options.resumePermissions,
    upstreamFactory: () => {
      const backend = spawn(config.command[0], [...config.command.slice(1), 'app-server', '--listen', 'stdio://'],
        { cwd: config.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      if (process.platform === 'win32') backend.kill = () => { stopChild(backend); return true; };
      return backend;
    } });
  child = spawn(config.command[0], [...config.command.slice(1), '--remote', bridge.endpoint,
    '--remote-auth-token-env', 'CODEX_RAIL_BRIDGE_TOKEN', '-C', config.cwd, ...options.args],
    { cwd: config.cwd, stdio: 'inherit', env: { ...process.env, CODEX_RAIL_ACTIVE: '1', CODEX_RAIL_BRIDGE_TOKEN: token } });
  child.once('error', () => { console.error('Codex could not start. Check the native Codex installation.'); void finish(1); });
  child.once('exit', (code, signal) => { void finish(code ?? (signal ? 130 : 1)); });
  writeFileSync(config.readyPath, JSON.stringify({ pid: process.pid }), { mode: 0o600 });
  poll = setInterval(() => { if (existsSync(config.shutdownPath)) void finish(130); }, 200);
  // Ctrl+C belongs to the official TUI; closing the pane requests wrapper cleanup.
  process.on('SIGINT', () => {});
  process.once('SIGTERM', () => { void finish(130); });
  process.once('SIGHUP', () => { void finish(130); });
} catch {
  console.error('Codex Rail could not start its local Windows session.');
  await finish(1);
}
