import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/config.mjs';
import { deploymentInfo } from '../src/deployment-info.mjs';

test('deployment report explains credentials and limits without exposing secrets', () => {
  const config = readConfig({ PUBLIC_URL: 'wss://listen.example.com', SERVER_PASSWORD: 'password-secret', ADMIN_TOKEN: 'admin-secret', MAX_ROOM_USERS: '8' });
  const output = deploymentInfo(config);
  assert.ok(!output.includes('password-secret'));
  assert.ok(!output.includes('admin-secret'));
  assert.match(output, /尚未验证/);
  assert.match(output, /每房上限：8 人/);
  assert.match(output, /服务器密码：已设置/);
  const code = output.match(/连接码：echo-listen:(\S+)/)[1];
  assert.deepEqual(JSON.parse(Buffer.from(code, 'base64url')), { server: config.publicUrl });
  assert.match(deploymentInfo(readConfig({}), 'failed'), /服务器密码：未设置/);
  assert.match(deploymentInfo(config, 'passed'), /从当前机器访问/);
});
