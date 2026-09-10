import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnostics } from '../src/diagnostics.mjs';
test('first packet timeout, one-second sound, stall and recovery are recorded without packet logging', () => {
  let time = 0; const events = [], ws = {};
  const d = createDiagnostics({ now: () => time, write: line => { events.push(JSON.parse(line)); return true; } });
  d.open(ws); d.observe(ws, 10, 'guest'); time = 2100; d.observe(ws, 10, 'guest');
  assert(events.some(e => e.event === 'audio_first_packet_timeout'));
  for (let i = 0; i < 50; i++) { time += 20; d.count(ws, 'forwarded'); }
  time += 2100; d.observe(ws, 10, 'guest'); assert(events.some(e => e.event === 'audio_stalled'));
  d.count(ws, 'forwarded'); assert.equal(events.at(-1).event, 'audio_recovered');
  d.observe(ws, 0, 'guest'); const length = events.length; time += 2500; d.observe(ws, 0, 'guest');
  assert.equal(events.length, length); // An intentional pause is not a stall.
  d.close(ws, 1006, 'private reason with token=secret');
  assert.equal(events.at(-1).forwarded, 51); assert.equal(events.at(-1).reason, 'connection_closed');
  assert(!JSON.stringify(events).includes('secret'));
  d.count(ws, 'forwarded'); d.close(ws); assert.equal(events.length, length + 1);
});
test('rate limits diagnostic floods and isolates writer failures', () => {
  let time = 0; const events = [];
  const d = createDiagnostics({ now: () => time, write: line => { events.push(JSON.parse(line)); return true; } });
  for (let i = 0; i < 10000; i++) d.open({});
  assert.equal(events.length, 40); time += 1000; d.open({}); assert.equal(events.at(-1).omitted, 9960);
  const broken = createDiagnostics({ write: () => { throw Error('disk full'); } });
  assert.doesNotThrow(() => { const ws = {}; broken.open(ws); broken.close(ws); });
});
test('records rejected and congested audio as bounded counter summaries', () => {
  let time = 0; const events = [], ws = {};
  const d = createDiagnostics({ now: () => time, write: line => { events.push(JSON.parse(line)); return true; } });
  d.open(ws); for (let i = 0; i < 10000; i++) d.count(ws, 'congested');
  assert.equal(events.length, 1); time = 10000; d.observe(ws, 0, 'guest');
  assert.equal(events.at(-1).event, 'audio_transport_fault'); assert.equal(events.at(-1).congested, 10000);
});
