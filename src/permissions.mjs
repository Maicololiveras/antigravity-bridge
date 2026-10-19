import path from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';
const clean = s => String(s ?? '').replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '');
const grants = new WeakMap(); // Keyed by the ACP prompt AbortSignal; never persisted.
const operations = new Map([
  ['create_file', 'Crear archivo'],
  ['edit_file', 'Editar archivo'],
]);

// Resolve every existing component: symlinks/junctions never inherit a grant.
// Missing components are allowed for creation; unexpected filesystem errors deny reuse.
function checkedPath(value) {
  const absolute = path.resolve(value);
  const { root } = path.parse(absolute);
  let cursor = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try { if (lstatSync(cursor).isSymbolicLink()) return null; }
    catch (error) { if (error.code === 'ENOENT') continue; return null; }
  }
  let ancestor = absolute;
  const missing = [];
  while (true) {
    try { return path.join(realpathSync(ancestor), ...missing.reverse()); }
    catch (error) {
      if (error.code !== 'ENOENT' || ancestor === path.dirname(ancestor)) return null;
      missing.push(path.basename(ancestor)); ancestor = path.dirname(ancestor);
    }
  }
}
function inside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}
export function fileOperation(request) {
  const call = request.toolCall;
  const name = /^Run ([a-z_]+)\?$/.exec(call?.title || '')?.[1];
  if (!operations.has(name) || (call.kind && call.kind !== 'edit')) return null;
  const raw = call.rawInput;
  if (!raw || typeof raw.TargetFile !== 'string' || !path.isAbsolute(raw.TargetFile)) return null;
  // Reject Windows device paths / ADS and malformed or alternate path hints.
  if (/[\x00-\x1f]/.test(raw.TargetFile) || (process.platform === 'win32' && (/^\\\\/.test(raw.TargetFile) || raw.TargetFile.slice(2).includes(':')))) return null;
  const target = checkedPath(raw.TargetFile);
  if (!target) return null;
  if ((call.locations || []).some(l => typeof l.path !== 'string' || !path.isAbsolute(l.path) || checkedPath(l.path) !== target)) return null;
  return { name, label: operations.get(name), target, folder: path.dirname(target) };
}
export async function requestPermission(ctx, request, signal) {
  if ((!ctx?.hasUI && ctx?.mode !== 'rpc') || signal?.aborted) return null;
  const allow = request.options?.find(o => o.kind === 'allow_once');
  const deny = request.options?.find(o => o.kind === 'reject_once');
  if (!allow && !deny) return null;
  const file = fileOperation(request);
  const granted = signal && grants.get(signal);
  if (allow && file && granted?.some(folder => inside(folder, file.target))) return allow.optionId;
  const title = file
    ? `Antigravity · ${clean(request.model)}\n${file.label}: ${clean(path.basename(file.target))}\nCarpeta: ${clean(file.folder)}`
    : `Antigravity · ${clean(request.model)}\n${clean(request.toolCall?.title || 'Permiso').slice(0, 180)}\nCarpeta de trabajo: ${clean(request.cwd)}`;
  const once = 'Permitir esta vez';
  const scope = 'Permitir crear y editar en esta carpeta durante esta tarea';
  const reject = 'Rechazar';
  const details = 'Ver detalles';
  const labels = [...(allow ? [once] : []), ...(allow && file && signal ? [scope] : []), reject, details];
  while (!signal?.aborted) {
    const choice = await ctx.ui.select(title, labels, { signal, timeout: 300000 });
    if (signal?.aborted) return null;
    if (choice === once) return allow.optionId;
    if (choice === scope) {
      const confirm = await ctx.ui.select(`Autorizar creación y edición\n${clean(file.folder)}\nIncluye sus subcarpetas hasta finalizar este turno del worker.\nNo incluye borrar archivos ni ejecutar comandos.`, ['Autorizar carpeta', 'Volver'], { signal, timeout: 300000 });
      if (signal.aborted || confirm === undefined) return null;
      if (confirm !== 'Autorizar carpeta') continue;
      // Revalidate after human interaction, before remembering a capability.
      const current = fileOperation(request);
      if (!current || current.target !== file.target) return null;
      grants.set(signal, [...(grants.get(signal) || []), file.folder]);
      signal.addEventListener('abort', () => grants.delete(signal), { once: true });
      return allow.optionId;
    }
    if (choice === details) {
      const raw = JSON.stringify(request.toolCall?.rawInput ?? request.toolCall?.locations ?? {}, null, 2);
      await ctx.ui.select(`${title}\n${raw.slice(0, 8000).replace(/[\x00-\x08\x0b-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '')}${raw.length > 8000 ? '\n[Vista limitada a 8000 caracteres]' : ''}`, ['Volver'], { signal, timeout: 300000 });
      continue;
    }
    return choice === reject ? deny?.optionId ?? null : null;
  }
  return null;
}
