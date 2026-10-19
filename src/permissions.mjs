const clean = s => String(s ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, '');
export async function requestPermission(ctx, request, signal) {
  // RPC UI is a transport, even though the child has no terminal. Gentle owns
  // forwarding task dialogs and cancelling background dialogs.
  if ((!ctx?.hasUI && ctx?.mode !== 'rpc') || signal?.aborted) return null;
  const options = (request.options || []).filter(o => o.kind === 'allow_once' || o.kind === 'reject_once');
  if (!options.length) return null;
  const labels = options.map((o, i) => `${i + 1}. ${clean(o.name)}`);
  const details = JSON.stringify(request.toolCall?.rawInput ?? request.toolCall?.locations ?? {});
  const title = `Antigravity · ${clean(request.worker || 'principal')} · ${clean(request.model)}\n${clean(request.cwd)}\n${clean(request.toolCall?.title || 'Permiso')}\n${clean(details)}`;
  const choice = await ctx.ui.select(title, labels, { signal, timeout: 300000 });
  return options[labels.indexOf(choice)]?.optionId ?? null;
}
