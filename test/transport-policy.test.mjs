import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioRateBudget, allowAudioSend } from '../src/transport-policy.mjs';
import { readConfig } from '../src/config.mjs';

test('short receiver congestion drops audio without closing and recovers without a queue', () => {
  const closes = [];
  const ws = { bufferedAmount: 20000, close: (...args) => closes.push(args) };
  for (let time = 0; time < 4000; time += 20) assert.equal(allowAudioSend(ws, time), false);
  assert.equal(closes.length, 0);
  ws.bufferedAmount = 0;
  assert.equal(allowAudioSend(ws, 4000), true);
  ws.bufferedAmount = 20000;
  assert.equal(allowAudioSend(ws, 5000), false);
  assert.equal(allowAudioSend(ws, 14999), false);
  assert.equal(closes.length, 0);
  assert.equal(allowAudioSend(ws, 15000), false);
  assert.deepEqual(closes, [[1013, 'slow_receiver']]);
});

test('accepts TCP catch-up bursts while sustaining normal 20ms audio', () => {
  const ws = { close: () => assert.fail('legitimate audio must remain connected') };
  const budget = new AudioRateBudget(0);
  for (let i = 0; i < 150; i++) assert.equal(budget.accept(676, ws, 0), true);
  for (let time = 20; time <= 60000; time += 20) assert.equal(budget.accept(676, ws, time), true);
});

test('bounds packet and byte bursts and disconnects persistent excess', () => {
  const closes = [];
  const ws = { close: (...args) => closes.push(args) };
  const packets = new AudioRateBudget(0);
  for (let i = 0; i < 200; i++) assert.equal(packets.accept(39, ws, 0), true);
  assert.equal(packets.accept(39, ws, 0), false);
  assert.equal(closes.length, 0);
  for (let time = 20; time <= 5020; time += 20) {
    for (let i = 0; i < 3; i++) packets.accept(39, ws, time);
  }
  assert(closes.some(([code, reason]) => code === 1008 && reason === 'audio_rate_limit'));
  const bytes = new AudioRateBudget(0);
  for (let i = 0; i < 99; i++) assert.equal(bytes.accept(1311, ws, 0), true);
  assert.equal(bytes.accept(1311, ws, 0), false);
});

test('retains disconnected identities for sixty seconds by default with bounded overrides', () => {
  assert.equal(readConfig({}).reconnectMs, 60000);
  assert.equal(readConfig({ RECONNECT_SECONDS: '20' }).reconnectMs, 20000);
  assert.throws(() => readConfig({ RECONNECT_SECONDS: '121' }));
});

test('fixed 256 remains within the same bounded rate budget', () => {
  const ws = { close: () => assert.fail('fixed 256 audio must stay connected') };
  const budget = new AudioRateBudget(0);
  for (let time = 20; time <= 60000; time += 20) assert.equal(budget.accept(676, ws, time), true);
});
