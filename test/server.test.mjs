import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { readConfig } from '../src/config.mjs';
import { createListenServer } from '../src/server.mjs';
async function fixture(t, overrides = {}, timing = {}) {
  const server = createListenServer({ ...readConfig({ PORT: '0', HOST: '127.0.0.1' }), ...overrides }, timing);
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

test('clock deltas stay small, follow selected epochs and never rebroadcast lyrics', async t => {
  const { connect } = await fixture(t);
  const host = await connect(), guest = await connect(), outside = await connect();
  assert.equal(host.hello.result.capabilities.mediaClock, true);
  const room = (await host.request('create', { name: 'Clock delta', maxUsers: 3 })).result;
  await guest.request('join', { roomId: room.id });
  await host.request('stream', { epoch: 600, title: 'Song', multiQuality: true });
  await host.request('metadata', { epoch: 600, track: { title: 'Song', cover: null, lyrics: { lines: [{ timeMs: 0, text: 'Kept once' }] } } });
  await guest.request('quality', { value: 320 }); await tick();
  const previousSnapshots = guest.events.filter(e => e.type === 'room').length;
  const clock = { mediaAnchors: [{ streamFrame: 48000, mediaAnchorSeconds: 20, playbackRate: 1.5 }] };
  assert.equal((await guest.request('clock', { epoch: 600, clock })).error, 'host_required');
  assert.equal((await host.request('clock', { epoch: 599, clock })).error, 'stream_changed');
  assert.equal((await host.request('clock', { epoch: 600, clock })).result, true); await tick();
  const event = guest.events.filter(e => e.type === 'clock').at(-1);
  assert.equal(event.epoch, 602); assert.equal(event.roomId, room.id);
  assert.equal(event.clock.mediaAnchors[0].playbackRate, 1.5);
  assert.equal(Buffer.byteLength(JSON.stringify(event)) < 512, true);
  assert.equal(guest.events.filter(e => e.type === 'room').length, previousSnapshots);
  assert.equal(outside.events.filter(e => e.type === 'clock').length, 0);
  const updated = { mediaAnchors: [{ streamFrame: 96000, mediaAnchorSeconds: 22, playbackRate: 1.5 }] };
  assert.equal((await host.request('clock', { epoch: 600, clock: updated })).error, 'clock_rate_limit');
  const late = await connect(); const joined = (await late.request('join', { roomId: room.id })).result;
  assert.equal(joined.track.clock.mediaAnchors[0].mediaAnchorSeconds, 20);
  assert.equal(joined.track.lyrics.lines[0].text, 'Kept once');
  assert.equal(joined.track.technical.playbackRate, 1.5);
});

test('combined features retain bounded lyrics, clocks and technical metadata through pause and enforce typing isolation', async t => {
  const { server, connect } = await fixture(t);
  const host = await connect(), guest = await connect(), other = await connect();
  for (const capability of ['trackMetadata', 'typing', 'programmeState', 'transferHost', 'audioQualities'])
    assert.equal(host.hello.result.capabilities[capability], true);
  const room = (await host.request('create', { name: 'Combined programme', maxUsers: 3 })).result;
  await guest.request('join', { roomId: room.id });
  await host.request('stream', { epoch: 800, title: 'Song' });
  const track = { title: 'Song', artist: 'Artist', album: 'Album', cover: null,
    technical: { bpm: 128, playbackRate: 1.5, codec: 'FLAC', sampleRate: 96000, bitDepth: 24, bitrate: 1500000, path: 'never-share' },
    clock: { mediaAnchors: [{ streamFrame: 0, mediaAnchorSeconds: 30, playbackRate: 1.5 }] },
    lyrics: { provider: 'local', lines: [{ timeMs: 30000, text: 'Line', translation: 'Translated', romanization: 'Romanized', words: [{ text: 'Line', startMs: 30000, endMs: 31000 }] }] } };
  assert.equal((await host.request('metadata', { epoch: 800, track })).result, true);
  await tick();
  const received = guest.events.filter(e => e.type === 'room').at(-1).room.track;
  assert.equal(received.technical.bpm, 128); assert.equal(received.technical.path, undefined);
  assert.equal(received.lyrics.lines[0].translation, 'Translated');
  assert.equal(received.lyrics.lines[0].words.length, 1);
  assert.equal(received.clock.mediaAnchors[0].playbackRate, 1.5);
  await host.request('stream', { epoch: 0, title: 'Song', programmeState: 'paused' }); await tick();
  assert.deepEqual(guest.events.filter(e => e.type === 'room').at(-1).room.track, received);
  assert.equal((await guest.request('typing', { roomId: room.id, active: true })).result, true); await tick();
  assert.equal(host.events.filter(e => e.type === 'typing').at(-1).presence.senderId, guest.hello.result.peerId);
  assert.equal(other.events.filter(e => e.type === 'typing').length, 0);
  assert.equal((await guest.request('typing', { roomId: 'wrong-room', active: true })).error, 'invalid_typing');
  assert.equal((await guest.request('typing', { roomId: room.id, active: false })).result, true);
  assert.equal(server.rooms.rooms.get(room.id).members.size, 2);
});

test('host transfer invalidates the old programme and invites without dropping members', async t => {
  const { server, connect } = await fixture(t);
  const host = await connect(), guest = await connect(), outside = await connect();
  const room = (await host.request('create', { name: 'Transfer', maxUsers: 3 })).result;
  await guest.request('join', { roomId: room.id });
  const invitation = (await host.request('invite')).result.invitation;
  await host.request('stream', { epoch: 900, title: 'Old programme' });
  assert.equal((await guest.request('transferHost', { memberId: host.hello.result.peerId })).error, 'host_required');
  assert.equal((await host.request('transferHost', { memberId: outside.hello.result.peerId })).error, 'member_unavailable');
  assert.equal((await host.request('transferHost', { memberId: guest.hello.result.peerId })).result, true);
  await tick();
  const transferred = host.events.filter(e => e.type === 'room').at(-1).room;
  assert.equal(transferred.hostId, guest.hello.result.peerId); assert.equal(transferred.count, 2);
  assert.equal(transferred.programmeState, 'stopped'); assert.equal(transferred.streamEpoch, 0);
  assert.equal(transferred.title, ''); assert.equal(transferred.track, null);
  assert.equal(server.rooms.rooms.get(room.id).invitations.has(invitation), false);
  assert.equal((await host.request('stream', { epoch: 901 })).error, 'host_required');
  const before = host.events.filter(Buffer.isBuffer).length;
  guest.ws.send(packet(900)); await tick(); assert.equal(host.events.filter(Buffer.isBuffer).length, before);
  await guest.request('stream', { epoch: 1000, title: 'New programme' });
  guest.ws.send(packet(1000)); await tick(); assert.equal(host.events.filter(Buffer.isBuffer).length, before + 1);
});
test('host pause retains programme, silences relay, and reaches late joiners until resume', async t => {
  const { server, connect } = await fixture(t);
  const host = await connect(), guest = await connect(), late = await connect();
  assert.equal(host.hello.result.capabilities.programmeState, true);
  const room = (await host.request('create', { name: 'Pause', maxUsers: 3 })).result;
  await guest.request('join', { roomId: room.id });
  await host.request('stream', { epoch: 123, title: 'Song', programmeState: 'playing' });
  const track = { title: 'Song', artist: 'Artist', album: 'Album', cover: null };
  await host.request('metadata', { epoch: 123, track });
  const retainedTrack = server.rooms.rooms.get(room.id).track;
  assert.equal((await guest.request('stream', { epoch: 0, programmeState: 'paused' })).error, 'host_required');
  assert.equal((await host.request('stream', { epoch: 123, programmeState: 'paused' })).error, 'invalid_programme_state');
  assert.equal((await host.request('stream', { epoch: 0, title: 'Song', programmeState: 'paused' })).result, true);
  await tick();
  const paused = guest.events.filter(e => e.type === 'room').at(-1).room;
  assert.equal(paused.programmeState, 'paused'); assert.equal(paused.streamEpoch, 0);
  assert.equal(paused.title, 'Song'); assert.equal(paused.track.artist, 'Artist');
  assert.equal(server.rooms.rooms.get(room.id).track, retainedTrack);
  const joined = (await late.request('join', { roomId: room.id })).result;
  assert.equal(joined.programmeState, 'paused'); assert.equal(joined.track.title, 'Song');
  host.ws.send(packet(123)); await tick();
  assert.equal(guest.events.filter(Buffer.isBuffer).length, 0);
  assert.equal((await host.request('stream', { epoch: 124, title: 'Song', programmeState: 'playing' })).result, true);
  host.ws.send(packet(123)); host.ws.send(packet(124)); await tick();
  assert.equal(guest.events.filter(Buffer.isBuffer).length, 1);
  assert.equal(guest.events.filter(e => e.type === 'room').at(-1).room.programmeState, 'playing');
  await host.request('stream', { epoch: 0, title: 'Song', programmeState: 'paused' });
  await host.request('stream', { epoch: 0, programmeState: 'stopped' }); await tick();
  const stopped = guest.events.filter(e => e.type === 'room').at(-1).room;
  assert.equal(stopped.programmeState, 'stopped'); assert.equal(stopped.title, ''); assert.equal(stopped.track, null);
});

test('host disconnect clears paused state while legacy stream requests still work', async t => {
  const { connect } = await fixture(t);
  const host = await connect(), guest = await connect();
  const room = (await host.request('create', { name: 'Pause disconnect', maxUsers: 2 })).result;
  await guest.request('join', { roomId: room.id });
  await host.request('stream', { epoch: 123, title: 'Legacy song' });
  await host.request('stream', { epoch: 0, title: 'Legacy song', programmeState: 'paused' });
  host.ws.close(); await once(host.ws, 'close'); await tick();
  const stopped = guest.events.filter(e => e.type === 'room').at(-1).room;
  assert.equal(stopped.programmeState, 'stopped'); assert.equal(stopped.title, '');
  assert.equal(stopped.streamEpoch, 0); assert.equal(stopped.track, null);
});

function packet(epoch) {
  const p = Buffer.alloc(39); p.write('ELTA'); p[4] = 1; p.writeUInt16LE(36, 6); p.writeBigUInt64LE(BigInt(epoch), 8);
  p.writeUInt32LE(48000, 28); p.writeUInt16LE(3, 32); p[34] = 2; p[35] = 20; p.set([0xf8, 0xff, 0xfe], 36); return p;
}

test('real sockets retain membership through a catch-up burst and temporary receiver congestion', async t => {
  const { server, connect } = await fixture(t);
  const host = await connect(), guest = await connect();
  const room = (await host.request('create', { name: 'Congestion regression', maxUsers: 2 })).result;
  await guest.request('join', { roomId: room.id });
  await host.request('stream', { epoch: 777 });
  for (let i = 0; i < 150; i++) host.ws.send(packet(777));
  await tick();
  assert.equal(host.ws.readyState, WebSocket.OPEN);
  assert.equal(guest.events.filter(Buffer.isBuffer).length, 150);
  const receiver = server.peers.get(guest.hello.result.resumeToken).ws;
  Object.defineProperty(receiver, 'bufferedAmount', { configurable: true, get: () => 20000 });
  host.ws.send(packet(777)); await tick();
  assert.equal(guest.ws.readyState, WebSocket.OPEN);
  assert.equal(guest.events.filter(Buffer.isBuffer).length, 150);
  delete receiver.bufferedAmount;
  host.ws.send(packet(777)); await tick();
  assert.equal(guest.events.filter(Buffer.isBuffer).length, 151);
  assert.equal((await guest.request('rooms')).result[0].count, 2);
});

test('a guest resumes its room after the former twenty-second retention window', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const { connect } = await fixture(t);
  const host = await connect(), guest = await connect();
  const room = (await host.request('create', { name: 'Resume regression', maxUsers: 2 })).result;
  await guest.request('join', { roomId: room.id });
  guest.ws.close(); await once(guest.ws, 'close'); await tick();
  t.mock.timers.tick(25000);
  const resumed = await connect({ resumeToken: guest.hello.result.resumeToken });
  await tick();
  assert.equal(resumed.hello.result.peerId, guest.hello.result.peerId);
  assert(resumed.events.some(event => event.room?.id === room.id && event.room.count === 2));
});

