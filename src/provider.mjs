import { usageSnapshot } from './metrics.mjs';
import { randomUUID } from 'node:crypto';
import { AntigravityClient } from './acp.mjs';
import { selectModel, selectThought } from './catalog.mjs';

function textOf(message) {
  if (typeof message.content === 'string') return message.content;
  return (message.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
}
function signature(message) { return JSON.stringify([message.role, textOf(message)]); }
export class RuntimeProvider {
  constructor({ createStream, connection, onPermission, onActivity = (_update, _key) => {}, onMetrics = (_metric) => {} }) {
    this.createStream = createStream; this.connection = connection;
    this.onMetrics = onMetrics; this.onPermission = onPermission; this.onActivity = onActivity; this.sessions = new Map();
  }
  close() { for (const state of this.sessions.values()) state.client.close(); this.sessions.clear(); }
  stream(model, context, options = {}) {
    const stream = this.createStream();
    const output = { role: 'assistant', content: [{ type: 'text', text: '' }], api: model.api, provider: model.provider, model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'pending', timestamp: Date.now() };
    void (async () => {
      const metric = { id: randomUUID(), worker: `${process.pid}:${options.sessionId || 'principal'}`, model: model.id, startedAt: Date.now(), permissionMs: 0, status: 'ejecutando' };
      let revision = 0;
      const report = () => { metric.revision = ++revision; try { this.onMetrics({ ...metric }); } catch {} };
      report();
      let state; let acquired = false; let abort;
      try {
        if (options.signal?.aborted) throw new Error('Cancelled before start');
        const key = options.sessionId || 'interactive';
        state = this.sessions.get(key);
        const messages = context.messages.filter(m => m.role === 'user' || m.role === 'assistant');
        if (messages.some(m => Array.isArray(m.content) && m.content.some(c => c.type === 'image'))) throw new Error('This bridge version supports text only');
        if (state?.locked) throw new Error('Concurrent prompt for the same ACP session');
        const changed = state && state.prefix.some((s, i) => s !== signature(messages[i] || {}));
        if (state?.client.rpc.closed || changed) { state.client.close(); this.sessions.delete(key); state = undefined; }
        if (!state) {
          if (this.sessions.size >= 16) throw new Error('Runtime session limit reached; start a new Pi session');
          const client = new AntigravityClient({ ...this.connection(), onPermission: this.onPermission });
          state = { client, prefix: [], locked: false, initialized: false, costBaseline: 0, currency: undefined };
          this.sessions.set(key, state);
        }
        state.locked = true; acquired = true;
        const client = state.client;
        client.onPermission = async (request, signal) => {
          metric.status = 'esperando permiso'; metric.waitingAt = Date.now(); report();
          try { return await this.onPermission?.({ ...request, worker: metric.worker, model: model.id, cwd: client.cwd }, signal); }
          finally { metric.permissionMs += Date.now() - metric.waitingAt; delete metric.waitingAt; metric.status = 'ejecutando'; report(); }
        };
        abort = () => { if (client.busy) client.cancel(); else client.close(); };
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) { abort(); throw new Error('Cancelled before initialization'); }
        if (!state.initialized) { await client.initialize(); await client.open(); state.initialized = messages.length === 0 ? false : true; }
        await selectModel(client, model.id);
        const effort = await selectThought(client, options.reasoning);
        if (typeof effort === 'string') { output.providerThinkingLevel = effort; metric.effort = effort; }
        output.responseModel = model.id;
        const fresh = state.prefix.length === 0;
        const delta = messages.slice(state.prefix.length).filter(m => !(m.role === 'assistant' && m.provider === model.provider));
        let prompt = delta.map(m => `${m.role === 'user' ? 'USER' : 'ASSISTANT'}:\n${textOf(m)}`).join('\n\n');
        if (fresh) {
          const system = context.systemPrompt || context.messages.filter(m => m.role === 'system').map(textOf).join('\n');
          prompt = (system ? `Host instructions (use only your runtime's available tools):\n${system}\n\n` : '') + prompt;
        }
        if (!prompt.trim()) throw new Error('No new text to send');
        const original = { sessionId: client.sessionId, prompt: [{ type: 'text', text: prompt }] };
        const replacement = await options.onPayload?.(original, model);
        const payload = replacement ?? original;
        if (payload.sessionId !== client.sessionId || !Array.isArray(payload.prompt) || payload.prompt.some(p => p.type !== 'text')) throw new Error('Unsupported payload override');
        prompt = payload.prompt.map(p => p.text).join('\n');
        stream.push({ type: 'start', partial: output });
        stream.push({ type: 'text_start', contentIndex: 0, partial: output });
        let callbackError;
        client.onUpdate = update => {
          try {
            options.onProviderStreamEvent?.(update, model);
            if (update.sessionUpdate === 'usage_update') { Object.assign(metric, usageSnapshot(update)); if (metric.contextSize > 0) model.contextWindow = metric.contextSize; report(); }
            if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
              output.content[0].text += update.content.text;
              stream.push({ type: 'text_delta', contentIndex: 0, delta: update.content.text, partial: output });
            } else if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update' || update.sessionUpdate === 'plan') {
              this.onActivity(update, key);
            }
          } catch (error) { callbackError = error; client.close(); }
        };
        const result = await client.prompt(prompt);
        if (result.usage && typeof result.usage === 'object') {
          metric.reportedUsage = Object.fromEntries(['inputTokens','outputTokens','totalTokens','thoughtTokens','cachedReadTokens','cachedWriteTokens'].filter(k => Number.isSafeInteger(result.usage[k]) && result.usage[k] >= 0).map(k => [k,result.usage[k]]));
        }
        if (callbackError) throw callbackError;
        if (options.signal?.aborted || result.stopReason === 'cancelled') throw new Error('Antigravity turn cancelled');
        state.prefix = messages.map(signature);
        // ACP usage_update cost is cumulative for this session; Pi/Gentle sums
        // message costs. Only report a known USD delta, never repeat a total.
        if (metric.currency === 'USD' && state.costBaseline !== undefined &&
            (!state.currency || state.currency === 'USD') && metric.sessionCost >= state.costBaseline) {
          output.usage.cost.total = metric.sessionCost - state.costBaseline;
        }
        state.costBaseline = metric.sessionCost;
        state.currency = metric.currency;
        metric.status = 'completado';
        output.stopReason = result.stopReason === 'max_tokens' ? 'length' : 'stop';
        stream.push({ type: 'text_end', contentIndex: 0, content: output.content[0].text, partial: output });
        stream.push({ type: 'done', reason: output.stopReason, message: output });
      } catch (error) {
        metric.status = options.signal?.aborted ? 'cancelado' : 'error';
        // An uncertain turn must never be silently resent into the same runtime session.
        if (acquired) state?.client.close();
        output.stopReason = options.signal?.aborted ? 'aborted' : 'error';
        output.errorMessage = error.message;
        stream.push({ type: 'error', reason: output.stopReason, error: output });
      } finally {
        metric.finishedAt = Date.now(); report();
        if (abort) options.signal?.removeEventListener('abort', abort);
        if (acquired) state.locked = false;
        stream.end();
      }
    })();
    return stream;
  }
}
