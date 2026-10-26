import test from 'node:test';
import assert from 'node:assert/strict';
import { RailState, quotaWindow } from '../src/state.mjs';
import { renderRail, resetLabel } from '../src/render.mjs';

const weekly = {usedPercent:22,windowDurationMins:10080,resetsAt:1800000000};
function connected(){
  const rail=new RailState();
  rail.client({id:1,method:'thread/start',params:{}});
  rail.server({id:1,result:{thread:{id:'main',status:{type:'idle'}},model:'gpt-6-astra',serviceTier:'fast'}});
  return rail;
}
const notify=(rail,method,params={})=>rail.server({method,params:{threadId:'main',...params}});

test('weekly window is selected by duration, never by primary/secondary position',()=>{
  assert.equal(quotaWindow({rateLimits:{primary:weekly}},null).weekly,22);
  assert.equal(quotaWindow({rateLimits:{primary:{...weekly,windowDurationMins:300},secondary:weekly}},null).weekly,22);
  assert.equal(quotaWindow({rateLimits:{primary:{...weekly,windowDurationMins:300}}},null).weekly,null);
  assert.equal(quotaWindow({rateLimitsByLimitId:{model:{normalModelSlug:'gpt-6-astra',primary:{...weekly,usedPercent:44}},codex:{primary:weekly}}},'gpt-6-astra').weekly,44);
});
test('context uses last model usage, never cumulative thread usage; unknown stays unknown',()=>{
  const rail=connected();
  notify(rail,'thread/tokenUsage/updated',{tokenUsage:{modelContextWindow:100000,last:{totalTokens:60000},total:{totalTokens:950000}}});
  assert.equal(rail.value.context,60);
  notify(rail,'thread/tokenUsage/updated',{threadId:'subagent',tokenUsage:{modelContextWindow:100000,last:{totalTokens:1000}}});
  assert.equal(rail.value.context,60);
  notify(rail,'thread/tokenUsage/updated',{tokenUsage:{modelContextWindow:null,last:{totalTokens:60000}}});
  assert.equal(rail.value.context,null);
});
test('model and fast mode follow confirmed settings, not an unconfirmed request',()=>{
  const rail=connected();assert.equal(rail.value.fast,true);
  rail.client({id:2,method:'thread/settings/update',params:{threadId:'main',model:'gpt-6.1-sol',serviceTier:null}});
  assert.equal(rail.value.model,'gpt-6-astra');
  rail.server({id:2,result:{}});
  assert.equal(rail.value.model,'gpt-6.1-sol');assert.equal(rail.value.fast,false);
  rail.client({id:3,method:'thread/settings/update',params:{threadId:'main',model:'wrong-model'}});
  rail.server({id:3,error:{message:'Unavailable'}});
  assert.equal(rail.value.model,'gpt-6.1-sol');
});
test('title generation cannot steal the displayed model, context or approval state',()=>{
  for (const responseSource of ['thread_title', undefined]) {
    const rail=connected();
    notify(rail,'thread/tokenUsage/updated',{tokenUsage:{modelContextWindow:100000,last:{totalTokens:30000}}});
    rail.server({id:44,method:'item/commandExecution/requestApproval',params:{threadId:'main'}});
    rail.client({id:2,method:'thread/start',params:{threadSource:'thread_title',ephemeral:true,model:'gpt-5.6-luna'}});
    rail.server({id:2,result:{thread:{id:'title',ephemeral:true,threadSource:responseSource,status:{type:'idle'}},model:'gpt-5.6-luna'}});
    notify(rail,'turn/started',{threadId:'title'});
    notify(rail,'thread/tokenUsage/updated',{threadId:'title',tokenUsage:{modelContextWindow:100000,last:{totalTokens:3000}}});
    notify(rail,'turn/completed',{threadId:'title',turn:{status:'completed'}});
    assert.equal(rail.value.threadId,'main');
    assert.equal(rail.value.model,'gpt-6-astra');
    assert.equal(rail.value.context,30);
    assert.equal(rail.value.status,'approval');
    assert(rail.approvals.has(44));
    rail.client({id:3,method:'thread/settings/update',params:{threadId:'main',model:'gpt-6.1-sol'}});
    rail.server({id:3,result:{}});
    notify(rail,'thread/settings/updated',{threadSettings:{model:'gpt-6.1-sol'}});
    notify(rail,'thread/tokenUsage/updated',{tokenUsage:{modelContextWindow:100000,last:{totalTokens:42000}}});
    assert.equal(rail.value.model,'gpt-6.1-sol');
    assert.equal(rail.value.context,42);
  }
});
test('background responses arriving late do not override a newly selected user thread',()=>{
  const rail=connected();
  rail.client({id:2,method:'thread/start',params:{threadSource:'thread_title'}});
  rail.client({id:3,method:'thread/resume',params:{threadId:'next'}});
  rail.server({id:3,result:{thread:{id:'next',threadSource:'user'},model:'gpt-6.1-sol'}});
  rail.server({id:2,result:{thread:{id:'title',threadSource:'thread_title'},model:'gpt-5.6-luna'}});
  assert.equal(rail.value.threadId,'next');assert.equal(rail.value.model,'gpt-6.1-sol');
  assert.equal(rail.value.context,null);
});
test('an ephemeral user thread remains a valid display target',()=>{
  const rail=new RailState();
  rail.client({id:1,method:'thread/start',params:{threadSource:'user',ephemeral:true}});
  rail.server({id:1,result:{thread:{id:'private',threadSource:'user',ephemeral:true},model:'gpt-6-astra'}});
  assert.equal(rail.value.threadId,'private');assert.equal(rail.value.model,'gpt-6-astra');
});
test('work, approval, compaction, completion and errors preserve the main thread state',()=>{
  const rail=connected();notify(rail,'turn/started');assert.equal(rail.value.status,'working');
  rail.server({id:44,method:'item/commandExecution/requestApproval',params:{threadId:'main'}});
  assert.equal(rail.value.status,'approval');
  notify(rail,'serverRequest/resolved',{requestId:44});assert.equal(rail.value.status,'working');
  notify(rail,'item/started',{item:{type:'contextCompaction'}});assert.equal(rail.value.status,'compacting');
  notify(rail,'item/completed',{item:{type:'contextCompaction'}});assert.equal(rail.value.status,'working');
  notify(rail,'turn/completed',{turn:{status:'completed'}});assert.equal(rail.value.status,'done');
  notify(rail,'thread/status/changed',{status:{type:'idle'}});assert.equal(rail.value.status,'done');
  notify(rail,'turn/completed',{threadId:'another',turn:{status:'failed'}});assert.equal(rail.value.status,'done');
  notify(rail,'turn/completed',{turn:{status:'failed'}});assert.equal(rail.value.status,'error');
});
test('compaction changes passenger count without moving the weekly train',()=>{
  const rail=connected();rail.rateLimits({rateLimits:{primary:weekly}});
  notify(rail,'thread/tokenUsage/updated',{tokenUsage:{modelContextWindow:100,last:{totalTokens:80}}});
  const before=renderRail(rail.value,90,0,{color:false});
  notify(rail,'thread/tokenUsage/updated',{tokenUsage:{modelContextWindow:100,last:{totalTokens:20}}});
  const after=renderRail(rail.value,90,0,{color:false});
  assert.equal(before[5],after[5]);assert.notEqual(before[2],after[2]);
});
test('all terminal states fit every narrow and wide viewport',()=>{
  for(const width of [1,20,49,50,69,70,90,160])for(const status of ['working','idle','approval','waiting','done','error','compacting']){
    const lines=renderRail({...connected().value,status,context:100,weekly:100},width,2,{color:false});
    assert.equal(lines.length,6);
    for(const line of lines)assert.equal([...line].length,width);
  }
});
test('quota reset countdown never claims the quota has reset',()=>{
  assert.equal(resetLabel(null),'Reset --');
  assert.equal(resetLabel(0,1000),'Reset pending');
  assert.equal(resetLabel(52*3600,0),'Reset 2d 4h');
});
test('remaining percentage follows the progress endpoint without WEEK or left text',()=>{
  const state={...connected().value,status:'working',context:60,weekly:20,resetsAt:1800000000};
  const early=renderRail(state,120,1,{color:false});
  const later=renderRail({...state,weekly:80},120,1,{color:false});
  assert(early[5].includes(' 80% '));
  assert(later[5].includes(' 20% '));
  assert(later[5].indexOf('20%')>early[5].indexOf('80%'));
  assert(!early.join('').includes('WEEK'));
  assert(!early.join('').includes('left'));
  assert(early[0].includes('↻'));
  assert(!early.join('').includes('CTX'));
  assert(early[2].includes('60%'));
  assert.equal(early[2].indexOf('60%')>early[2].indexOf('│'),true);
  assert(!early.join('').includes('Input ready'));
  assert.equal(early.length,6);
});

