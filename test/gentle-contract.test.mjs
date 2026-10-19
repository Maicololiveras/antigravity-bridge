import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { RuntimeProvider } from '../src/provider.mjs';
import { connection, createStream } from './support.mjs';
import { requestPermission } from '../src/permissions.mjs';
test('real Gentle protocol consumes bridge output and RPC permission request', {skip: !process.env.GENTLE_SOURCE}, async t => {
  const { normalizeRpcEvent } = await import(pathToFileURL(join(process.env.GENTLE_SOURCE,'lib/agents-protocol.ts')));
  let asks;
  const ctx = {mode:'rpc',hasUI:false,ui:{select:async(title,options) => {
    asks=normalizeRpcEvent({type:'extension_ui_request',id:'test',method:'select',title,options});
    return options[0];
  }}};
  const p=new RuntimeProvider({connection,createStream,onPermission:(r,s)=>requestPermission(ctx,r,s)});t.after(()=>p.close());
  const model={id:'gemini-test',provider:'antigravity',api:'antigravity-acp'};
  const result=await p.stream(model,{messages:[{role:'user',content:'METRICS'}]}).result();
  const usage=normalizeRpcEvent({type:'message_end',message:result},{observeResponses:true});
  assert.equal(usage.find(e=>e.type==='usage').cost,.03);
  const permitted=await p.stream(model,{messages:[{role:'user',content:'PERMISSION'}]},{sessionId:'permission'}).result();
  assert.equal(permitted.stopReason,'stop');assert.equal(asks[0].type,'ask');
});
