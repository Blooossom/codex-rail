import http from 'node:http';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import readline from 'node:readline';
import { writeFileSync, renameSync, chmodSync } from 'node:fs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, WebSocket } from '../vendor/ws/wrapper.mjs';
import { RailState } from './state.mjs';

function daemonConnection(path) {
  const process = new EventEmitter();
  const socket = new WebSocket(`ws+unix://${path}:/`, { maxPayload: 64 * 1024 * 1024 });
  process.stdout = new PassThrough();
  process.stderr = new PassThrough();
  process.stdin = new Writable({write(bytes, encoding, callback) {
    const send = () => socket.send(bytes.toString().trimEnd(), callback);
    if (socket.readyState === WebSocket.OPEN) send();
    else if (socket.readyState === WebSocket.CONNECTING) socket.once('open', send);
    else callback(new Error('Codex daemon connection closed'));
  }});
  socket.on('message', data => process.stdout.write(data.toString() + '\n'));
  socket.on('error', error => process.emit('error', error));
  socket.on('close', () => process.emit('exit'));
  process.kill = () => { socket.terminate(); process.stdout.end(); };
  return process;
}

export async function createBridge({ socketPath, statePath, daemonSocket, upstreamFactory, resumePermissions = null, bearerToken = null }) {
  if (!socketPath && (!bearerToken || !upstreamFactory)) throw new Error('Loopback transport requires authentication and an upstream.');
  const write = state => {
    writeFileSync(statePath + '.next', JSON.stringify(state), { mode: 0o600 });
    renameSync(statePath + '.next', statePath);
  };
  const rail = new RailState(write);
  write(rail.value);
  const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  // Filesystem socket is inside a private 0700 directory, and browser Origins are rejected.
  const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 * 1024,
    verifyClient: info => {
      if (info.origin) return false;
      if (!bearerToken) return true;
      const actual = Buffer.from(info.req.headers.authorization || '');
      const expected = Buffer.from(`Bearer ${bearerToken}`);
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    } });
  let active = false, closeConnection = () => {};
  wss.on('connection', socket => {
    if (active) { socket.close(1013, 'A CLI is already connected'); return; }
    active = true;
    const upstream = upstreamFactory ? upstreamFactory() : daemonConnection(daemonSocket || join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'app-server-control', 'app-server-control.sock'));
    // Errors may contain request text or sensitive data, so do not store or echo upstream logs.
    upstream.stderr?.resume();
    const reader = readline.createInterface({ input: upstream.stdout, crlfDelay: Infinity });
    let initialized = false, closed = false, poll = null;
    const own = new Map();
    const permissionRequests = new Set();
    let permissionApplied = false;
    const send = message => {
      if (!upstream.stdin.destroyed && !closed) upstream.stdin.write(JSON.stringify(message) + '\n');
    };
    const requestQuota = () => {
      if (!initialized || closed || own.size) return;
      const id = `codex-rail:${randomUUID()}`;
      own.set(id, Date.now());
      send({ id, method: 'account/rateLimits/read', params: { excludeResetCreditDetails: true } });
    };
    const close = () => {
      if (closed) return;
      closed = true; active = false;
      clearInterval(poll); reader.close();
      upstream.stdin.end(); upstream.kill('SIGTERM');
      socket.close(); rail.patch({ connected: false, status: 'disconnected' });
    };
    closeConnection = close;
    upstream.on('error', close); upstream.on('exit', close);
    upstream.stdin.on('error', close);
    socket.on('error', close); socket.on('close', close);
    socket.on('message', bytes => {
      let line = bytes.toString();
      let message;
      try { message = JSON.parse(line); } catch { socket.close(1007, 'Invalid JSON'); return; }
      if (resumePermissions && !permissionApplied && message.method === resumePermissions.method && message.id != null) {
        message.params = { ...message.params, approvalPolicy: resumePermissions.approvalPolicy,
          sandbox: resumePermissions.sandbox };
        // A named profile must not override the explicitly requested built-in mode.
        delete message.params.permissions;
        permissionRequests.add(message.id);
        line = JSON.stringify(message);
      }
      rail.client(message);
      // All other messages, especially approval decisions, are relayed unchanged.
      if (!upstream.stdin.destroyed) upstream.stdin.write(line + '\n');
      if (message.method === 'initialized' && !initialized) {
        initialized = true; rail.patch({ connected: true, status: 'idle' });
        requestQuota();
        poll = setInterval(() => {
          for (const [id, at] of own) if (Date.now() - at > 120000) own.delete(id);
          requestQuota();
        }, 60000);
      }
    });
    reader.on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { close(); return; }
      if (own.has(message.id)) {
        own.delete(message.id);
        if (message.result) rail.rateLimits(message.result);
        return; // Internal read response never reaches the official CLI.
      }
      if (permissionRequests.delete(message.id) && message.result) {
        const result = message.result;
        if (result.approvalPolicy !== resumePermissions.approvalPolicy || result.sandbox?.type !== 'dangerFullAccess') {
          // Never claim a successful resume with permissions different from the request.
          message = { id: message.id, error: { code: -32000,
            message: 'Codex Rail: the server did not confirm the requested --yolo permissions; resume was stopped.' } };
          line = JSON.stringify(message);
        } else permissionApplied = true;
      }
      rail.server(message);
      if (socket.readyState === WebSocket.OPEN) socket.send(line);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    if (socketPath) server.listen(socketPath, resolve);
    else server.listen(0, '127.0.0.1', resolve);
  });
  if (socketPath) chmodSync(socketPath, 0o600);
  const endpoint = socketPath ? `unix://${socketPath}` : `ws://127.0.0.1:${server.address().port}`;
  return { rail, endpoint, async close() {
    closeConnection();
    for (const client of wss.clients) client.terminate();
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
  } };
}
