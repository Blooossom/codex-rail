import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const psQuote = value => "'" + value.replaceAll("'", "''") + "'";

export function nativeCommand(native, node = process.execPath) {
  if (/\.(cmd|ps1)$/i.test(native)) {
    const script = join(dirname(native), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (!existsSync(script)) throw new Error('Cannot find the npm Codex entry point. Reinstall Codex or use codex.exe.');
    return [node, script];
  }
  if (!/\.exe$/i.test(native)) throw new Error('A native codex.exe or the official npm installation is required.');
  return [native];
}

export function terminalArguments({ windowName, powershell, node, configPath, statePath, columns, rows }) {
  const encoded = script => Buffer.from(script, 'utf16le').toString('base64');
  const pane = script => [powershell, '-NoLogo', '-NoProfile', '-EncodedCommand', encoded(script)];
  // Prompt text and project paths live in the private config, never in Terminal's command syntax.
  const top = `& ${psQuote(node)} ${psQuote(join(here, 'windows-session.mjs'))} ${psQuote(configPath)}; exit $LASTEXITCODE`;
  const bottom = `& ${psQuote(node)} ${psQuote(join(here, 'hud.mjs'))} ${psQuote(statePath)} --lifetime ${psQuote(configPath)}; exit $LASTEXITCODE`;
  return ['-w', windowName, '--size', `${columns},${rows}`,
    'new-tab', '--title', 'Codex Rail', '--suppressApplicationTitle', ...pane(top),
    ';', 'split-pane', '-H', '--size', String(6 / (rows - 1)), '--title', 'Codex Rail', '--suppressApplicationTitle', ...pane(bottom),
    ';', 'move-focus', 'up'];
}

export function restrictDirectory(directory) {
  const identity = spawnSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
  const sid = identity.stdout?.match(/S-1-(?:\d+-)*\d+/)?.[0];
  if (identity.status !== 0 || !sid) throw new Error('Could not identify the current Windows account.');
  const acl = spawnSync('icacls.exe', [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`],
    { encoding: 'utf8', windowsHide: true });
  if (acl.status !== 0) throw new Error('Could not protect the temporary session directory.');
}

export async function launchWindows(args) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Start Codex Rail in an interactive PowerShell terminal.');
  if (args.some(arg => arg === '--remote' || arg.startsWith('--remote=') || arg === '--no-daemon'))
    throw new Error('Codex Rail owns the local connection; omit --remote and --no-daemon.');
  const native = process.env.CODEX_RAIL_NATIVE_BIN;
  if (!native) throw new Error('Run the PowerShell setup skill before starting Codex Rail.');
  const command = nativeCommand(native);
  const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const directory = mkdtempSync(join(tmpdir(), 'codex-rail-'));
  const configPath = join(directory, 'config.json');
  const config = { command, args, cwd: process.cwd(), statePath: join(directory, 'state.json'),
    readyPath: join(directory, 'ready.json'), exitPath: join(directory, 'exit.json'), shutdownPath: join(directory, 'shutdown') };
  let stopping = false;
  const stop = () => { stopping = true; writeFileSync(config.shutdownPath, '', { mode: 0o600 }); };
  try {
    restrictDirectory(directory);
    writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
    const terminal = spawn('wt.exe', terminalArguments({ windowName: `codex-rail-${randomUUID()}`, powershell,
      node: process.execPath, configPath, statePath: config.statePath,
      columns: Math.max(80, process.stdout.columns || 100), rows: Math.max(30, process.stdout.rows || 30) }), { stdio: 'ignore' });
    let terminalFailed = false;
    terminal.once('exit', code => { terminalFailed = code !== 0; });
    await new Promise((resolve, reject) => {
      terminal.once('error', () => reject(new Error('Windows Terminal (wt.exe) is required. Install it, then rerun setup.')));
      terminal.once('spawn', resolve);
    });
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    const started = Date.now();
    let stopAt = null;
    while (!existsSync(config.exitPath)) {
      if (terminalFailed && !existsSync(config.readyPath)) throw new Error('Windows Terminal could not open the Rail window.');
      if (stopping && !stopAt) stopAt = Date.now();
      if (stopAt && Date.now() - stopAt > 5000) {
        if (existsSync(config.readyPath)) {
          const { pid } = JSON.parse(readFileSync(config.readyPath, 'utf8'));
          spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 5000 });
        }
        process.exitCode = 130;
        return;
      }
      if (!existsSync(config.readyPath) && Date.now() - started > 45000)
        throw new Error('The Rail pane did not start. Check that Node and Windows Terminal can run, then retry.');
      if (existsSync(config.readyPath)) {
        const { pid } = JSON.parse(readFileSync(config.readyPath, 'utf8'));
        try { process.kill(pid, 0); } catch { process.exitCode = stopping ? 130 : 1; return; }
      }
      await wait(200);
    }
    process.exitCode = JSON.parse(readFileSync(config.exitPath, 'utf8')).code;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    rmSync(directory, { recursive: true, force: true });
  }
}
