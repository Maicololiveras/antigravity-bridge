import { requestPermission } from '../src/permissions.mjs';
import { metricLine } from '../src/metrics.mjs';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AntigravityClient } from '../src/acp.mjs';
import { modelOptions, piModels, selectModel } from '../src/catalog.mjs';
import { RuntimeProvider } from '../src/provider.mjs';

export default function (pi: ExtensionAPI) {
  let ctx: any;
  let admin: AntigravityClient | undefined;
  const root = process.env.ANTIGRAVITY_BRIDGE_DIR || join(homedir(), '.pi', 'agent', 'antigravity-bridge');
  const cache = join(root, 'models.json');
  let entries: any[] = [];
  try { const saved = JSON.parse(readFileSync(cache, 'utf8')); if (Array.isArray(saved)) entries = saved.filter(m => typeof m.id === 'string' && typeof m.name === 'string'); } catch {}
  const clean = (s: unknown) => String(s ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, '');
  function connection() {
    const args = JSON.parse(process.env.ANTIGRAVITY_ACP_ARGS || '[]');
    if (!Array.isArray(args) || args.some(a => typeof a !== 'string')) throw new Error('ANTIGRAVITY_ACP_ARGS debe ser un array JSON de strings');
    return { command: process.env.ANTIGRAVITY_ACP_BIN, args, cwd: ctx?.cwd || process.cwd() };
  }
  let refresh: ReturnType<typeof setInterval> | undefined;
  const child = process.env.GENTLE_PI_AGENTS_CHILD === '1';
  const metrics = new Map<string, any>();
  let showMetrics = false;
  const renderMetrics = () => {
    if (showMetrics && ctx?.hasUI && !child) ctx.ui.setWidget('antigravity-metrics', [...metrics.values()].slice(-8).map(m => clean(metricLine(m))));
  };
  function receiveMetric(m: any) {
    if (!m || typeof m.id !== 'string' || !Number.isFinite(m.startedAt)) return;
    if ((metrics.get(m.id)?.revision || 0) >= m.revision) return;
    metrics.set(m.id, m);
    if (metrics.size > 64) metrics.delete(metrics.keys().next().value);
    if (m.finishedAt) pi.appendEntry?.('antigravity-metrics', m);
    renderMetrics();
  }
  async function permission(request: any, signal?: AbortSignal) {
    return requestPermission(ctx, request, signal);
  }
  function reportMetric(m: any) { receiveMetric(m); }
  const provider = new RuntimeProvider({ createStream: createAssistantMessageEventStream, connection, onPermission: permission, onMetrics: reportMetric,
    onActivity: (update: any) => {
      if (update.sessionUpdate === 'plan') ctx?.ui.setWidget('antigravity-plan', (update.entries || []).map((e: any) => `${clean(e.status)} · ${clean(e.content)}`));
      else ctx?.ui.setStatus('antigravity-bridge', `Antigravity · ${clean(update.title || update.toolCallId)} · ${clean(update.status)}`);
    }
  });
  function register() {
    pi.registerProvider('antigravity', {
      name: 'Antigravity runtime', api: 'antigravity-acp', baseUrl: 'http://127.0.0.1/unused-acp-stdio',
      // Availability marker required by Pi's model registry. Not a credential; never transmitted.
      apiKey: 'local-acp-runtime', authHeader: false, models: piModels(entries),
      streamSimple: (model: any, context: any, options: any) => provider.stream(model, context, options),
    });
  }
  register();
  async function adminClient() {
    if (admin && !admin.rpc.closed) return admin;
    admin = new AntigravityClient({ ...connection(), onPermission: permission });
    try { await admin.initialize(); return admin; } catch (error) { admin.close(); admin = undefined; throw error; }
  }
  pi.registerCommand('ag', {
    description: 'Antigravity: auth, models, status, usage, inspect, reset',
    handler: async (args, context) => {
      ctx = context;
      try {
        if (args.trim() === 'usage') { showMetrics = !showMetrics; if (!showMetrics) ctx.ui.setWidget('antigravity-metrics', undefined); renderMetrics(); if (!metrics.size) ctx.ui.notify('Sin métricas locales. Las tareas de workers tienen su propia sesión. N/D significa no reportado por ACP.', 'info'); return; }
        if (!ctx.isIdle()) throw new Error('Espera a que termine el turno o cancélalo con Esc');
        if (args.trim().startsWith('inspect')) {
          const client = await adminClient(); await client.open();
          const id = args.trim().slice('inspect'.length).trim();
          if (id) await selectModel(client, id);
          ctx.ui.notify(JSON.stringify({ bridge: '0.4.1', agent: client.info.agentInfo,
            configOptions: (client.session.configOptions || []).filter((o: any) => ['model','thought_level'].includes(o.category)).map((o: any) => ({id:o.id,category:o.category,currentValue:o.currentValue,options:o.options})),
            usage: 'Ejecuta una petición directa y /ag usage para ver datos reportados.' }, null, 2), 'info'); return;
        }
        if (args.trim() === 'reset') { provider.close(); admin?.close(); admin = undefined; ctx.ui.notify('Sesiones del bridge cerradas.', 'info'); return; }
        if (args.trim() === 'auth') {
          const client = await adminClient(); const methods = client.info.authMethods || [];
          if (!methods.length) { ctx.ui.notify('Inicia sesión en la aplicación oficial; ACP no anunció métodos de login.', 'info'); return; }
          if (!ctx.hasUI) throw new Error('El login necesita una interfaz interactiva');
          const labels = methods.map((m: any) => `${m.id}: ${m.name || m.id}`);
          const choice = await ctx.ui.select('Login gestionado por Antigravity', labels);
          const method = methods[labels.indexOf(choice)];
          if (method) await client.authenticate(method.id);
          return;
        }
        if (/^models(?:\s|$)/.test(args.trim())) {
          const client = await adminClient(); await client.open();
          const selected = args.trim().slice('models'.length).trim();
          if (selected) await selectModel(client, selected);
          entries = modelOptions(client.session);
          mkdirSync(root, { recursive: true });
          const temp = `${cache}.${process.pid}.tmp`;
          writeFileSync(temp, JSON.stringify(entries, null, 2), { mode: 0o600 }); renameSync(temp, cache);
          register();
          ctx.ui.notify(`${entries.length} modelos anunciados por ACP. Abre /model o /gentle:models.`, 'info');
          return;
        }
        ctx.ui.notify(`Antigravity bridge · ${entries.length} modelos en catálogo. /ag auth · /ag models · /ag reset. Permisos workers: RPC nativo Gentle (task); background cancela. /ag usage: duración, contexto y costo reportado.`, 'info');
      } catch (error: any) { ctx.ui.notify(clean(error.message), 'error'); }
    }
  });
  pi.on('session_start', async (_event, context) => {
    provider.close(); admin?.close(); admin = undefined; ctx = context; metrics.clear();
    for (const entry of ctx.sessionManager?.getEntries?.() || []) {
      if (entry.type === 'custom' && entry.customType === 'antigravity-metrics' && entry.data?.id) metrics.set(entry.data.id, entry.data);
    }
    while (metrics.size > 64) metrics.delete(metrics.keys().next().value);
    renderMetrics();
    if (ctx.hasUI && !child && !refresh) { refresh = setInterval(renderMetrics, 1000); refresh.unref(); }
  });
  pi.on('before_agent_start', (_event, context) => { ctx = context; });
  pi.on('agent_end', () => { ctx?.ui.setWidget('antigravity-plan', undefined); ctx?.ui.setStatus('antigravity-bridge', undefined); });
  pi.on('session_tree', () => provider.close());
  pi.on('session_shutdown', () => {
    provider.close(); admin?.close(); clearInterval(refresh);
  });
}
