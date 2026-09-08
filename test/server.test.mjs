import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { readConfig } from '../src/config.mjs';
import { createListenServer } from '../src/server.mjs';
async function fixture(t, overrides = {}) {
  const server = createListenServer({ ...readConfig({ PORT: '0', HOST: '127.0.0.1' }), ...overrides });
  const address = await server.listen();
  t.after(() => server.close());
  const connect = async (hello = {}) => {
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/v1/socket`); await once(ws, 'open');
    let counter = 0; const pending = new Map(); const events = [];
    ws.on('message', (data, binary) => {
      if (binary) { events.push(Buffer.from(data)); return; }
      const m = JSON.parse(data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else events.push(m);
    });
    const request = (type, data = {}) => new Promise((resolve, reject) => {
      const id = String(++counter); const timeout = setTimeout(() => reject(new Error('reply_timeout')), 2000);
      pending.set(id, value => { clearTimeout(timeout); resolve(value); }); ws.send(JSON.stringify({ id, type, data }));
    });
    const result = await request('hello', { protocol: 1, name: 'Test', ...hello });
    return { ws, request, events, hello: result };
  };
  return { server, connect };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 40));
function packet(epoch) {
  const p = Buffer.alloc(39); p.write('ELTA'); p[4] = 1; p.writeUInt16LE(36, 6); p.writeBigUInt64LE(BigInt(epoch), 8);
  p.writeUInt32LE(48000, 28); p.writeUInt16LE(3, 32); p[34] = 2; p[35] = 20; p.set([0xf8, 0xff, 0xfe], 36); return p;
}
test('password, membership, host-only audio, epoch validation and single-use invitation', async t => {
  const { connect } = await fixture(t); const a = await connect(), b = await connect(), outsider = await connect();
  const room = (await a.request('create', { name: 'Private', password: 'secret', private: true, maxUsers: 3 })).result;
  assert.equal((await outsider.request('rooms')).result.length, 0);
  assert.equal((await b.request('join', { roomId: room.id, password: 'bad' })).error, 'wrong_password');
  const invite = (await a.request('invite')).result;
  assert.equal((await b.request('join', invite)).result.id, room.id);
  assert.equal((await outsider.request('join', invite)).error, 'wrong_password');
  assert.equal((await b.request('stream', { epoch: 123 })).error, 'host_required');
  await a.request('stream', { epoch: 123 });
  a.ws.send(packet(123)); a.ws.send(packet(999)); b.ws.send(packet(123)); await tick();
  assert.equal(b.events.filter(Buffer.isBuffer).length, 1);
  assert.equal(outsider.events.filter(Buffer.isBuffer).length, 0);
  assert.equal(a.events.filter(Buffer.isBuffer).length, 0);
  await a.request('leave'); await tick(); assert(b.events.some(x => x.reason === 'host_left'));
});
test('room/server caps are enforced and disconnect resumes the same identity', async t => {
  const { connect } = await fixture(t, { maxUsers: 3, maxRooms: 1, maxRoomUsers: 2 });
  const a = await connect(), b = await connect(), c = await connect();
  const room = (await a.request('create', { name: 'Room', maxUsers: 2 })).result;
  await b.request('join', { roomId: room.id });
  assert.equal((await c.request('join', { roomId: room.id })).error, 'room_full');
  assert.equal((await c.request('create', { name: 'Extra', maxUsers: 2 })).error, 'room_limit');
  assert.equal((await connect()).hello.error, 'server_full');
  b.ws.close(); await once(b.ws, 'close'); await tick();
  const resumed = await connect({ resumeToken: b.hello.result.resumeToken });
  assert.equal(resumed.hello.result.peerId, b.hello.result.peerId);
  await tick(); assert(resumed.events.some(x => x.room?.id === room.id));
});
test('concurrent password joins cannot exceed capacity', async t => {
  const { connect } = await fixture(t); const a = await connect(), b = await connect(), c = await connect();
  const room = (await a.request('create', { name: 'Room', password: 'secret', maxUsers: 2 })).result;
  const replies = await Promise.all([b, c].map(p => p.request('join', { roomId: room.id, password: 'secret' })));
  assert.equal(replies.filter(x => x.result).length, 1); assert.equal(replies.filter(x => x.error === 'room_full').length, 1);
});
