import test from 'node:test';
import assert from 'node:assert/strict';
import { AntigravityClient, Rpc } from '../src/acp.mjs';
import { modelOptions, piModels, selectModel } from '../src/catalog.mjs';
import { RuntimeProvider } from '../src/provider.mjs';
import { connection, createStream } from './support.mjs';
const user = text => ({ role: 'user', content: text });
const model = { id: 'gemini-test', provider: 'antigravity', api: 'antigravity-acp' };
async function ready(t, extra = {}) { const c = new AntigravityClient({ ...connection(), ...extra }); t.after(() => c.close()); await c.initialize(); await c.open(); return c; }
function provider(t) { const p = new RuntimeProvider({ connection, createStream }); t.after(() => p.close()); return p; }
test('ACP negotiates auth methods, lists models, selects exact model and streams', async t => {
  const updates = []; const c = await ready(t, { onUpdate: u => updates.push(u) });
  await c.authenticate('official-login');
  await assert.rejects(c.authenticate('invented'), /not advertised/);
  assert.equal(modelOptions(c.session).length, 2);
  await selectModel(c, 'gemini-other');
  await c.prompt('hello');
  assert.match(updates.filter(u => u.content).map(u => u.content.text).join(''), /gemini-other/);
  await assert.rejects(selectModel(c, 'invented'), /not advertised/);
});
test('grouped ACP models flatten without inventing identifiers', () => {
  const rows = modelOptions({ configOptions: [{ id: 'choose', category: 'model', type: 'select', options: [{ group: 'g', options: [{ value: 'exact-id', name: 'Visible name' }] }] }] });
  assert.equal(piModels(rows)[0].id, 'exact-id'); assert.equal(rows[0].configId, 'choose');
});
test('permission is denied without UI callback and approved only by a returned option', async t => {
  const c = await ready(t); assert.equal((await c.prompt('PERMISSION')).stopReason, 'cancelled');
  const yes = await ready(t, { onPermission: async () => 'yes' }); assert.equal((await yes.prompt('PERMISSION')).stopReason, 'end_turn');
});
test('cancellation resolves a running prompt', async t => {
  const c = await ready(t); const request = c.prompt('HANG'); c.cancel(); assert.equal((await request).stopReason, 'cancelled');
});
test('process failure rejects pending requests', async t => { const c = await ready(t); await assert.rejects(c.prompt('CRASH'), /exited/); });
test('timeout closes a hung runtime', async t => { const c = await ready(t, { timeout: 30 }); await assert.rejects(c.prompt('HANG'), /timeout/); assert.equal(c.rpc.closed, true); });
test('provider streams and resumes without resending earlier user messages', async t => {
  const p = provider(t); const a = p.stream(model, { messages: [user('first')] }, { sessionId: 'a' }); const first = await a.result();
  assert.equal(first.stopReason, 'stop'); assert.ok(a.events.some(e => e.type === 'text_delta'));
  const second = await p.stream(model, { messages: [user('first'), first, user('second')] }, { sessionId: 'a' }).result();
  assert.match(second.content[0].text, /#2/); assert.doesNotMatch(second.content[0].text, /first/);
});
test('provider isolates parent and child sessions and changes selected model', async t => {
  const p = provider(t);
  const [a,b] = await Promise.all([p.stream(model, { messages: [user('parent')] }, { sessionId: 'a' }).result(), p.stream({ ...model, id: 'gemini-other' }, { messages: [user('child')] }, { sessionId: 'b' }).result()]);
  assert.match(a.content[0].text, /gemini-test #1/); assert.match(b.content[0].text, /gemini-other #1/);
});
test('tree rewrite starts a fresh runtime instead of leaking old history', async t => {
  const p = provider(t); await p.stream(model, { messages: [user('old')] }).result();
  const result = await p.stream(model, { messages: [user('replacement')] }).result(); assert.match(result.content[0].text, /#1/);
});
test('provider cancellation stops without retrying the turn', async t => {
  const p = provider(t); const abort = new AbortController(); const stream = p.stream(model, { messages: [user('HANG')] }, { signal: abort.signal });
  setTimeout(() => abort.abort(), 100); assert.equal((await stream.result()).stopReason, 'aborted');
});
test('onPayload replacement is used before prompting', async t => {
  const p = provider(t); const result = await p.stream(model, { messages: [user('original')] }, { onPayload: payload => ({ ...payload, prompt: [{ type: 'text', text: 'replaced' }] }) }).result();
  assert.match(result.content[0].text, /replaced/); assert.doesNotMatch(result.content[0].text, /original/);
});
test('missing executable returns a useful error', async t => {
  const c = new AntigravityClient({ command: '/definitely-not-installed/antigravity' }); t.after(() => c.close()); await assert.rejects(c.initialize(), /ENOENT/);
});
