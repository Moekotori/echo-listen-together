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
test('chat is room scoped, identity is authoritative, oversized and fast messages are rejected', async t => {
  const { connect } = await fixture(t);
  const host = await connect({ name: 'Host', steamId: '76561198000000001' }), guest = await connect(), outside = await connect();
  assert.equal((await outside.request('chat', { text: 'No room' })).error, 'room_required');
  const room = (await host.request('create', { name: 'Chat', maxUsers: 3 })).result;
  await guest.request('join', { roomId: room.id });
  assert.equal(guest.events.filter(e => e.type === 'room').at(-1).room.members.find(m => m.name === 'Host').steamId, '76561198000000001');
  assert.equal(host.hello.result.capabilities.chat, true);
  assert.equal((await host.request('chat', { text: 'x'.repeat(501) })).error, 'invalid_chat');
  assert.equal((await host.request('chat', { text: '  hello <script>  ', name: 'fake', senderId: 'fake' })).result, true);
  await tick();
  const message = guest.events.find(e => e.type === 'chat').message;
  assert.equal(message.name, 'Host'); assert.equal(message.senderId, host.hello.result.peerId);
  assert.equal(message.text, 'hello <script>'); assert.equal(message.roomId, room.id);
  assert.equal(outside.events.filter(e => e.type === 'chat').length, 0);
  assert.equal((await host.request('chat', { text: 'again' })).error, 'chat_rate_limit');
  await guest.request('leave');
  assert.equal((await guest.request('chat', { text: 'left' })).error, 'room_required');
});
test('each listener receives only their rendition and legacy hosts fall back to standard', async t => {
  const { connect } = await fixture(t);
  const host = await connect(), standard = await connect(), high = await connect();
  const room = (await host.request('create', { name: 'Quality', maxUsers: 3 })).result;
  await standard.request('join', { roomId: room.id }); await high.request('join', { roomId: room.id });
  assert.equal((await high.request('quality', { value: 999 })).error, 'invalid_quality');
  await high.request('quality', { value: 320 });
  await host.request('stream', { epoch: 100, multiQuality: true });
  for (const epoch of [100, 101, 102, 103]) host.ws.send(packet(epoch));
  await tick();
  assert.deepEqual(standard.events.filter(Buffer.isBuffer).map(p => Number(p.readBigUInt64LE(8))), [100]);
  assert.deepEqual(high.events.filter(Buffer.isBuffer).map(p => Number(p.readBigUInt64LE(8))), [102]);
  await high.request('quality', { value: 256 });
  host.ws.send(packet(102)); host.ws.send(packet(101)); await tick();
  assert.equal(Number(high.events.filter(Buffer.isBuffer).at(-1).readBigUInt64LE(8)), 101);
  assert.equal(high.events.filter(e => e.type === 'room').at(-1).room.quality, 256);
  await host.request('stream', { epoch: 200 }); host.ws.send(packet(200)); await tick();
  const fallback = high.events.filter(e => e.type === 'room').at(-1).room;
  assert.equal(fallback.quality, 128); assert.equal(fallback.preferredQuality, 256);
  assert.equal(Number(high.events.filter(Buffer.isBuffer).at(-1).readBigUInt64LE(8)), 200);
});
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
  assert.equal((await outsider.request('rooms')).result.length, 0);
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

test('valid resume token replaces a stale live socket without consuming another user slot', async t => {
  const { connect } = await fixture(t, { maxUsers: 2 });
  const a = await connect(), b = await connect();
  const room = (await a.request('create', { name: 'Resume takeover', maxUsers: 2 })).result;
  await b.request('join', { roomId: room.id });
  const resumed = await connect({ resumeToken: b.hello.result.resumeToken });
  assert.equal(resumed.hello.result?.peerId, b.hello.result.peerId);
  await tick();
  assert(resumed.events.some(event => event.room?.id === room.id && event.room.count === 2));
  assert.equal(b.ws.readyState, WebSocket.CLOSED);
});

test('host takeover clears the stale advertised stream until sharing restarts', async t => {
  const { connect } = await fixture(t);
  const host = await connect();
  const room = (await host.request('create', { name: 'Host resume', maxUsers: 2 })).result;
  await host.request('stream', { epoch: 99 });
  const resumed = await connect({ resumeToken: host.hello.result.resumeToken });
  await tick();
  assert.equal(resumed.hello.result.peerId, host.hello.result.peerId);
  assert(resumed.events.some(event => event.room?.id === room.id && event.room.streamEpoch === 0));
});

test('coalesces public room changes for lobby clients without exposing private rooms', async t => {
  const { connect } = await fixture(t);
  const watcher = await connect(), host = await connect();
  await host.request('create', { name: 'Public room', maxUsers: 2 });
  await host.request('leave');
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(watcher.events.filter(event => event.type === 'rooms-changed').length, 1);
  watcher.events.length = 0;
  await host.request('create', { name: 'Secret room', private: true, maxUsers: 2 });
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(watcher.events.filter(event => event.type === 'rooms-changed').length, 0);
});