test('heartbeat uses elapsed time, tolerates a missed pong and ignores wall-clock jumps', async t => {
  let now = 0;
  const { server, connect } = await fixture(t, {}, { now: () => now });
  const guest = await connect();
  const ws = server.peers.get(guest.hello.result.resumeToken).ws;
  t.mock.method(Date, 'now', () => 9999999999999);
  assert.equal(ws.isAlive(), true);
  now = 20000; assert.equal(ws.isAlive(), true);
  ws.emit('pong');
  now = 54000; assert.equal(ws.isAlive(), true);
  now = 55000; assert.equal(ws.isAlive(), false);
});

test('valid host audio renews liveness, invalid and unauthorized packets do not', async t => {
  let now = 0;
  const { server, connect } = await fixture(t, {}, { now: () => now });
  const host = await connect(), guest = await connect();
  const room = (await host.request('create', { name: 'Liveness', maxUsers: 2 })).result;
  await guest.request('join', { roomId: room.id });
  await host.request('stream', { epoch: 123 });
  const hostSocket = server.peers.get(host.hello.result.resumeToken).ws;
  const guestSocket = server.peers.get(guest.hello.result.resumeToken).ws;
  now = 34000;
  host.ws.send(packet(123)); guest.ws.send(packet(123)); await tick();
  now = 36000;
  assert.equal(hostSocket.isAlive(), true);
  assert.equal(guestSocket.isAlive(), false);
  now = 68000;
  host.ws.send(packet(999)); await tick();
  now = 69000;
  assert.equal(hostSocket.isAlive(), false);
});

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

