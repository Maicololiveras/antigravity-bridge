import { AntigravityClient } from '../src/acp.mjs';
import { connection } from '../test/support.mjs';
const client = new AntigravityClient({ ...connection(), onUpdate: u => { if (u.content?.text) process.stdout.write(u.content.text); } });
try { await client.initialize(); await client.open(); await client.prompt('Demo ACP local; no usa Google ni consume cuota.'); console.log(); }
finally { client.close(); }
