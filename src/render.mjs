const COLORS = { text: [229,233,240], muted: [139,150,169], scenery: [100,115,137], mint: [145,215,195], astra: [196,166,247], sol: [243,200,121], yellow: [243,200,121], red: [242,139,156] };

// Keep scenery inside the empty space on either side of the train.
function landscape(put, start, end, mirrored = false) {
  const room = end - start;
  if (room < 7) return;
  const tree = x => ['  ^  ', ' /|\\ ', '/_|_\\'].forEach((line, i) => put(i + 2, x, line, 'scenery'));
  const hill = x => ["         _.._         ", "    _..-'    `-.._    ", "_..'             `-.._"].forEach((line, i) => put(i + 2, x, line, 'scenery'));
  if (room < 34) { tree(start + Math.floor((room - 5) / 2)); return; }
  const treeX = mirrored ? end - 7 : start + 2;
  tree(treeX);
  hill(mirrored ? start + Math.floor((room - 30) / 2) : start + 10 + Math.floor((room - 34) / 2));
  if (room >= 48) tree(mirrored ? end - 14 : start + 9);
  if (mirrored && room >= 42) put(1, end - 12, '+', 'scenery');
}
export function modelIdentity(model) {
  if (/astra/i.test(model || '')) return { label: 'ASTRA', color: 'astra' };
  if (/sol/i.test(model || '')) return { label: 'SOL', color: 'sol' };
  return { label: model ? model.split('-').at(-1).replace(/[^a-zA-Z0-9]/g,'').toUpperCase().slice(0,8)||'CODEX' : '-----', color: 'muted' };
}
export function resetLabel(timestamp, now = Date.now()) {
  if (!Number.isFinite(timestamp)) return 'Reset --';
  const minutes = Math.ceil((timestamp * 1000 - now) / 60000);
  if (minutes <= 0) return 'Reset pending';
  const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60);
  return days ? `Reset ${days}d ${hours}h` : hours ? `Reset ${hours}h ${minutes % 60}m` : `Reset ${minutes}m`;
}
export function renderRail(state, columns, tick = 0, { color = true, now = Date.now(), reducedMotion = false } = {}) {
  const width = Math.max(1, Math.floor(columns));
  const rows = Array.from({length: state.demo?7:6}, () => Array.from({length:width}, () => ({c:' ',color:'text'})));
  const put = (y,x,text,ink='text') => {
    [...text].forEach((c,i) => { if (rows[y] && x+i>=0 && x+i<width) rows[y][x+i]={c,color:ink}; });
  };
  const identity=modelIdentity(state.model);
  const labels={connecting:'Connecting',disconnected:'Disconnected',idle:'Input ready',working:'Working',approval:'Approval needed',waiting:'Input needed',done:'Complete',error:'Error !',compacting:'Compacting'};
  const unknown=n=>!Number.isFinite(n);
  const stale=state.quotaAt && now-state.quotaAt>150000;
  const weekly=unknown(state.weekly)?'--':`${Math.round(100-state.weekly)}%`;
  const context=unknown(state.context)?'--':`${Math.round(state.context)}%`;
  const statusInk=state.status==='error'?'red':['approval','waiting','idle'].includes(state.status)?'yellow':'mint';
  const usage=` ${weekly}${stale?'*':''} `;
  const reset=resetLabel(state.resetsAt,now).replace('Reset','↻');
  if(width<55) {
    put(0,Math.max(0,width-reset.length-1),reset,'muted');
    put(2,1,`${state.fast?'~ ':''}[${identity.label}]--[${'o'.repeat(unknown(state.context)?0:Math.ceil(state.context/10))} ${context}]`,identity.color);
    const edge=Math.floor((width-1)*(unknown(state.weekly)?0:Math.max(0,Math.min(100,state.weekly))/100));
    put(4,0,'─'.repeat(width),'muted');
    if(!unknown(state.weekly))put(4,0,'━'.repeat(edge),'mint');
    put(4,Math.max(0,Math.min(width-usage.length,edge)),usage);
  } else {
    const trainWidth=47, lastX=Math.max(1,width-trainWidth-4);
    const x=1+Math.floor((lastX-1)*(unknown(state.weekly)?0:Math.max(0,Math.min(100,state.weekly))/100));
    const moving=(state.turnActive || state.status==='working')&&!['error','disconnected'].includes(state.status)&&!reducedMotion;
    const wheel=moving?['o','+','x','+'][tick%4]:'o';
    const count=unknown(state.context)?0:Math.ceil(state.context/10);
    const heads=Array.from({length:10},(_,i)=>i<count?'o':'·').join(' ');
    const bodies=Array.from({length:10},(_,i)=>i<count?'|':' ').join(' ');
    landscape(put, 1, x - 3);
    landscape(put, x + trainWidth + 2, width - 5, true);
    if(state.fast) put(0,x+35,(reducedMotion||tick%3===0)?'  . o':tick%3===1?' . O ':'o .  ','muted');
    put(0,width-reset.length-1,reset,'muted');
    const sway=moving&&tick%4===1?1:0;
    put(1,x+sway,'┌'+'─'.repeat(26)+'┐','mint');
    put(1,x+30,'┌──┐  ▄',identity.color);
    put(2,x+sway,`│ ${heads} ${context.padStart(4)} │`,'mint');
    put(2,x+29,'┌┴──┴──────┐',identity.color);
    put(3,x+sway,`│ ${bodies}      │`,'mint');
    const flash=!reducedMotion&&state.modelChangedAt&&now-state.modelChangedAt<800&&tick%2;
    put(3,x+29,`│ ${identity.label.padEnd(8)} │`,flash?'text':identity.color);
    put(4,x+sway,'└─'+wheel+'─'.repeat(21)+wheel+'──┘','mint');
    put(4,x+29,`└─${wheel}─────${wheel}──┘`,identity.color);
    if(state.status==='compacting') {
      put(2,x+19,'╱ │','mint'); put(3,x+19,'  │','mint');
      put(4,Math.min(width-3,x+21+tick%8),'o','mint');
    }
    put(5,0,'─'.repeat(width),'muted');
    if(!unknown(state.weekly)) put(5,0,'━'.repeat(x+trainWidth-5),'mint');
    put(5,Math.max(0,Math.min(width-usage.length,x+trainWidth-5)),usage);
    put(2,width-2,state.status==='error'?'!':'●',statusInk);
    put(3,width-2,'│','muted'); put(4,width-2,'│','muted');
    if(state.status==='done') put(1,width-4,'⚑','mint');
  }
  if(state.demo)put(6,1,'DEMO  1 work 2 wait 3 done 4 error 5 compact · m model · f fast · q quit','muted');
  return rows.map(row=> {
    if(!color) return row.map(v=>v.c).join('');
    let result='',last='';
    for(const cell of row) { if(last!==cell.color){result+=`\x1b[38;2;${COLORS[cell.color].join(';')}m`;last=cell.color;}result+=cell.c; }
    return result+'\x1b[0m';
  });
}
