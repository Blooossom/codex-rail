#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBridge } from './bridge.mjs';
import { prepareLaunch } from './launch-options.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2);
if(args.includes('--help')||args.includes('-h')) {
  console.log(`Codex Rail — animated train under the official Codex CLI

Usage: codex-rail [Codex CLI options]
       codex-rail --demo

Examples:
  codex-rail
  codex-rail -m gpt-6-astra
  codex-rail resume --last

ASTRA = violet · SOL = amber · passengers = context · route = weekly quota
Steam = Fast mode · wheels/signal/flag = work/approval/completion

Requires Node 22+ and Codex CLI with app-server support.
macOS/Linux: tmux. Windows: Windows Terminal and PowerShell setup.
Exit Codex normally to close the train. On tmux, Ctrl+B then D also closes this wrapper session.
CODEX_RAIL_REDUCED_MOTION=1 disables motion. NO_COLOR=1 disables colors.`);
  process.exit(0);
}
if(args[0]==='--demo') {
  const child=spawn(process.execPath,[join(here,'hud.mjs'),'--demo'],{stdio:'inherit'});
  child.on('exit',code=>process.exit(code??1));
} else {
  if (process.platform === 'win32') {
    const { launchWindows } = await import('./windows.mjs');
    await launchWindows(args);
  } else await launch();
}

async function launch(){
  if(!process.stdin.isTTY||!process.stdout.isTTY)throw new Error('Start codex-rail in an interactive terminal.');
  if((process.stdout.rows||24)<20)throw new Error('Make the terminal at least 20 rows tall for Codex and its train.');
  if(args.some(a=>a==='--remote'||a.startsWith('--remote=')||a==='--no-daemon'))throw new Error('Codex Rail owns the local connection; omit --remote and --no-daemon.');
  if(args[0]&&['exec','login','logout','app-server','update','plugin','mcp','doctor','debug'].includes(args[0]))throw new Error('Use plain codex for non-interactive commands. Codex Rail wraps interactive sessions.');
  const locate=name=>{
    const result=spawnSync('/usr/bin/which',[name],{encoding:'utf8'});
    if(result.status!==0)throw new Error(`${name} is required.${name==='tmux'?' Install it with brew install tmux.':''}`);
    return result.stdout.trim();
  };
  const codex=process.env.CODEX_RAIL_NATIVE_BIN||locate('codex'),tmux=locate('tmux');
  const daemon=spawnSync(codex,['app-server','daemon','start'],{encoding:'utf8',timeout:20000});
  if(daemon.status!==0)throw new Error('Could not start/connect to Codex app-server. Try codex app-server daemon start.');
  // macOS Unix socket paths have a short limit. /tmp is used for ephemeral, private IPC only.
  const runDir=mkdtempSync(join(process.platform==='darwin'?'/tmp':tmpdir(),'codex-rail-'));
  chmodSync(runDir,0o700);
  const socketPath=join(runDir,'rpc.sock'),statePath=join(runDir,'state.json');
  const session=`rail-${process.pid}`,serverName=`codex-rail-${process.pid}`;
  const launchOptions=prepareLaunch(args);
  const config={codex,tmux,args:launchOptions.args,cwd:process.cwd(),socketPath,statePath,session,serverName,
    readyPath:join(runDir,'ready'),exitPath:join(runDir,'exit.json')};
  const configPath=join(runDir,'config.json');
  writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
  let daemonSocket;
  try { daemonSocket=JSON.parse(daemon.stdout).socketPath; } catch { /* Fall back to the documented default location. */ }
  const bridge=await createBridge({socketPath,statePath,daemonSocket,resumePermissions:launchOptions.resumePermissions});
  const tm=(...command)=>{
    const result=spawnSync(tmux,['-L',serverName,...command],{encoding:'utf8',env:{...process.env,TMUX:''}});
    if(result.status!==0)throw new Error(result.stderr.trim()||`tmux ${command[0]} failed`);
    return result.stdout.trim();
  };
  const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
  let cleaned=false;
  const cleanup=async()=>{
    if(cleaned)return;cleaned=true;
    spawnSync(tmux,['-L',serverName,'kill-server'],{stdio:'ignore'});
    await bridge.close();
    rmSync(runDir,{recursive:true,force:true});
  };
  const stop=()=>{cleanup().finally(()=>process.exit(130));};
  process.once('SIGTERM',stop);process.once('SIGHUP',stop);
  try {
    const pane=tm('-f','/dev/null','new-session','-d','-P','-F','#{pane_id}','-s',session,
      '-x',String(process.stdout.columns||100),'-y',String(process.stdout.rows||30),'-c',process.cwd(),
      `${quote(process.execPath)} ${quote(join(here,'session.mjs'))} ${quote(configPath)}`);
    tm('set-option','-t',session,'status','off');
    // Let tmux scroll the transcript instead of the terminal turning wheel input into arrow keys.
    tm('set-option','-t',session,'mouse','on');
    tm('set-option','-t',session,'destroy-unattached','off');
    tm('set-option','-t',session,'pane-border-style','fg=colour238');
    tm('set-option','-t',session,'pane-active-border-style','fg=colour238');
    const hudPane=tm('split-window','-v','-l','6','-P','-F','#{pane_id}','-t',pane,
      `${quote(process.execPath)} ${quote(join(here,'hud.mjs'))} ${quote(statePath)}`);
    tm('set-hook','-t',session,'client-resized',`resize-pane -t ${hudPane} -y 6`);
    tm('set-hook','-t',session,'client-attached',`resize-pane -t ${hudPane} -y 6`);
    tm('select-pane','-t',pane);
    writeFileSync(config.readyPath,'ready',{mode:0o600});
    const attach=spawn(tmux,['-L',serverName,'attach-session','-t',session],{stdio:'inherit',env:{...process.env,TMUX:''}});
    const attachCode=await new Promise((resolve,reject)=>{attach.on('error',reject);attach.on('exit',resolve);});
    let code=attachCode??1;
    if(existsSync(config.exitPath))code=JSON.parse(readFileSync(config.exitPath,'utf8')).code;
    await cleanup();process.exitCode=code;
  } catch(error){await cleanup();throw error;}
}
