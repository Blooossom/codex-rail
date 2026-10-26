import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

const configPath=process.argv[2];
const config=JSON.parse(readFileSync(configPath,'utf8'));
// Wait until the launcher has split the HUD and selected this pane.
for(let i=0;!existsSync(config.readyPath);i++) {
  if(i>100)process.exit(1);
  await wait(50);
}
const child=spawn(config.codex,['--remote',`unix://${config.socketPath}`,'-C',config.cwd,...config.args],{stdio:'inherit',cwd:config.cwd,env:{...process.env,CODEX_RAIL_ACTIVE:'1'}});
let finished=false;
const finish=code=>{
  if(finished)return;finished=true;
  writeFileSync(config.exitPath,JSON.stringify({code}),{mode:0o600});
  spawnSync(config.tmux,['-L',config.serverName,'kill-session','-t',config.session],{stdio:'ignore'});
  process.exit(code);
};
child.on('error',error=>{console.error(`Codex could not start: ${error.message}`);finish(1);});
child.on('exit',(code,signal)=>finish(code??(signal?130:1)));
process.on('SIGTERM',()=>child.kill('SIGTERM'));
process.on('SIGHUP',()=>child.kill('SIGHUP'));
