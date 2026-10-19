const valid = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
export function usageSnapshot(update) {
  if (update?.sessionUpdate !== 'usage_update') return {};
  return {
    ...(valid(update.used) && valid(update.size) ? { contextUsed: update.used, contextSize: update.size } : {}),
    ...(valid(update.cost?.amount) && /^[A-Z]{3}$/.test(update.cost?.currency) ? { sessionCost: update.cost.amount, currency: update.cost.currency } : {})
  };
}
export function metricLine(m, now = Date.now()) {
  const elapsed = m.finishedAt ? m.finishedAt - m.startedAt : now - m.startedAt;
  const wait = (m.permissionMs || 0) + (m.waitingAt ? now - m.waitingAt : 0);
  const context = m.contextUsed !== undefined && m.contextSize > 0
    ? `${m.contextUsed}/${m.contextSize} (${(100 * m.contextUsed / m.contextSize).toFixed(1)}%)` : 'N/D';
  return `${m.model} · ${m.effort ?? 'esfuerzo N/D'} · ${m.status} · ${(Math.max(0, elapsed) / 1000).toFixed(1)}s · espera permisos ${(wait / 1000).toFixed(1)}s · contexto ${context} · costo sesión ${m.sessionCost === undefined ? 'N/D' : `${m.currency} ${m.sessionCost}`}`;
}
