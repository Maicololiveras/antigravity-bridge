export function modelOptions(session = {}) {
  const option = session.configOptions?.find(o => o.type === 'select' && (o.category === 'model' || o.id === 'model'));
  if (option) return (option.options || []).flatMap(o => o.options || [o]).filter(o => typeof o.value === 'string').map(o => ({ id: o.value, name: o.name || o.value, configId: option.id }));
  return (session.models?.availableModels || []).map(o => ({ id: o.modelId, name: o.name || o.modelId, legacy: true }));
}
export async function selectModel(client, id) {
  const entry = modelOptions(client.session).find(m => m.id === id);
  if (!entry) throw new Error(`Model not advertised by this runtime: ${id}. Refresh with /ag models.`);
  if (entry.configId) {
    const result = await client.rpc.request('session/set_config_option', { sessionId: client.sessionId, configId: entry.configId, value: id });
    if (result.configOptions) client.session.configOptions = result.configOptions;
  } else {
    await client.rpc.request('session/set_model', { sessionId: client.sessionId, modelId: id });
  }
}
export function piModels(entries) {
  // ACP does not standardize token limits. These are explicit adapter budgets, not model specifications.
  return entries.map(({ id, name }) => ({ id, name: `${name} · Antigravity`, reasoning: false, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 8192 }));
}