test('Steam identity is bounded display metadata visible only to room members', async t => {
  const { connect } = await fixture(t);
  const host = await connect({ steamId: '76561198000000001' });
  const guest = await connect({ steamId: 'invalid' });
  const room = (await host.request('create', { name: 'Identity test', maxUsers: 3 })).result;
  assert.equal(room.members[0].steamId, '76561198000000001');
  const listing = (await guest.request('rooms')).result;
  assert.equal(listing[0].members, undefined);
  const joined = (await guest.request('join', { roomId: room.id })).result;
  assert.equal(joined.members[0].steamId, '76561198000000001');
  assert.equal(joined.members[1].steamId, undefined);
});

test('room broadcasts share only the current snapshot and later updates are fresh', async t => {
  const { server, connect } = await fixture(t);
  const host = await connect(), guest = await connect();
  const created = (await host.request('create', { name: 'Snapshot', maxUsers: 2 })).result;
  await guest.request('join', { roomId: created.id });
  const room = server.rooms.rooms.get(created.id);
  const messages = [];
  const notify = server.rooms.notify;
  server.rooms.notify = (peer, message) => { messages.push(message); notify(peer, message); };
  server.rooms.broadcast(room);
  assert.equal(messages.length, 2);
  assert.notEqual(messages[0], messages[1]);
  assert.equal(messages[0].room.members, messages[1].room.members);
  assert.equal(messages[0].room.track, messages[1].room.track);
  const previous = messages[0];
  room.title = 'Updated';
  messages.length = 0;
  server.rooms.broadcast(room);
  assert.notEqual(messages[0], previous);
  assert.equal(previous.room.title, '');
  assert.equal(messages[0].room.title, 'Updated');
  server.rooms.notify = notify;
});

