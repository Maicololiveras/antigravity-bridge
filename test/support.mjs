import { fileURLToPath } from 'node:url';
export const connection = () => ({ command: process.execPath, args: [fileURLToPath(new URL('./fake-acp.mjs', import.meta.url))], timeout: 2000 });
export function createStream() {
  const events = [];
  let finish;
  const result = new Promise(resolve => { finish = resolve; });
  return { events, push(e) { events.push(e); if (e.type === 'done' || e.type === 'error') finish(e.message || e.error); }, end() {}, result: () => result };
}
