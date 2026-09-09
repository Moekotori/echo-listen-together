import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';

export async function configure(domain) {
  domain = domain.trim().toLowerCase();
  const ip = isIP(domain) === 4;
  if (!ip && !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw new Error('Invalid domain / IPv4');
  await writeFile('.env', `COMPOSE_PROJECT_NAME=echo-listen\nCOMPOSE_FILE=${ip ? 'compose.yaml:compose.ip.yaml' : 'compose.yaml'}\nDOMAIN=${domain}\nPUBLIC_URL=wss://${domain}\nSERVER_NAME=ECHO Listening Room\nHOST=0.0.0.0\nPORT=8787\nMAX_USERS=200\nMAX_ROOMS=30\nMAX_ROOM_USERS=10\nADMIN_TOKEN=${randomBytes(32).toString('hex')}\n`, { mode: 0o600, flag: 'wx' });
}
