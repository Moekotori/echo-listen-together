import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rooms } from '../src/rooms.mjs';
import { readConfig } from '../src/config.mjs';

async function fixture(t, overrides = {}, privateRoom = false) {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  let changes = 0;
  const rooms = new Rooms({ ...readConfig({}), ...overrides }, () => {}, () => changes++);
  const host = { id: 'host', name: 'Host', ws: {}, roomId: null, disconnectedAt: 0 };
  const created = await rooms.create(host, { name: 'Room', maxUsers: 3, private: privateRoom });
  return { rooms, host, room: rooms.rooms.get(created.id), changes: () => changes };
}

test('reclaims an offline room exactly at timeout and clears retained references', async t => {
  const { rooms, host, room, changes } = await fixture(t);
  room.track = { title: 'Old track' }; room.title = 'Old title'; room.streamEpoch = 42;
  room.invitations.set('old-invite', 300000);
  host.ws = null;
  rooms.sweep();
  t.mock.timers.tick(59999); rooms.sweep();
  assert.equal(rooms.rooms.size, 1);
  t.mock.timers.tick(1); rooms.sweep();
  assert.equal(rooms.rooms.size, 0);
  assert.equal(host.roomId, null);
  assert.equal(room.members.size, 0);
  assert.equal(room.invitations.size, 0);
  assert.equal(room.track, null);
  assert.equal(room.streamEpoch, 0);
  assert.equal(changes(), 2);
  rooms.sweep(); assert.equal(changes(), 2);
});

test('does not shorten reconnect grace when empty timeout is smaller', async t => {
  const { rooms, host } = await fixture(t, { emptyRoomMs: 1000, reconnectMs: 60000 });
  host.ws = null;
  t.mock.timers.tick(1000); rooms.sweep(); assert.equal(rooms.rooms.size, 1);
  t.mock.timers.tick(59000); rooms.sweep(); assert.equal(rooms.rooms.size, 0);
});

test('an online host with no listeners or audio is never an empty room', async t => {
  const { rooms, room } = await fixture(t);
  t.mock.timers.tick(3600000); rooms.sweep();
  assert.equal(rooms.rooms.size, 1);
  assert.equal(room.emptySince, null);
});

test('reconnection cancels expiry and a later disconnect starts a fresh interval', async t => {
  const { rooms, host, room } = await fixture(t);
  host.ws = null; rooms.sweep();
  t.mock.timers.tick(59000); host.ws = {}; rooms.sweep();
  assert.equal(room.emptySince, null);
  t.mock.timers.tick(1000); host.ws = null; host.disconnectedAt = Date.now(); rooms.sweep();
  t.mock.timers.tick(59999); rooms.sweep(); assert.equal(rooms.rooms.size, 1);
  t.mock.timers.tick(1); rooms.sweep(); assert.equal(rooms.rooms.size, 0);
});

test('counts absence from the final member disconnect, even between sweeps', async t => {
  const { rooms, host, room } = await fixture(t);
  const guest = { id: 'guest', name: 'Guest', ws: {}, roomId: null, disconnectedAt: 0 };
  await rooms.join(guest, { roomId: room.id });
  host.ws = null; rooms.sweep();
  t.mock.timers.tick(59000); guest.ws = null; guest.disconnectedAt = Date.now();
  t.mock.timers.tick(1000); rooms.sweep(); assert.equal(rooms.rooms.size, 1);
  t.mock.timers.tick(59000); rooms.sweep();
  assert.equal(rooms.rooms.size, 0); assert.equal(guest.roomId, null);
});

test('private room cleanup does not send public lobby notifications', async t => {
  const { rooms, host, changes } = await fixture(t, {}, true);
  host.ws = null; t.mock.timers.tick(60000); rooms.sweep();
  assert.equal(rooms.rooms.size, 0); assert.equal(changes(), 0);
});

test('an actually empty room respects its own timeout, including a zero timestamp', async t => {
  const { rooms, room } = await fixture(t, { emptyRoomMs: 1000 });
  room.members.clear(); room.emptySince = 0;
  t.mock.timers.tick(999); rooms.sweep(); assert.equal(rooms.rooms.size, 1);
  t.mock.timers.tick(1); rooms.sweep(); assert.equal(rooms.rooms.size, 0);
});
