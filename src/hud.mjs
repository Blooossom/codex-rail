import { existsSync, readFileSync } from 'node:fs';
import { initialState } from './state.mjs';
import { renderRail } from './render.mjs';

const demo=process.argv.includes('--demo');
const statePath=process.argv[2];
const lifetimeIndex=process.argv.indexOf('--lifetime');
const lifetimePath=lifetimeIndex < 0 ? null : process.argv[lifetimeIndex+1];
let state=demo?{...initialState(),connected:true,demo:true,model:'gpt-6-astra',context:60,weekly:22,fast:true,status:'working',resetsAt:Date.now()/1000+52*3600,quotaAt:Date.now()}:initialState();
let tick=0,previous=[],compactTimer;
const reducedMotion=process.env.CODEX_RAIL_REDUCED_MOTION==='1';
const draw=()=>{
  if(lifetimePath&&!existsSync(lifetimePath)){finish();return;}
  if(!demo) {
    try { state=JSON.parse(readFileSync(statePath,'utf8')); } catch { /* Atomic state may not exist during startup. */ }
  }
  const lines=renderRail(state,Math.max(1,(process.stdout.columns||80)-1),tick++,{reducedMotion,color:!process.env.NO_COLOR});
  let output='';
  lines.forEach((line,i)=>{if(line!==previous[i])output+=`\x1b[${i+1};1H\x1b[2K${line}`;});
  if(output) process.stdout.write(output);
  previous=lines;
};
const finish=()=>{
  clearInterval(timer);clearTimeout(compactTimer);
  process.stdout.write('\x1b[0m\x1b[?25h'+(demo?'\x1b[?1049l':''));
  if(demo&&process.stdin.isTTY) process.stdin.setRawMode(false);
  process.exit(0);
};
if(!process.stdout.isTTY){console.error('Run the train in an interactive terminal.');process.exit(1);}
process.stdout.write((demo?'\x1b[?1049h':'')+'\x1b[?25l\x1b[2J');
const timer=setInterval(draw,reducedMotion?1000:220);
process.stdout.on('resize',()=>{previous=[];draw();});
process.on('SIGTERM',finish);process.on('SIGINT',finish);process.on('SIGHUP',finish);
if(demo&&process.stdin.isTTY){
  process.stdin.setRawMode(true);process.stdin.resume();
  process.stdin.on('data',bytes=>{
    for(const key of bytes.toString()) {
    if(key==='q'||key==='\x03'||key==='\x04')return finish();
    if(key!=='f'&&key!=='m')clearTimeout(compactTimer);
    switch(key){
      case '1':state.status='working';state.context=Math.min(100,state.context+10);state.weekly=Math.min(100,state.weekly+2);break;
      case '2':state.status='approval';break;
      case '3':state.status='done';break;
      case '4':state.status='error';break;
      case '5':state.status='compacting';compactTimer=setTimeout(()=>{state.context=20;state.status='idle';draw();},1800);break;
      case 'm':state.model=state.model==='gpt-6-astra'?'gpt-6.1-sol':'gpt-6-astra';state.modelChangedAt=Date.now();break;
      case 'f':state.fast=!state.fast;break;
    }
    }
    draw();
  });
}
draw();
