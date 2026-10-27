import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const hook=JSON.parse(readFileSync(join(root,'hooks','hooks.json'),'utf8')).hooks.SessionStart[0].hooks[0].command;

test('trusted hook installs zsh integration once, refreshes stale installs and preserves custom functions', {skip:process.platform==='win32'}, t => {
  const directory=mkdtempSync(join(tmpdir(),'rail-auto-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const bin=join(directory,'bin');mkdirSync(bin);
  for(const name of ['codex','tmux'])writeFileSync(join(bin,name),'#!/bin/sh\nexit 0\n',{mode:0o700});
  const profile=join(directory,'shell');mkdirSync(profile);
  const config=join(directory,'config');
  const env={...process.env,PATH:bin+':'+process.env.PATH,SHELL:'/bin/zsh',PLUGIN_ROOT:root,ZDOTDIR:profile,XDG_CONFIG_HOME:config};
  delete env.CODEX_RAIL_AUTO_SETUP_DISABLE;delete env.CODEX_RAIL_DISABLE;
  const run=()=>{
    const result=spawnSync('/bin/sh',['-c',hook],{env,encoding:'utf8',timeout:15000});
    assert.equal(result.status,0,result.stderr);return result.stdout;
  };
  assert.match(run(),/integration installed/);
  const settingsPath=join(config,'codex-rail','settings.json');
  const before=statSync(settingsPath).mtimeMs;
  assert.equal(run(),'');
  assert.equal(statSync(settingsPath).mtimeMs,before);
  const settings=JSON.parse(readFileSync(settingsPath,'utf8'));
  settings.plugin_root=join(directory,'old-version');writeFileSync(settingsPath,JSON.stringify(settings));
  assert.match(run(),/integration installed/);
  assert.equal(JSON.parse(readFileSync(settingsPath,'utf8')).plugin_root,root);
  const removed=spawnSync('python3',[join(root,'scripts','setup.py'),'--remove'],{env,encoding:'utf8'});
  assert.equal(removed.status,0,removed.stderr);
  assert.equal(run(),'');
  assert(!existsSync(join(config,'codex-rail','integration.zsh')));
  const restored=spawnSync('python3',[join(root,'scripts','setup.py'),'--install'],{env,encoding:'utf8'});
  assert.equal(restored.status,0,restored.stderr);
  assert(!existsSync(join(config,'codex-rail','auto-setup.disabled')));
  const custom='function codex() { echo custom; }\n';writeFileSync(join(profile,'.zshrc'),custom);
  assert.match(run(),/integration installed/);
  assert(readFileSync(join(profile,'.zshrc'),'utf8').startsWith(custom));
});

test('automatic setup can be disabled without writing shell configuration', t => {
  const directory=mkdtempSync(join(tmpdir(),'rail-auto-off-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const config=join(directory,'config');
  const result=spawnSync(process.execPath,[join(root,'scripts','auto-setup.mjs')],{
    env:{...process.env,CODEX_RAIL_AUTO_SETUP_DISABLE:'1',XDG_CONFIG_HOME:config,APPDATA:config},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout,'');
  assert(!existsSync(config));
});
