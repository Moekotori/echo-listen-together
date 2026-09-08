import { readConfig } from './config.mjs';
import { createListenServer } from './server.mjs';
const config = readConfig();
const server = createListenServer(config);
await server.listen();
console.log(JSON.stringify({ event: 'ready', name: config.name, connect: config.publicUrl, maxUsers: config.maxUsers, maxRooms: config.maxRooms }));
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (stopping) return; stopping = true; await server.close(); });
