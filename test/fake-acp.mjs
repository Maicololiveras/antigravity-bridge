import { createInterface } from 'node:readline';
let model = 'gemini-test'; let active; let turn = 0;
const send = m => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
const configOptions = () => [{ id: 'model', category: 'model', type: 'select', currentValue: model, options: [{ value: 'gemini-test', name: 'Gemini test' }, { value: 'gemini-other', name: 'Gemini other' }] }];
const update = u => send({ method: 'session/update', params: { sessionId: 'test-session', update: u } });
createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line); const reply = result => send({ id: m.id, result });
  if (m.id === 'permission') { reply; const saved = active; active = undefined; send({ id: saved, result: { stopReason: m.result.outcome.outcome === 'selected' ? 'end_turn' : 'cancelled' } }); return; }
  if (m.method === 'initialize') return reply({ protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [{ id: 'official-login', name: 'Official test login' }] });
  if (m.method === 'authenticate') return reply({});
  if (m.method === 'session/new' || m.method === 'session/load') return reply({ sessionId: 'test-session', configOptions: configOptions() });
  if (m.method === 'session/set_config_option') { model = m.params.value; return reply({ configOptions: configOptions() }); }
  if (m.method === 'session/set_model') { model = m.params.modelId; return reply({}); }
  if (m.method === 'session/cancel') { if (active) send({ id: active, result: { stopReason: 'cancelled' } }); active = undefined; return; }
  if (m.method === 'session/prompt') {
    turn++; const text = m.params.prompt[0].text;
    if (text.includes('CRASH')) return process.exit(7);
    if (text.includes('HANG')) { active = m.id; return; }
    if (text.includes('PERMISSION')) {
      active = m.id;
      return send({ id: 'permission', method: 'session/request_permission', params: { sessionId: 'test-session', toolCall: { title: 'Test operation' }, options: [{ optionId: 'yes', kind: 'allow_once', name: 'Allow once' }, { optionId: 'no', kind: 'reject_once', name: 'Reject' }] } });
    }
    if (text.includes('METRICS')) update({ sessionUpdate: 'usage_update', used: 120, size: 4096, cost: { amount: 0.03, currency: 'USD' } });
    update({ sessionUpdate: 'tool_call', toolCallId: 'read-1', title: 'Read test', status: 'completed' });
    for (const token of [`${model} #${turn}: `, text]) update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: token } });
    return reply({ stopReason: 'end_turn' });
  }
  send({ id: m.id, error: { code: -32601, message: 'Unknown method' } });
});