test('artwork belongs to the current host epoch and is available to late joiners only inside the room', async t => {
 const {connect}=await fixture(t);const host=await connect(),guest=await connect(),late=await connect();
 assert.equal(host.hello.result.capabilities.trackArtwork,true);
 assert.equal(host.hello.result.capabilities.trackMetadata,true);
 const room=(await host.request('create',{name:'Artwork',maxUsers:3})).result;
 await guest.request('join',{roomId:room.id});await host.request('stream',{epoch:123,title:'Song'});
 const b=Buffer.alloc(30);b.write('RIFF');b.write('WEBPVP8 ',8);b.set([0x9d,1,0x2a],23);b.writeUInt16LE(96,26);b.writeUInt16LE(96,28);
 const track={title:'Song',artist:'Artist',album:'Album',cover:b.toString('base64'),
   lyrics:{lines:[{timeMs:1000,text:'Shared line',words:[{text:'Shared',startMs:1000,endMs:1400}]}]},
   clock:{mediaAnchors:[{streamFrame:0,mediaAnchorSeconds:60,playbackRate:1}]}};
 assert.equal((await guest.request('metadata',{epoch:123,track})).error,'host_required');
 assert.equal((await host.request('metadata',{epoch:122,track})).error,'stream_changed');
 assert.equal((await host.request('metadata',{epoch:123,track})).result,true);
 const joined=(await late.request('join',{roomId:room.id})).result;
 assert.equal(joined.track.cover,track.cover);assert.equal(joined.track.lyrics.lines[0].text,'Shared line');
 assert.equal(joined.track.clock.mediaAnchors[0].mediaAnchorSeconds,60);
 assert.equal((await guest.request('rooms')).result[0].track,undefined);
 host.ws.send(packet(123));await tick();assert.equal(guest.events.filter(Buffer.isBuffer).length,1);
 await host.request('stream',{epoch:124,title:'New song'});await tick();
 assert.equal(guest.events.filter(e=>e.type==='room').at(-1).room.track,null);
 assert.equal((await host.request('metadata',{epoch:123,track})).error,'stream_changed');
 await host.request('metadata',{epoch:124,track});
 const resumed=await connect({resumeToken:host.hello.result.resumeToken});await tick();
 assert.equal(resumed.events.filter(e=>e.type==='room').at(-1).room.track,null);
});

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
  for (const epoch of [100, 101, 102, 103]) host.ws.send(qualityPacket(epoch));
  await tick();
  assert.deepEqual(standard.events.filter(Buffer.isBuffer).map(p => Number(p.readBigUInt64LE(8))), [100]);
  assert.deepEqual(high.events.filter(Buffer.isBuffer).map(p => Number(p.readBigUInt64LE(8))), [102]);
  await high.request('quality', { value: 256 });
  host.ws.send(qualityPacket(102)); host.ws.send(qualityPacket(101)); await tick();
  assert.equal(Number(high.events.filter(Buffer.isBuffer).at(-1).readBigUInt64LE(8)), 101);
  assert.equal(high.events.filter(e => e.type === 'room').at(-1).room.quality, 256);
  await host.request('stream', { epoch: 200 }); host.ws.send(qualityPacket(200)); await tick();
  const fallback = high.events.filter(e => e.type === 'room').at(-1).room;
  assert.equal(fallback.quality, 128); assert.equal(fallback.preferredQuality, 256);
  assert.equal(Number(high.events.filter(Buffer.isBuffer).at(-1).readBigUInt64LE(8)), 200);
});
function qualityPacket(epoch) {
  const p = Buffer.alloc(39); p.write('ELTA'); p[4] = 1; p.writeUInt16LE(36, 6); p.writeBigUInt64LE(BigInt(epoch), 8);
  p.writeUInt32LE(48000, 28); p.writeUInt16LE(3, 32); p[34] = 2; p[35] = 20; p.set([0xf8, 0xff, 0xfe], 36); return p;
}