test('wheels keep turning from submission through tools, compaction and response until turn completion',()=>{
  const rail=connected();
  rail.client({id:9,method:'turn/start',params:{threadId:'main'}});
  const moving=()=>assert.notEqual(renderRail(rail.value,120,0,{color:false})[4],renderRail(rail.value,120,1,{color:false})[4]);
  moving();
  notify(rail,'turn/started');
  notify(rail,'item/started',{item:{type:'commandExecution'}});
  notify(rail,'item/completed',{item:{type:'commandExecution'}});
  notify(rail,'thread/status/changed',{status:{type:'idle'}});
  assert.equal(rail.value.status,'working'); moving();
  notify(rail,'item/started',{item:{type:'contextCompaction'}}); moving();
  rail.server({id:45,method:'item/commandExecution/requestApproval',params:{threadId:'main'}});
  assert.equal(rail.value.status,'approval'); moving();
  notify(rail,'serverRequest/resolved',{requestId:45});
  notify(rail,'item/started',{item:{type:'agentMessage'}});
  notify(rail,'item/completed',{item:{type:'agentMessage'}}); moving();
  assert.equal(renderRail(rail.value,120,0,{color:false,reducedMotion:true})[4],renderRail(rail.value,120,1,{color:false,reducedMotion:true})[4]);
  notify(rail,'turn/completed',{turn:{status:'completed'}});
  assert.equal(rail.value.turnActive,false);
  assert.equal(renderRail(rail.value,120,0,{color:false})[4],renderRail(rail.value,120,1,{color:false})[4]);
});

test('failed or interrupted turns stop the wheels; other threads cannot change them',()=>{
  for(const ending of ['failed','interrupted']) {
    const rail=connected();
    rail.client({id:10,method:'turn/start',params:{threadId:'main'}});
    notify(rail,'turn/completed',{threadId:'other',turn:{status:ending}});
    assert.equal(rail.value.turnActive,true);
    notify(rail,'turn/completed',{turn:{status:ending}});
    assert.equal(rail.value.turnActive,false);
  }
  const rail=connected();
  rail.client({id:11,method:'turn/start',params:{threadId:'other'}});
  rail.server({id:11,error:{message:'Unavailable'}});
  assert.equal(rail.value.status,'idle');
  rail.client({id:12,method:'turn/start',params:{threadId:'main'}});
  rail.server({id:12,error:{message:'Unavailable'}});
  assert.equal(rail.value.turnActive,false);
  assert.equal(rail.value.status,'error');
});
