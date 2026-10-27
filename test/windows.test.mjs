import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createBridge } from '../src/bridge.mjs';
import { nativeCommand, terminalArguments, restrictDirectory } from '../src/windows.mjs';
import { WebSocket } from '../vendor/ws/wrapper.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const waitFor = async fn => {
  for (let i=0;i<200;i++) { if (fn()) return; await new Promise(r=>setTimeout(r,20)); }
  assert.fail('Condition not reached');
};

test('Windows session directory can be restricted to the current account', {skip:process.platform!=='win32'}, t => {
  const directory=mkdtempSync(join(tmpdir(),'rail-acl-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  restrictDirectory(directory);
  writeFileSync(join(directory,'private.json'),'{}');
  assert.equal(readFileSync(join(directory,'private.json'),'utf8'),'{}');
});

test('Windows Terminal commands encode paths and keep prompts outside command syntax', () => {
  const config = { windowName: 'rail-test', powershell: 'C:\\Windows\\powershell.exe', node: "C:\\Odd path; $x\\it's node.exe",
    configPath: "C:\\Users\\한글; $x\\it's config.json", statePath: 'C:\\state.json', columns: 100, rows: 30 };
  const args = terminalArguments(config);
  assert.equal(args.filter(arg=>arg===';').length,2);
  assert(!args.includes(config.configPath));
  for (let i=0;i<args.length;i++) if (args[i]==='-EncodedCommand') {
    const script = Buffer.from(args[i+1], 'base64').toString('utf16le');
    assert(script.includes("it''s"));
    assert(script.startsWith('& '));
  }
  assert.deepEqual(args.slice(-3),[';','move-focus','up']);
});

test('official npm shims are invoked through Node without cmd.exe shell interpretation', t => {
  const directory=mkdtempSync(join(tmpdir(),'rail-npm-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const script=join(directory,'node_modules','@openai','codex','bin','codex.js');
  mkdirSync(dirname(script),{recursive:true});writeFileSync(script,'');
  assert.deepEqual(nativeCommand(join(directory,'codex.cmd'),'node.exe'),['node.exe',script]);
  assert.deepEqual(nativeCommand('C:\\codex.exe'),['C:\\codex.exe']);
  assert.throws(()=>nativeCommand(join(directory,'missing','codex.cmd')),/entry point/);
});

test('Windows loopback bridge requires its token, rejects browsers and relays approvals unchanged', async t => {
  const directory=mkdtempSync(join(tmpdir(),'rail-tcp-'));
  const received=[];
  const fake=new EventEmitter();fake.stdout=new PassThrough();fake.stderr=new PassThrough();fake.kill=()=>{};
  fake.stdin=new Writable({write(data,encoding,done){received.push(JSON.parse(data));done();}});
  const token=randomBytes(32).toString('hex');
  const bridge=await createBridge({statePath:join(directory,'state.json'),bearerToken:token,upstreamFactory:()=>fake});
  t.after(async()=>{await bridge.close();rmSync(directory,{recursive:true,force:true});});
  assert.match(bridge.endpoint,/^ws:\/\/127\.0\.0\.1:\d+$/);
  const rejected = headers => new Promise((resolve,reject)=>{
    const socket=new WebSocket(bridge.endpoint,{headers});
    socket.on('unexpected-response',(_,res)=>{res.resume();socket.terminate();resolve(res.statusCode);});
    socket.on('error',()=>{});
    socket.on('open',()=>{socket.terminate();reject(new Error('Unauthorized connection accepted'));});
  });
  assert.equal(await rejected({}),401);
  assert.equal(await rejected({Authorization:'Bearer wrong'}),401);
  assert.equal(await rejected({Authorization:`Bearer ${token}`,Origin:'https://example.com'}),401);
  const client=new WebSocket(bridge.endpoint,{headers:{Authorization:`Bearer ${token}`}});
  t.after(()=>client.terminate());
  await once(client,'open');
  const approval={id:77,method:'item/commandExecution/requestApproval',params:{threadId:'main',command:'private'}};
  const reply=once(client,'message');fake.stdout.write(JSON.stringify(approval)+'\n');
  assert.deepEqual(JSON.parse((await reply)[0]),approval);
  assert.deepEqual(received,[]);
  const decision={id:77,result:{decision:'decline'}};
  client.send(JSON.stringify(decision));await waitFor(()=>received.length===1);
  assert.deepEqual(received,[decision]);
  assert(!readFileSync(join(directory,'state.json'),'utf8').includes('private'));
  client.terminate();
});

test('Windows session connects the TUI over authenticated loopback to an owned stdio server', async t => {
  const directory=mkdtempSync(join(tmpdir(),'rail-win-session-'));
  const fake=join(directory,'fake.mjs');
  const wsImport=pathToFileURL(join(root,'vendor','ws','wrapper.mjs')).href;
  const config={command:[process.execPath,fake],args:['resume','--last','--yolo'],cwd:directory,
    statePath:join(directory,'state.json'),readyPath:join(directory,'ready.json'),exitPath:join(directory,'exit.json'),shutdownPath:join(directory,'shutdown')};
  writeFileSync(fake, `
    import {WebSocket} from ${JSON.stringify(wsImport)};
    import readline from 'node:readline';
    if(process.argv[2]==='app-server') {
      const rl=readline.createInterface({input:process.stdin});
      rl.on('line',line=>{
        const m=JSON.parse(line);
        if(m.id!=null) process.stdout.write(JSON.stringify({id:m.id,result:m.method==='thread/resume'
          ? {thread:{id:'main'},model:'gpt-6-astra',approvalPolicy:m.params.approvalPolicy,sandbox:{type:'dangerFullAccess'}} : {}})+'\\n');
      });
    } else {
      const endpoint=process.argv[process.argv.indexOf('--remote')+1];
      const name=process.argv[process.argv.indexOf('--remote-auth-token-env')+1];
      const client=new WebSocket(endpoint,{headers:{Authorization:'Bearer '+process.env[name]}});
      client.on('open',()=>client.send(JSON.stringify({id:1,method:'thread/resume',params:{threadId:'main'}})));
      client.on('message',bytes=>{
        const m=JSON.parse(bytes);
        if(m.id===1) {
          if(m.result?.approvalPolicy!=='never')process.exit(2);
          client.send(JSON.stringify({method:'initialized'}));
        }
      });
    }
  `);
  const configPath=join(directory,'config.json');writeFileSync(configPath,JSON.stringify(config));
  const worker=spawn(process.execPath,[join(root,'src','windows-session.mjs'),configPath],{stdio:'ignore'});
  t.after(()=>{worker.kill();rmSync(directory,{recursive:true,force:true});});
  await waitFor(()=>existsSync(config.statePath)&&JSON.parse(readFileSync(config.statePath,'utf8')).connected);
  assert.equal(JSON.parse(readFileSync(config.statePath,'utf8')).model,'gpt-6-astra');
  writeFileSync(config.shutdownPath,'');
  const [code]=await once(worker,'exit');
  assert.equal(code,130);
  assert.equal(JSON.parse(readFileSync(config.exitPath,'utf8')).code,130);
});