test('host defaults change actual packets while explicit listener choices remain independent', async t => {
 const {connect}=await fixture(t);const host=await connect(),guest=await connect(),custom=await connect();
 const room=(await host.request('create',{name:'Default quality',maxUsers:3})).result;
 await guest.request('join',{roomId:room.id});await custom.request('join',{roomId:room.id});
 await custom.request('quality',{value:128});await host.request('stream',{epoch:300,multiQuality:true});
 for(const [value,offset] of [[320,2],[256,1],[128,0]]){
  assert.equal((await host.request('quality',{value})).result,true);guest.events.length=0;custom.events.length=0;
  for(let i=0;i<3;i++)host.ws.send(qualityPacket(300+i));await tick();
  assert.deepEqual(guest.events.filter(Buffer.isBuffer).map(b=>Number(b.readBigUInt64LE(8))),[300+offset]);
  assert.deepEqual(custom.events.filter(Buffer.isBuffer).map(b=>Number(b.readBigUInt64LE(8))),[300]);
 }
});

test('hostile envelopes disconnect only their sender and healthy rooms keep working', async t => {
  const { connect } = await fixture(t);
  const healthy = await connect();
  for (const payload of ['null', '[]', '{"id":"evil","type":"chat","data":' + '['.repeat(40) + '0' + ']'.repeat(40) + '}',
    JSON.stringify({ id: 'evil', type: 'chat', data: { text: 'x'.repeat(9000) } }), 'x'.repeat(65537)]) {
    const attacker = await connect();
    attacker.ws.on('error', () => {});
    const closed = new Promise(resolve => attacker.ws.once('close', resolve));
    attacker.ws.send(payload); await closed;
    assert(Array.isArray((await healthy.request('rooms')).result));
  }
});
test('malformed and stale binary floods are bounded without affecting another connection', async t => {
  const { connect } = await fixture(t);
  const healthy = await connect();
  for (const malformed of [true, false]) {
    const attacker = await connect();
    const closed = new Promise(resolve => attacker.ws.once('close', resolve));
    const data = packet(999);
    if (malformed) data[0] = 0;
    for (let i = 0; i < (malformed ? 32 : 1500); i++) attacker.ws.send(data);
    await closed;
    assert(Array.isArray((await healthy.request('rooms')).result));
  }
});

test('late join response includes the selected default epoch, not the base rendition', async t => {
 const {connect}=await fixture(t);const host=await connect(),guest=await connect();
 const room=(await host.request('create',{name:'Late quality',maxUsers:2})).result;
 await host.request('quality',{value:320});await host.request('stream',{epoch:400,multiQuality:true});
 const joined=(await guest.request('join',{roomId:room.id})).result;
 assert.equal(joined.quality,320);assert.equal(joined.streamEpoch,402);
});
