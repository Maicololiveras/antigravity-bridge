import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelRuntime, ModelRegistry } from '@earendil-works/pi-coding-agent';
import extension from '../extensions/index.ts';
import { connection } from './support.mjs';

test('real Pi 1.3 registry exposes ACP models and streams through the registered provider', async t => {
  const root = mkdtempSync(join(tmpdir(), 'antigravity-test-'));
  const previous = Object.fromEntries(['ANTIGRAVITY_ACP_BIN','ANTIGRAVITY_ACP_ARGS','ANTIGRAVITY_BRIDGE_DIR'].map(k => [k,process.env[k]]));
  process.env.ANTIGRAVITY_ACP_BIN = connection().command;
  process.env.ANTIGRAVITY_ACP_ARGS = JSON.stringify(connection().args);
  process.env.ANTIGRAVITY_BRIDGE_DIR = root;
  const runtime = await ModelRuntime.create({ authPath: join(root,'auth.json'), modelsPath: join(root,'models-config.json'), modelsStorePath: join(root,'store.json'), allowModelNetwork: false, refreshOnCreate: false });
  const registry = new ModelRegistry(runtime);
  const events = new Map(); const commands = new Map(); const notices = [];
  extension({ registerProvider: (name, config) => registry.registerProvider(name,config), registerCommand: (name, config) => commands.set(name,config), on: (name, fn) => events.set(name,fn) });
  t.after(() => { events.get('session_shutdown')(); for(const [k,v] of Object.entries(previous)) { if(v===undefined) delete process.env[k]; else process.env[k]=v; } rmSync(root,{recursive:true,force:true}); });
  const ctx = { cwd: root, hasUI: false, isIdle: () => true, ui: { notify: (s,level) => notices.push({s,level}), setStatus(){}, setWidget(){} } };
  events.get('session_start')({},ctx);
  await commands.get('ag').handler('models',ctx);
  assert.equal(notices.some(n => n.level === 'error'),false,JSON.stringify(notices));
  // This is the exact registry contract used by Gentle getPiModelOptions().
  const available = registry.getAvailable().filter(m => m.provider === 'antigravity');
  assert.deepEqual(available.map(m => m.id).sort(),['gemini-other','gemini-test']);
  const stream = registry.streamSimple(available.find(m => m.id === 'gemini-other'), { messages: [{ role:'user', content:'Pi registry integration', timestamp: Date.now() }] }, { sessionId:'real-pi-test' });
  const received = []; for await (const event of stream) received.push(event.type);
  const result = await stream.result();
  assert.equal(result.stopReason,'stop',result.errorMessage);
  assert.match(result.content[0].text,/gemini-other/);
  assert.ok(received.includes('text_delta'));
});
