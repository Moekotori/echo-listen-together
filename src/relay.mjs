import { qualityIndex } from './room-features.mjs';
import { allowAudioSend, AudioRateBudget } from './transport-policy.mjs';
// ECHO native ELTA v1: 36-byte header, bounded 20ms stereo Opus payload.
export function validPacket(data, epoch) {
  return Buffer.isBuffer(data) && data.length > 36 && data.length <= 1311
    && data.toString('ascii', 0, 4) === 'ELTA' && data[4] === 1
    && data.readBigUInt64LE(8) === BigInt(epoch) && (data[5] & ~3) === 0
    && data.readUInt16LE(6) === 36 && data.readUInt32LE(28) === 48000
    && data.readUInt16LE(32) === data.length - 36 && data[34] === 2 && data[35] === 20;
}
export function relayAudio(peer, data, rooms, diagnostics) {
  const room = rooms.rooms.get(peer.roomId);
  if (!room || room.hostId !== peer.id || !room.streamEpoch || !Buffer.isBuffer(data) || data.length <= 36) { diagnostics?.count(peer.ws, 'unauthorized'); return; }
  const offset = data.readBigUInt64LE(8) - BigInt(room.streamEpoch);
  if (offset < 0n || offset > BigInt(room.multiQuality ? 2 : 0) || !validPacket(data, room.streamEpoch + Number(offset))) { diagnostics?.count(peer.ws, 'epochRejected'); return; }
  const tiers = room.multiQuality ? 3 : 1;
  if (peer.audioBudget?.tiers !== tiers) peer.audioBudget = new AudioRateBudget(performance.now(), tiers);
  if (!peer.audioBudget.accept(data.length, peer.ws)) { diagnostics?.count(peer.ws, 'rateLimited'); return; }
  diagnostics?.count(peer.ws, 'accepted');
  for (const member of room.members.values()) {
    const ws = member.ws;
    if (member.id === peer.id || qualityIndex(room, member) !== Number(offset) || !ws || ws.readyState !== 1) continue;
    // Brief congestion drops audio, not membership. Persistently blocked peers
    // still disconnect, and no extra queue retains stale audio.
    if (!allowAudioSend(ws)) { diagnostics?.count(ws, 'congested'); continue; }
    ws.send(data, { binary: true, compress: false });
    diagnostics?.count(ws, 'forwarded');
  }
  return true;
}
