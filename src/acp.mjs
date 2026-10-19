import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

/** Newline-delimited JSON-RPC transport. No shell, token extraction or HTTP backend calls. */
export class Rpc extends EventEmitter {
  constructor(command, args = [], cwd = process.cwd()) {
    super();
    this.pending = new Map(); this.sequence = 0; this.buffer = ''; this.closed = false;
    this.child = spawn(command, args, { cwd, shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => this.receive(chunk));
    // Drain stderr without logging potentially sensitive authentication messages.
    this.child.stderr.on('data', () => {});
    this.child.stdin.on('error', error => this.fail(error));
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', (code, signal) => this.fail(new Error(`ACP process exited (${code ?? signal})`)));
  }
  write(message) {
    if (this.closed) throw new Error('ACP connection is closed');
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  }
  request(method, params = {}, timeout = 30000) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error(`ACP timeout: ${method}`)), timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  notify(method, params) { this.write({ method, params }); }
  receive(chunk) {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > 8 * 1024 * 1024) return this.fail(new Error('ACP frame exceeds 8 MiB'));
    let end;
    while ((end = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); }
      catch { return this.fail(new Error('Invalid JSON on ACP stdout')); }
      if (!message || message.jsonrpc !== '2.0') return this.fail(new Error('Invalid JSON-RPC message'));
      if (message.method) {
        if (message.id !== undefined) void this.reply(message);
        else this.emit('notification', message.method, message.params);
      } else {
        const item = this.pending.get(message.id);
        if (!item) continue;
        clearTimeout(item.timer); this.pending.delete(message.id);
        if (message.error) {
          const error = new Error(message.error.message || 'ACP request failed');
          error.code = message.error.code; item.reject(error);
        } else item.resolve(message.result);
      }
    }
  }
  async reply(message) {
    try {
      if (!this.handleRequest) throw Object.assign(new Error('Unsupported client method'), { code: -32601 });
      const result = await this.handleRequest(message.method, message.params);
      if (!this.closed) this.write({ id: message.id, result });
    } catch (error) {
      if (!this.closed) this.write({ id: message.id, error: { code: error.code ?? -32603, message: error.message } });
    }
  }
  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear(); this.child.stdin.destroy();
    this.child.kill();
    const kill = setTimeout(() => { if (this.child.exitCode === null) this.child.kill('SIGKILL'); }, 1500);
    kill.unref();
    this.emit('closed', error);
  }
  close() { this.fail(new Error('ACP connection closed')); }
}

export class AntigravityClient {
  constructor({ command, args = [], cwd = process.cwd(), onUpdate = (_update) => {}, onPermission = async (_request) => null, timeout = 1200000 }) {
    if (!command) throw new Error('Set ANTIGRAVITY_ACP_BIN to your installed ACP executable');
    this.rpc = new Rpc(command, args, cwd); this.cwd = cwd;
    this.timeout = timeout; this.onUpdate = onUpdate; this.onPermission = onPermission;
    this.busy = false; this.cancelled = false; this.sessionId = undefined;
    this.rpc.on('notification', (method, params) => {
      if (method === 'session/update' && params?.sessionId === this.sessionId) this.onUpdate(params.update);
    });
    this.rpc.on('closed', () => this.permissionController?.abort());
    this.rpc.handleRequest = async (method, params) => {
      if (method !== 'session/request_permission') throw Object.assign(new Error('Client capability not supported'), { code: -32601 });
      if (params.sessionId !== this.sessionId || this.cancelled || !this.busy) return { outcome: { outcome: 'cancelled' } };
      const optionId = await this.onPermission(params, this.permissionController?.signal);
      if (this.cancelled || !params.options?.some(o => o.optionId === optionId)) return { outcome: { outcome: 'cancelled' } };
      return { outcome: { outcome: 'selected', optionId } };
    };
  }
  async initialize() {
    this.info = await this.rpc.request('initialize', {
      protocolVersion: 1, clientCapabilities: {},
      clientInfo: { name: 'antigravity-bridge', version: '0.4.2' }
    });
    if (this.info.protocolVersion !== 1) { this.close(); throw new Error('Unsupported ACP protocol version'); }
    return this.info;
  }
  async authenticate(methodId) {
    if (!this.info?.authMethods?.some(m => m.id === methodId)) throw new Error('Authentication method not advertised by runtime');
    return this.rpc.request('authenticate', { methodId }, 300000);
  }
  async open(sessionId) {
    if (this.busy) throw new Error('A turn is already running');
    if (sessionId && !this.info?.agentCapabilities?.loadSession) throw new Error('Runtime does not support session/load');
    // Set before load because replay notifications can precede the response.
    this.sessionId = sessionId;
    try {
      const result = await this.rpc.request(sessionId ? 'session/load' : 'session/new', {
        ...(sessionId ? { sessionId } : {}), cwd: this.cwd, mcpServers: []
      });
      this.sessionId = sessionId ?? result.sessionId;
      if (!this.sessionId) throw new Error('Runtime did not return a session ID');
      this.session = result; return result;
    } catch (error) { this.sessionId = undefined; throw error; }
  }
  async prompt(text) {
    if (this.busy) throw new Error('A turn is already running');
    if (!this.sessionId) throw new Error('Open a session first');
    this.busy = true; this.cancelled = false; this.permissionController = new AbortController();
    try { return await this.rpc.request('session/prompt', { sessionId: this.sessionId, prompt: [{ type: 'text', text }] }, this.timeout); }
    finally { this.permissionController?.abort(); this.busy = false; clearTimeout(this.cancelTimer); }
  }
  cancel() {
    if (!this.busy || this.cancelled) return;
    this.cancelled = true; this.permissionController?.abort();
    this.rpc.notify('session/cancel', { sessionId: this.sessionId });
    // Some implementations do not acknowledge cancellation. Terminate rather than leave a hidden turn running.
    this.cancelTimer = setTimeout(() => this.close(), 5000);
    this.cancelTimer.unref();
  }
  async setMode(modeId) {
    if (this.busy) throw new Error('Wait for the current turn');
    if (!this.session?.modes?.availableModes?.some(m => m.id === modeId)) throw new Error('Mode not advertised by runtime');
    return this.rpc.request('session/set_mode', { sessionId: this.sessionId, modeId });
  }
  close() { this.permissionController?.abort(); this.cancelled = true; clearTimeout(this.cancelTimer); this.rpc.close(); }
}
