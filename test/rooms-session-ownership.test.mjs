import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rooms } from '../src/rooms.mjs';
import { readConfig } from '../src/config.mjs';

test('a replaced connection cannot complete an old create request', async () => {
  const rooms = new Rooms(readConfig({}), () => {});
  const peer = { id: 'host', name: 'Host', ws: {}, roomId: null };
  const pending = rooms.create(peer, { name: 'Room', maxUsers: 3, password: 'test-room-password' });
  peer.ws = {};
  await assert.rejects(pending, /session_changed/);
  assert.equal(rooms.rooms.size, 0);
  assert.equal(rooms.creating, 0);
  assert.equal(peer.roomId, null);
  const created = await rooms.create(peer, { name: 'New room', maxUsers: 3 });
  assert.equal(peer.roomId, created.id);
});

test('a replaced connection cannot complete an old password-protected join', async () => {
  const rooms = new Rooms(readConfig({}), () => {});
  const host = { id: 'host', name: 'Host', ws: {}, roomId: null };
  const room = await rooms.create(host, { name: 'Room', maxUsers: 3, password: 'test-room-password' });
  const guest = { id: 'guest', name: 'Guest', ws: {}, roomId: null };
  const pending = rooms.join(guest, { roomId: room.id, password: 'test-room-password' });
  guest.ws = {};
  await assert.rejects(pending, /session_changed/);
  assert.equal(guest.roomId, null);
  assert.equal(rooms.rooms.get(room.id).members.size, 1);
  await rooms.join(guest, { roomId: room.id, password: 'test-room-password' });
  assert.equal(guest.roomId, room.id);
});
