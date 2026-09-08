import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { token, text, secretEqual } from './security.mjs';
import { Rooms } from './rooms.mjs';
import { relayAudio } from './relay.mjs';
export function createListenServer(config) {
  const peers = new Map(), connections = new Set();
  const send = (peer, message) => {
    if (peer.ws?.readyState !== 1) return;
    if (peer.ws.bufferedAmount > 65536) { peer.ws.close(1013, 'slow_receiver'); return; }
    peer.ws.send(JSON.stringify(message));
  };
  const rooms = new Rooms(config, send);
  const http = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    if (req.url === '/health') { res.end(JSON.stringify({ ok: true, protocol: 1 })); return; }
    if (req.url === '/admin/status' && config.adminToken && secretEqual(req.headers.authorization, `Bearer ${config.adminToken}`)) {
      res.end(JSON.stringify({ users: peers.size, rooms: rooms.rooms.size, connections: connections.size })); return;
    }
    res.statusCode = 404; res.end('{"error":"not_found"}');
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
  http.on('upgrade', (req, socket, head) => {
    if (req.url !== '/v1/socket' || connections.size >= config.maxUsers + 32 || req.headers.origin) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    connections.add(ws); let peer = null, busy = false, count = 0, windowAt = Date.now(); let alive = true;
    const helloTimer = setTimeout(() => { if (!peer) ws.close(1008, 'hello_timeout'); }, 5000);
    ws.on('pong', () => { alive = true; }); ws.on('error', () => {});
    ws.isAlive = () => { if (!alive) return false; alive = false; return true; };
    ws.on('message', async (raw, binary) => {
      if (binary) { if (peer?.ws === ws) relayAudio(peer, raw, rooms); return; }
      if (Date.now() - windowAt > 10000) { windowAt = Date.now(); count = 0; }
      if (++count > 40) { ws.close(1008, 'control_rate_limit'); return; }
      let message;
      try { message = JSON.parse(raw.toString()); } catch { ws.close(1008, 'invalid_json'); return; }
      const id = message?.id;
      if (!message || typeof message !== 'object' || typeof id !== 'string' || id.length > 64) { ws.close(1008, 'invalid_request'); return; }
      const reply = value => { if (ws.readyState === 1) ws.send(JSON.stringify({ id, ...value })); };
      if (busy) { reply({ error: 'request_busy' }); return; }
      busy = true;
      try {
        const input = message.data || {};
        if (message.type === 'hello') {
          if (peer) throw new Error('already_connected');
          if (input.protocol !== 1) throw new Error('protocol_mismatch');
          if (config.serverPassword && !secretEqual(input.password, config.serverPassword)) throw new Error('server_password_required');
          const resumed = typeof input.resumeToken === 'string' ? peers.get(input.resumeToken) : null;
          const replacedSocket = resumed?.ws;
          // TLS proxies can keep the old upstream socket open briefly after
          // a client disconnects. Possession of the resume token authorizes
          // replacing that socket without losing the room or consuming capacity.
          if (resumed && (resumed.ws || Date.now() - resumed.disconnectedAt < config.reconnectMs)) peer = resumed;
          else {
            if (peers.size >= config.maxUsers) throw new Error('server_full');
            peer = { id: token(), resumeToken: token(), name: text(input.name, 48), roomId: null, ws: null, disconnectedAt: 0, audioWindow: 0, audioPackets: 0, audioBytes: 0 };
            peers.set(peer.resumeToken, peer);
          }
          peer.ws = ws; clearTimeout(helloTimer);
          if (replacedSocket && replacedSocket !== ws) replacedSocket.terminate();
          reply({ result: { protocol: 1, peerId: peer.id, resumeToken: peer.resumeToken, name: config.name,
            limits: { maxUsers: config.maxUsers, maxRooms: config.maxRooms, maxRoomUsers: config.maxRoomUsers } } });
          if (peer.roomId) {
            const room = rooms.rooms.get(peer.roomId);
            if (room) {
              // The reconnected host must explicitly authorize a fresh stream.
              if (peer === resumed && room.hostId === peer.id) room.streamEpoch = 0;
              rooms.broadcast(room);
            }
          }
          return;
        }
        if (!peer || peer.ws !== ws) throw new Error('hello_required');
        let result;
        switch (message.type) {
          case 'rooms': result = rooms.list(); break;
          case 'create': result = await rooms.create(peer, input); break;
          case 'join': result = await rooms.join(peer, input); break;
          case 'leave': rooms.leave(peer); send(peer, { type: 'room', room: null }); result = true; break;
          case 'invite': result = rooms.invite(peer); break;
          case 'revokeInvites': rooms.owned(peer).invitations.clear(); result = true; break;
          case 'stream': result = rooms.stream(peer, input); break;
          default: throw new Error('unknown_request');
        }
        reply({ result });
      } catch (error) { reply({ error: /^[a-z_]+$/.test(error.message) ? error.message : 'invalid_request' }); }
      finally { busy = false; }
    });
    ws.on('close', () => {
      clearTimeout(helloTimer); connections.delete(ws);
      if (peer?.ws === ws) {
        peer.ws = null; peer.disconnectedAt = Date.now();
        const room = rooms.rooms.get(peer.roomId);
        if (room) { if (room.hostId === peer.id) room.streamEpoch = 0; rooms.broadcast(room); }
      }
    });
  });
  const sweep = setInterval(() => {
    for (const [key, peer] of peers) if (!peer.ws && Date.now() - peer.disconnectedAt >= config.reconnectMs) { rooms.leave(peer); peers.delete(key); }
    rooms.sweep();
  }, 1000);
  const ping = setInterval(() => { for (const ws of connections) { if (!ws.isAlive()) ws.terminate(); else ws.ping(); } }, 10000);
  return { http, rooms, peers,
    listen: () => new Promise(resolve => http.listen(config.port, config.host, () => resolve(http.address()))),
    close: async () => { clearInterval(sweep); clearInterval(ping); for (const ws of connections) ws.terminate(); wss.close(); await new Promise(resolve => http.close(resolve)); },
  };
}
