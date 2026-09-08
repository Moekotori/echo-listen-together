import { createInterface } from 'node:readline/promises';
import { randomBytes } from 'node:crypto';
import { writeFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const rl = createInterface({ input: process.stdin, output: process.stdout });
try {
  try { await access('.env'); throw new Error('.env 已存在，请直接修改配置后运行 docker compose up -d --build；不会覆盖已有凭据。'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const domain = (await rl.question('输入已解析到此服务器的域名（不含 https://）：')).trim().toLowerCase();
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw new Error('请输入有效域名。公网部署需要可验证 TLS；IP/局域网开发见 README。');
  const admin = randomBytes(32).toString('hex');
  await writeFile('.env', `DOMAIN=${domain}\nPUBLIC_URL=wss://${domain}\nSERVER_NAME=ECHO Listening Room\nHOST=0.0.0.0\nPORT=8787\nMAX_USERS=200\nMAX_ROOMS=30\nMAX_ROOM_USERS=10\nADMIN_TOKEN=${admin}\n`, { mode: 0o600, flag: 'wx' });
  console.log('配置已写入 .env（管理员凭据仅保存在该文件）。请确认防火墙放行 TCP 80/443。');
  const result = spawnSync('docker', ['compose', 'up', '-d', '--build'], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Docker 启动未成功。安装 Docker Compose 后重试 docker compose up -d --build。');
  let healthy = false;
  for (let i = 0; i < 12; i++) {
    try { const res = await fetch(`https://${domain}/health`, { signal: AbortSignal.timeout(4000) }); healthy = res.ok && (await res.json()).protocol === 1; } catch {}
    if (healthy) break;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  console.log(`ECHO 连接地址：wss://${domain}`);
  console.log(`连接码：echo-listen:${Buffer.from(JSON.stringify({ server: `wss://${domain}` })).toString('base64url')}`);
  if (!healthy) throw new Error('容器已启动，但公网 HTTPS 检查未通过。请检查 DNS、防火墙和 docker compose logs gateway，尚不能视为部署完成。');
  console.log('公网 HTTPS 健康检查通过。');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { rl.close(); }
