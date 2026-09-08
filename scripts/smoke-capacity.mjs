// Short local synthetic fan-out check, not a production/network capacity benchmark.
import { once } from 'node:events';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createListenServer } from '../src/server.mjs';
import { readConfig } from '../src/config.mjs';
const server = createListenServer(readConfig({ HOST: '127.0.0.1', PORT: '0' }));
const { port } = await server.listen(); const clients = []; let received = 0;
async function connect() {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/socket`); clients.push(ws); await once(ws, 'open');
  let sequence = 0; const pending = new Map();
  ws.on('message', (data, binary) => { if (binary) { received++; return; } const m = JSON.parse(data); pending.get(m.id)?.(m); pending.delete(m.id); });
  const request = (type, data = {}) => new Promise((resolve, reject) => {
    const id = String(++sequence), timer = setTimeout(() => reject(new Error('reply_timeout')), 3000);
    pending.set(id, m => { clearTimeout(timer); m.error ? reject(new Error(m.error)) : resolve(m.result); }); ws.send(JSON.stringify({ id, type, data }));
  });
  await request('hello', { protocol: 1, name: 'Synthetic capacity client' }); return { ws, request };
}
try {
  const hosts = [];
  for (let roomIndex = 0; roomIndex < 20; roomIndex++) {
    const host = await connect(); hosts.push(host);
    const room = await host.request('create', { name: `Synthetic room ${roomIndex}`, maxUsers: 10 });
    for (let j = 0; j < 9; j++) { const guest = await connect(); await guest.request('join', { roomId: room.id }); }
    await host.request('stream', { epoch: 1 });
  }
  const packet = Buffer.alloc(356); packet.write('ELTA'); packet[4] = 1; packet.writeUInt16LE(36, 6); packet.writeBigUInt64LE(1n, 8); packet.writeUInt32LE(48000, 28); packet.writeUInt16LE(320, 32); packet[34] = 2; packet[35] = 20;
  for (let i = 0; i < 100; i++) { packet.writeUInt32LE(i, 16); for (const host of hosts) host.ws.send(packet); await new Promise(resolve => setTimeout(resolve, 20)); }
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(server.peers.size, 200); assert.equal(received, 18000);
  console.log(JSON.stringify({ clients: 200, rooms: 20, listeners: 180, receivedPackets: received, expectedPackets: 18000, rssMiB: Math.round(process.memoryUsage().rss / 1048576), scope: 'local synthetic 2-second relay; not production capacity' }));
} finally { for (const ws of clients) ws.terminate(); await server.close(); }
