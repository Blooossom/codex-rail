import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { EventEmitter, once } from 'node:events';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { WebSocket } from '../vendor/ws/wrapper.mjs';
import { createBridge } from '../src/bridge.mjs';

test('bridge relays original messages, isolates internal usage reads, and never approves requests',{skip:process.platform==='win32'},async t=>{
  const dir=mkdtempSync('/tmp/rail-test-');
  const received=[];
  const fake=new EventEmitter();fake.stdout=new PassThrough();fake.stderr=new PassThrough();fake.kill=()=>{};
  const send=message=>fake.stdout.write(JSON.stringify(message)+'\n');
  fake.stdin=new Writable({write(data,encoding,callback){
    for(const line of data.toString().trim().split('\n')){
      const message=JSON.parse(line);received.push(message);
      if(message.method==='initialize')queueMicrotask(()=>send({id:message.id,result:{userAgent:'test'}}));
      if(message.method==='account/rateLimits/read')queueMicrotask(()=>send({id:message.id,result:{rateLimits:{secondary:{usedPercent:32,windowDurationMins:10080,resetsAt:1800000000}}}}));
    }callback();
  }});
  const bridge=await createBridge({socketPath:dir+'/rpc.sock',statePath:dir+'/state.json',upstreamFactory:()=>fake});
  const client=new WebSocket(`ws+unix://${dir}/rpc.sock:/`);
  t.after(async()=>{client.terminate();await bridge.close();rmSync(dir,{recursive:true,force:true});});
  const messages=[];client.on('message',data=>messages.push(JSON.parse(data)));
  await once(client,'open');
  const request={id:1,method:'initialize',params:{clientInfo:{name:'test',version:'0.1'}}};
  client.send(JSON.stringify(request));await once(client,'message');
  client.send(JSON.stringify({method:'initialized'}));
  await waitFor(()=>bridge.rail.value.weekly===32);
  assert.deepEqual(received[0],request);
  assert.equal(messages.length,1);assert.equal(messages[0].id,1);
  const approval={id:77,method:'item/commandExecution/requestApproval',params:{threadId:'main',command:'a private command'}};
  send(approval);await once(client,'message');
  assert.deepEqual(messages.at(-1),approval);
  assert(!received.some(m=>m.id===77),'Bridge must not reply to approvals');
  const decision={id:77,result:{decision:'decline'}};
  client.send(JSON.stringify(decision));await waitFor(()=>received.some(m=>m.id===77));
  assert.deepEqual(received.at(-1),decision);
  const stored=readFileSync(dir+'/state.json','utf8');
  assert(!stored.includes('private command'));assert(!stored.includes('decline'));
});
async function waitFor(fn){
  for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}
  assert.fail('Condition not reached');
}

test('explicit YOLO is applied only to initial resume and acknowledged by the server', {skip:process.platform==='win32'}, async t => {
  const dir=mkdtempSync('/tmp/rail-test-');
  const received=[];
  let confirm=false;
  const fake=new EventEmitter();fake.stdout=new PassThrough();fake.stderr=new PassThrough();fake.kill=()=>{};
  fake.stdin=new Writable({write(data,encoding,callback){
    const message=JSON.parse(data);received.push(message);
    if(message.method==='thread/resume') queueMicrotask(()=>fake.stdout.write(JSON.stringify({id:message.id,
      result:{thread:{id:'test'},approvalPolicy:confirm?'never':'on-request',sandbox:{type:confirm?'dangerFullAccess':'readOnly'}}})+'\n'));
    callback();
  }});
  const bridge=await createBridge({socketPath:dir+'/rpc.sock',statePath:dir+'/state.json',upstreamFactory:()=>fake,
    resumePermissions:{method:'thread/resume',approvalPolicy:'never',sandbox:'danger-full-access'}});
  const client=new WebSocket(`ws+unix://${dir}/rpc.sock:/`);
  t.after(async()=>{client.terminate();await bridge.close();rmSync(dir,{recursive:true,force:true});});
  await once(client,'open');
  const resume={id:9,method:'thread/resume',params:{threadId:'test',permissions:'read-only',model:'gpt-6-astra'}};
  client.send(JSON.stringify(resume));
  const [rejected]=await once(client,'message');
  assert.match(JSON.parse(rejected).error.message,/did not confirm/);
  assert.deepEqual(received[0].params,{threadId:'test',model:'gpt-6-astra',approvalPolicy:'never',sandbox:'danger-full-access'});
  confirm=true;
  client.send(JSON.stringify({...resume,id:10}));
  const [accepted]=await once(client,'message');
  assert.equal(JSON.parse(accepted).result.approvalPolicy,'never');
  // Subsequent /resume actions and permission decisions keep the user's current choices.
  client.send(JSON.stringify({...resume,id:11}));
  await once(client,'message');
  assert.deepEqual(received.at(-1).params,resume.params);
  const decision={id:77,result:{decision:'decline'}};
  client.send(JSON.stringify(decision));
  await waitFor(()=>received.at(-1).id===77);
  assert.deepEqual(received.at(-1),decision);
});
