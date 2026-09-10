import { createDiagnostics } from './diagnostics.mjs';
import { transferHost } from './host-transfer.mjs';
import { updateMediaClock } from './media-clock.mjs';
import { sendTyping } from './typing.mjs';
import { BinaryIngressBudget, parseControl, sendControl } from './abuse-guards.mjs';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { token, text, secretEqual } from './security.mjs';
import { Rooms } from './rooms.mjs';
import { updateArtwork } from './artwork.mjs';
import { fixedAudioBitrate, sendChat } from './room-features.mjs';
import { relayAudio, validPacket } from './relay.mjs';
export function createListenServer(config, { now = () => performance.now() } = {}) {
  const diagnostics = createDiagnostics({ now });
  const peers = new Map(), connections = new Set();
  const send = (peer, message) => {
    if (message.type === 'room' && peer.ws) diagnostics.observe(peer.ws, message.room?.streamEpoch || 0, message.room ? (message.room.hostId === peer.id ? 'host' : 'guest') : 'none');
    return sendControl(peer.ws, message);
  };
  let roomChangeTimer = null;
  const notifyRoomsChanged = () => {
    if (roomChangeTimer) return;
    roomChangeTimer = setTimeout(() => {
      roomChangeTimer = null;
      for (const peer of peers.values()) if (!peer.roomId) send(peer, { type: 'rooms-changed' });
    }, 400);
  };
  const rooms = new Rooms(config, send, notifyRoomsChanged);
  const http = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    if (req.url === '/health') { res.end(JSON.stringify({ ok: true, protocol: 1 })); return; }
    if (req.url === '/admin/status' && config.adminToken && secretEqual(req.headers.authorization, `Bearer ${config.adminToken}`)) {
      res.end(JSON.stringify({ users: peers.size, rooms: rooms.rooms.size, connections: connections.size })); return;
    }
    res.statusCode = 404; res.end('{"error":"not_found"}');
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 49152, perMessageDeflate: false });
  http.on('upgrade', (req, socket, head) => {
    if (req.url !== '/v1/socket' || connections.size >= config.maxUsers + 32 || req.headers.origin) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    diagnostics.open(ws);
    connections.add(ws); let peer = null, busy = false, count = 0, windowAt = now(); let lastSeen = now();
    const binaryBudget = new BinaryIngressBudget(now()); let invalidAudio = 0;
    const helloTimer = setTimeout(() => { if (!peer) { diagnostics.reason(ws, 'hello_timeout'); ws.close(1008, 'hello_timeout'); } }, 5000);
    const seen = () => { lastSeen = now(); };
    ws.on('pong', seen); ws.on('ping', seen); ws.on('error', () => {});
    ws.isAlive = () => now() - lastSeen < 35000;
    ws.on('message', async (raw, binary) => {
      if (ws.readyState !== 1) return;
      if (binary) {
        diagnostics.count(ws, 'ingress');
        if (peer?.ws !== ws || !binaryBudget.accept(raw.length, now())) { diagnostics.reason(ws, 'ingress_limit'); diagnostics.count(ws, 'invalid'); ws.terminate(); return; }
        if (!validPacket(raw, raw.readBigUInt64LE(8))) { diagnostics.count(ws, 'invalid'); diagnostics.reason(ws, 'invalid_audio'); if (++invalidAudio >= 32) ws.terminate(); return; }
        if (relayAudio(peer, raw, rooms, diagnostics)) seen();
        return;
      }
      if (now() - windowAt > 10000) { windowAt = now(); count = 0; }
      if (++count > 40) { ws.close(1008, 'control_rate_limit'); return; }
      let message;
      try { message = parseControl(raw); } catch { diagnostics.reason(ws, 'invalid_request'); ws.terminate(); return; }
      const id = message?.id;
      if (!message || typeof message !== 'object' || typeof id !== 'string' || id.length > 64) { ws.close(1008, 'invalid_request'); return; }
      const reply = value => sendControl(ws, { id, ...value });
      if (busy) { reply({ error: 'request_busy' }); return; }
      busy = true;
      try {
        const input = message.data || {};
        if (message.type !== 'metadata' && raw.length > 8192) throw new Error('invalid_request');
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
            peer = { id: token(), resumeToken: token(), name: text(input.name, 48), steamId: typeof input.steamId === 'string' && /^7656119[0-9]{10}$/.test(input.steamId) ? input.steamId : undefined, roomId: null, ws: null, disconnectedAt: 0, audioWindow: 0, audioPackets: 0, audioBytes: 0 };
            peers.set(peer.resumeToken, peer);
          }
          peer.ws = ws; seen(); clearTimeout(helloTimer);
          if (replacedSocket && replacedSocket !== ws) { diagnostics.reason(replacedSocket, 'replaced'); replacedSocket.terminate(); }
          reply({ result: { protocol: 1, peerId: peer.id, resumeToken: peer.resumeToken, name: config.name,
            capabilities: { trackMetadata: true, trackArtwork: true, chat: true, typing: true, audioQualities: false, fixedAudioBitrate, programmeState: true, transferHost: true, mediaClock: true },
            limits: { maxUsers: config.maxUsers, maxRooms: config.maxRooms, maxRoomUsers: config.maxRoomUsers } } });
          if (peer.roomId) {
            const room = rooms.rooms.get(peer.roomId);
            if (room) {
              // The reconnected host must explicitly authorize a fresh stream.
              if (peer === resumed && room.hostId === peer.id) { room.streamEpoch = 0; room.track = null; room.title = ''; room.programmeState = 'stopped'; }
              rooms.broadcast(room);
            }
          }
          return;
        }
        if (!peer || peer.ws !== ws) throw new Error('hello_required');
        let result;
        switch (message.type) {
          case 'clock': result = updateMediaClock(rooms, peer, input); break;
          case 'transferHost': result = transferHost(rooms, peer, input); break;
          case 'typing': result = sendTyping(rooms, peer, input); break;
          case 'chat': result = sendChat(rooms, peer, input); break;
          case 'quality': throw new Error('fixed_audio_quality');
          case 'rooms': result = rooms.list(); break;
          case 'create': result = await rooms.create(peer, input); break;
          case 'join': result = await rooms.join(peer, input); break;
          case 'leave': rooms.leave(peer); send(peer, { type: 'room', room: null }); result = true; break;
          case 'invite': result = rooms.invite(peer); break;
          case 'revokeInvites': rooms.owned(peer).invitations.clear(); result = true; break;
          case 'stream': result = rooms.stream(peer, input); break;
          case 'metadata': result = updateArtwork(rooms.owned(peer), input, () => rooms.broadcast(rooms.owned(peer))); break;
          default: throw new Error('unknown_request');
        }
        seen();
        reply({ result });
      } catch (error) { if (error.message === 'fixed_audio_quality') diagnostics.controlRejected(ws, error.message); reply({ error: /^[a-z_]+$/.test(error.message) ? error.message : 'invalid_request' }); }
      finally { busy = false; }
    });
    ws.on('close', (code, reason) => {
      diagnostics.close(ws, code, reason.toString());
      clearTimeout(helloTimer); connections.delete(ws);
      if (peer?.ws === ws) {
        peer.ws = null; peer.disconnectedAt = Date.now();
        const room = rooms.rooms.get(peer.roomId);
        if (room) { if (room.hostId === peer.id) { room.streamEpoch = 0; room.track = null; room.title = ''; room.programmeState = 'stopped'; } rooms.broadcast(room); }
      }
    });
  });
  const sweep = setInterval(() => {
    for (const [key, peer] of peers) if (!peer.ws && Date.now() - peer.disconnectedAt >= config.reconnectMs) { rooms.leave(peer); peers.delete(key); }
    rooms.sweep();
    for (const peer of peers.values()) {
      if (!peer.ws) continue;
      const room = rooms.rooms.get(peer.roomId);
      const host = room?.hostId === peer.id;
      diagnostics.observe(peer.ws, room?.streamEpoch || 0, room ? (host ? 'host' : 'guest') : 'none');
    }
  }, 1000);
  const ping = setInterval(() => { for (const ws of connections) { if (ws.readyState !== 1) continue; if (!ws.isAlive()) { diagnostics.reason(ws, 'heartbeat_timeout'); ws.terminate(); } else ws.ping(); } }, 10000);
  return { http, rooms, peers,
    listen: () => new Promise(resolve => http.listen(config.port, config.host, () => resolve(http.address()))),
    close: async () => { if (roomChangeTimer) clearTimeout(roomChangeTimer); clearInterval(sweep); clearInterval(ping); for (const ws of connections) { diagnostics.reason(ws, 'server_shutdown'); ws.terminate(); } wss.close(); await new Promise(resolve => http.close(resolve)); },
  };
}
