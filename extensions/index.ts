import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AntigravityClient } from '../src/acp.mjs';
import { modelOptions, piModels } from '../src/catalog.mjs';
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
  async function permission(request: any) {
    if (!ctx?.hasUI) return null;
    const options = request.options.filter((o: any) => o.kind === 'allow_once' || o.kind === 'reject_once');
    const labels = options.map((o: any, i: number) => `${i + 1}. ${clean(o.name)}`);
    const choice = await ctx.ui.select(`Antigravity: ${clean(request.toolCall?.title || 'Permiso')}`, labels);
    return options[labels.indexOf(choice)]?.optionId ?? null;
  }
  const provider = new RuntimeProvider({ createStream: createAssistantMessageEventStream, connection, onPermission: permission,
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
    description: 'Antigravity: auth, models, status, reset',
    handler: async (args, context) => {
      ctx = context;
      try {
        if (!ctx.isIdle()) throw new Error('Espera a que termine el turno o cancélalo con Esc');
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
        if (args.trim() === 'models') {
          const client = await adminClient(); await client.open();
          entries = modelOptions(client.session);
          mkdirSync(root, { recursive: true });
          const temp = `${cache}.${process.pid}.tmp`;
          writeFileSync(temp, JSON.stringify(entries, null, 2), { mode: 0o600 }); renameSync(temp, cache);
          register();
          ctx.ui.notify(`${entries.length} modelos anunciados por ACP. Abre /model o /gentle:models.`, 'info');
          return;
        }
        ctx.ui.notify(`Antigravity bridge · ${entries.length} modelos en catálogo. /ag auth · /ag models · /ag reset. Cuota/tokens: no medidos.`, 'info');
      } catch (error: any) { ctx.ui.notify(clean(error.message), 'error'); }
    }
  });
  pi.on('session_start', (_event, context) => { provider.close(); admin?.close(); admin = undefined; ctx = context; });
  pi.on('before_agent_start', (_event, context) => { ctx = context; });
  pi.on('agent_end', () => { ctx?.ui.setWidget('antigravity-plan', undefined); ctx?.ui.setStatus('antigravity-bridge', undefined); });
  pi.on('session_tree', () => provider.close());
  pi.on('session_shutdown', () => { provider.close(); admin?.close(); });
}
