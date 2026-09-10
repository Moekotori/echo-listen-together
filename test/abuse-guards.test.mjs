import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseControl, BinaryIngressBudget, createWorkBudget, sendControl } from '../src/abuse-guards.mjs';

test('bounds JSON before dispatch and handles escaped brackets without false positives', () => {
  const normal = { id: '1', type: 'chat', data: { text: '"[\\]"'.repeat(50) } };
  assert.deepEqual(parseControl(Buffer.from(JSON.stringify(normal))), normal);
  for (const input of ['null', '[]', '{', JSON.stringify({ id: '1', type: 'chat', data: [] }),
    JSON.stringify({ id: '', type: 'chat' }), '{"id":"1","type":"chat","data":' + '['.repeat(40) + '0' + ']'.repeat(40) + '}',
    JSON.stringify({ id: '1', type: 'chat', data: { text: 'x'.repeat(9000) } })]) assert.throws(() => parseControl(Buffer.from(input)));
  assert.throws(() => parseControl(Buffer.alloc(49153)));
  assert.equal(parseControl(Buffer.from(JSON.stringify({ id: '1', type: 'metadata', data: { text: 'x'.repeat(30000) } }))).type, 'metadata');
});

test('binary budget includes stale packets but permits normal multi-quality catchup', () => {
  const budget = new BinaryIngressBudget(0);
  for (let i = 0; i < 600; i++) assert.equal(budget.accept(1311, 0), true);
  let accepted = 0;
  while (budget.accept(1311, 0)) accepted++;
  assert(accepted < 1000);
  assert.equal(budget.accept(1311, 1000), true);
  assert.equal(budget.accept(16384, 1000), false);
  assert.equal(budget.accept(1, 1000), false);
});

test('password work has no waiting queue and always releases its concurrency slot', async () => {
  const run = createWorkBudget(2);
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const a = run(() => wait), b = run(() => wait);
  let called = false;
  await assert.rejects(run(() => { called = true; }), /server_busy/);
  assert.equal(called, false);
  release(); await Promise.all([a, b]);
  await assert.rejects(run(() => { throw new Error('failed'); }), /failed/);
  assert.equal(await run(() => 42), 42);
});

test('backpressure applies to replies and room broadcasts without building another queue', () => {
  let writes = 0, stopped = 0;
  const ws = { readyState: 1, bufferedAmount: 65537, send: () => writes++, terminate: () => stopped++ };
  assert.equal(sendControl(ws, { error: 'request_busy' }), false);
  assert.equal(writes, 0); assert.equal(stopped, 1);
  ws.bufferedAmount = 0;
  assert.equal(sendControl(ws, { text: 'x'.repeat(262145) }), false);
  assert.equal(writes, 0);
  assert.equal(sendControl(ws, { id: '1', result: true }), true);
  assert.equal(writes, 1);
});
