import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const readJSON = path => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };
const read = path => { try { return readFileSync(path, 'utf8'); } catch { return ''; } };
const run = (command, args, env = process.env) => spawnSync(command, args, { env, encoding: 'utf8', windowsHide: true, timeout: 12000 });
const message = text => process.stdout.write(JSON.stringify({ systemMessage: text })+'\n');

function pluginId(settings) {
  if (basename(dirname(dirname(dirname(root)))) === 'cache')
    return `codex-rail@${basename(dirname(dirname(root)))}`;
  return settings?.plugin_id || 'codex-rail@blossom-local';
}

function current(settings, source) {
  try {
    return settings && realpathSync(settings.plugin_root) === realpathSync(root) && existsSync(settings.node)
      && existsSync(settings.native) && existsSync(source);
  } catch { return false; }
}

function python() {
  const candidates = ['python3', 'python3.14', 'python3.13', 'python3.12', 'python3.11',
    '/opt/homebrew/bin/python3', '/usr/local/bin/python3'];
  for (const command of candidates) {
    const result = run(command, ['-c', 'import sys; print(int(sys.version_info >= (3, 11)))']);
    if (result.status === 0 && result.stdout.trim() === '1') return command;
  }
  return null;
}

function zsh(directory, settings) {
  const source = join(directory, 'integration.zsh');
  const profile = join(process.env.ZDOTDIR || homedir(), '.zshrc');
  if (current(settings, source) && settings.integration_mode === 'path'
    && existsSync(join(directory,'bin','codex')) && existsSync(join(directory,'bin','codex-rail'))
    && read(profile).includes('# >>> Codex Rail plugin >>>')) return;
  if (basename(process.env.SHELL || '') !== 'zsh') {
    message('Codex Rail: automatic setup supports zsh and Windows PowerShell. Run the setup skill for this shell.');
    return;
  }
  const executable = python();
  if (!executable) { message('Codex Rail: install Python 3.11 or newer, then start a new Codex session.'); return; }
  const result = run(executable, [join(root, 'scripts', 'setup.py'), '--install', '--plugin-id', pluginId(settings)]);
  if (result.status === 0) message('Codex Rail shell integration installed. Open a new terminal tab and run codex. The codex-rail command is also available for custom wrappers.');
  else message(`Codex Rail automatic setup needs attention: ${(result.stderr || result.stdout || 'Run the setup skill.').trim().slice(0,400)}`);
}

function windows(directory, settings) {
  const stale = !current(settings, join(directory, 'integration.ps1'));
  const candidates = [join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), 'pwsh.exe'];
  const script = `$ErrorActionPreference='Stop'; $s=Join-Path $env:PLUGIN_ROOT 'scripts\\setup.ps1'; `+
    `$r=& $s -Status -ProfilePath $PROFILE.CurrentUserCurrentHost | ConvertFrom-Json; `+
    `if ($${stale ? 'true' : 'false'} -or -not $r.configured) { & $s -Install -ProfilePath $PROFILE.CurrentUserCurrentHost -PluginId '${pluginId(settings).replaceAll("'", "''")}' }`;
  let installed = false, failed = false;
  for (const executable of candidates) {
    const result = run(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { ...process.env, PLUGIN_ROOT: root });
    if (result.error?.code === 'ENOENT') continue;
    if (result.status !== 0) failed = true;
    else if (result.stdout.trim()) installed = true;
  }
  if (installed && failed) message('Codex Rail integration installed for an available PowerShell edition; another edition needs the setup skill. Open a new configured PowerShell tab. Execution policy is unchanged.');
  else if (installed) message('Codex Rail PowerShell integration installed. Open a new PowerShell tab and run codex.');
  else if (failed) message('Codex Rail: automatic PowerShell setup could not finish. Run its setup skill; execution policy is unchanged.');
}

export function main() {
  if (process.env.CODEX_RAIL_AUTO_SETUP_DISABLE === '1' || process.env.CODEX_RAIL_DISABLE === '1') return;
  const directory = process.platform === 'win32'
    ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'codex-rail')
    : join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'codex-rail');
  const lock = join(directory, 'auto-setup.lock');
  if (existsSync(join(directory, 'auto-setup.disabled'))) return;
  let locked = false;
  try {
    mkdirSync(directory, { recursive: true });
    if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > 60000) rmSync(lock, { recursive: true, force: true });
    try { mkdirSync(lock); locked = true; } catch (error) { if (error.code === 'EEXIST') return; throw error; }
    const settings = readJSON(join(directory, 'settings.json'));
    if (process.platform === 'win32') windows(directory, settings);
    else zsh(directory, settings);
  } catch {
    message('Codex Rail automatic setup could not finish. Run the setup skill to check the shell integration.');
  } finally {
    if (locked) rmSync(lock, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) main();
