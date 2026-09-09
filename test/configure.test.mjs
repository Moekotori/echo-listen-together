import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, stat, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { configure } from '../scripts/configure.mjs';

test('configuration is private, validates the origin, and never overwrites credentials', async () => {
  const cwd = process.cwd();
  await mkdir('misc', { recursive: true });
  const dir = await mkdtemp(resolve('misc/configure-test-'));
  try {
    process.chdir(dir);
    await assert.rejects(configure('https://invalid.example'));
    await configure('192.0.2.1');
    const first = await readFile('.env', 'utf8');
    assert.match(first, /COMPOSE_FILE=compose.yaml:compose.ip.yaml/);
    assert.match(first, /ADMIN_TOKEN=[a-f0-9]{64}\n/);
    assert.equal((await stat('.env')).mode & 0o777, 0o600);
    await assert.rejects(configure('listen.example.com'), { code: 'EEXIST' });
    assert.equal(await readFile('.env', 'utf8'), first);
  } finally { process.chdir(cwd); await rm(dir, { recursive: true, force: true }); }
});
