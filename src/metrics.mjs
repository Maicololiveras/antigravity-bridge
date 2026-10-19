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
  return `${m.worker} · ${m.model} · esfuerzo ${m.effort ?? 'N/D'} · ${m.status} · ${(Math.max(0, elapsed) / 1000).toFixed(1)}s (permisos ${(wait / 1000).toFixed(1)}s) · contexto ${m.contextUsed ?? 'N/D'}/${m.contextSize ?? 'N/D'} · costo sesión ${m.sessionCost === undefined ? 'N/D' : `${m.currency} ${m.sessionCost}`} · usage ACP ${m.reportedUsage ? JSON.stringify(m.reportedUsage) : 'N/D'}`;
}
