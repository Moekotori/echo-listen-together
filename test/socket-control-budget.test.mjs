import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowAudioSend } from '../src/transport-policy.mjs';
import { sendControl } from '../src/abuse-guards.mjs';
import { queuedControlBytes, reserveControlBytes } from '../src/socket-control-budget.mjs';

test('a queued lyric snapshot does not count as queued audio', () => {
  let complete;
  const ws = { readyState: 1, bufferedAmount: 0, terminate: () => assert.fail('valid metadata must stay connected'),
    send(data, callback) { this.bufferedAmount += Buffer.byteLength(data); complete = callback; } };
  assert.equal(sendControl(ws, { type: 'room', room: { track: { lyrics: 'x'.repeat(30000) } } }), true);
  assert(ws.bufferedAmount > 16384);
  assert.equal(allowAudioSend(ws, 0), true);
  ws.bufferedAmount += 17000;
  assert.equal(allowAudioSend(ws, 20), false);
  complete(); complete();
  assert.equal(queuedControlBytes(ws), 0);
});

test('control accounting does not weaken the total ceiling or retain failed writes', () => {
  const ws = { bufferedAmount: 70000, close() {} };
  const release = reserveControlBytes(ws, 70000);
  assert.equal(allowAudioSend(ws, 0), false); release();
  assert.equal(reserveControlBytes(ws, 262145), null);
  let closed = false;
  const failed = { readyState: 1, bufferedAmount: 0, send() { throw Error('closed'); }, terminate() { closed = true; } };
  assert.equal(sendControl(failed, { type: 'room', room: null }), false);
  assert.equal(queuedControlBytes(failed), 0); assert(closed);
});
