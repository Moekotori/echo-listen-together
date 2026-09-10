// Run against an explicitly selected deployed server; creates and cleans up one private test room.
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const origin = process.argv[2];
if (!origin || !/^wss:\/\//.test(origin)) throw new Error('Usage: node scripts/smoke-remote.mjs wss://server');
const url = new URL(origin);
if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Expected a wss origin without credentials');
const sockets = [];
async function client() {
  const ws = new WebSocket(`${url.origin}/v1/socket`, { handshakeTimeout: 10000, maxPayload: 262144 }); sockets.push(ws);
  await once(ws, 'open');
  let counter = 0; const pending = new Map(), packets = [];
  ws.on('message', (data, binary) => {
    if (binary) { if (packets.length < 100) packets.push(Buffer.from(data)); return; }
    const message = JSON.parse(data); pending.get(message.id)?.(message); pending.delete(message.id);
  });
  const request = (type, data = {}) => new Promise((resolve, reject) => {
    const id = String(++counter), timer = setTimeout(() => reject(new Error('request_timeout')), 10000);
    pending.set(id, reply => { clearTimeout(timer); resolve(reply); }); ws.send(JSON.stringify({ id, type, data }));
  });
  const hello = await request('hello', { protocol: 1, name: 'ECHO deployment check', password: process.env.SERVER_PASSWORD || '' });
  assert(hello.result, hello.error); return { ws, request, packets };
}
let host;
try {
  const health = await fetch(`https://${url.host}/health`, { signal: AbortSignal.timeout(10000) }); assert.equal(health.status, 200); assert.equal((await health.json()).protocol, 1);
  host = await client(); const guest = await client(), outsider = await client();
  const password = randomBytes(16).toString('hex');
  const created = await host.request('create', { name: 'Deployment smoke', password, private: true, maxUsers: 2 }); assert(created.result, created.error); const roomId = created.result.id;
  assert.equal((await guest.request('join', { roomId, password: 'incorrect' })).error, 'wrong_password');
  assert((await guest.request('join', { roomId, password })).result);
  assert.equal((await outsider.request('join', { roomId, password })).error, 'room_full');
  assert.equal((await outsider.request('rooms')).result.some(r => r.id === roomId), false);
  assert.equal((await guest.request('stream', { bitrate: 256000, epoch: 123 })).error, 'host_required');
  assert.equal((await host.request('stream', { bitrate: 256000, epoch: 123 })).result, true);
  // A valid 20ms Opus silence frame; compare binary payload unchanged across the TLS proxy and relay.
  const packet = Buffer.alloc(39); packet.write('ELTA'); packet[4] = 1; packet.writeUInt16LE(36, 6); packet.writeBigUInt64LE(123n, 8); packet.writeUInt32LE(48000, 28); packet.writeUInt16LE(3, 32); packet[34] = 2; packet[35] = 20; packet.set([0xf8, 0xff, 0xfe], 36);
  for (let i = 0; i < 20; i++) { packet.writeUInt32LE(i, 16); host.ws.send(packet); await new Promise(r => setTimeout(r, 20)); }
  for (let i = 0; i < 40 && guest.packets.length < 20; i++) await new Promise(r => setTimeout(r, 100));
  assert.equal(guest.packets.length, 20); assert.equal(outsider.packets.length, 0);
  for (let i = 0; i < 20; i++) { packet.writeUInt32LE(i, 16); assert.deepEqual(guest.packets[i], packet); }
  console.log(JSON.stringify({ ok: true, tls: 'verified', password: 'enforced', capacity: 'enforced', hostOnlyAudio: true, privateRoomHidden: true, relayedPackets: 20, exactPayloadMatch: true }));
} finally { if (host?.ws.readyState === WebSocket.OPEN) await host.request('leave').catch(() => {}); for (const ws of sockets) ws.terminate(); }
