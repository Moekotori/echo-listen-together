import { qualityIndex } from './room-features.mjs';
// ECHO native ELTA v1: 36-byte header, bounded 20ms stereo Opus payload.
export function validPacket(data, epoch) {
  return Buffer.isBuffer(data) && data.length > 36 && data.length <= 1311
    && data.toString('ascii', 0, 4) === 'ELTA' && data[4] === 1
    && data.readBigUInt64LE(8) === BigInt(epoch) && (data[5] & ~3) === 0
    && data.readUInt16LE(6) === 36 && data.readUInt32LE(28) === 48000
    && data.readUInt16LE(32) === data.length - 36 && data[34] === 2 && data[35] === 20;
}
export function relayAudio(peer, data, rooms) {
  const room = rooms.rooms.get(peer.roomId);
  if (!room || room.hostId !== peer.id || !room.streamEpoch || !Buffer.isBuffer(data) || data.length <= 36) return;
  const offset = data.readBigUInt64LE(8) - BigInt(room.streamEpoch);
  if (offset < 0n || offset > BigInt(room.multiQuality ? 2 : 0) || !validPacket(data, room.streamEpoch + Number(offset))) return;
  const now = Date.now();
  if (now - peer.audioWindow >= 1000) { peer.audioWindow = now; peer.audioPackets = 0; peer.audioBytes = 0; }
  if (++peer.audioPackets > (room.multiQuality ? 300 : 100) || (peer.audioBytes += data.length) > (room.multiQuality ? 196608 : 65536)) { peer.ws?.close(1008, 'audio_rate_limit'); return; }
  for (const member of room.members.values()) {
    const ws = member.ws;
    if (member.id === peer.id || qualityIndex(room, member) !== Number(offset) || !ws || ws.readyState !== 1) continue;
    // Bound transport buffering; tolerate short stalls without building a replay queue.
    if (ws.bufferedAmount > 16384) {
      member.congestedAt ??= now;
      if (now - member.congestedAt >= 10000) ws.close(1013, 'slow_receiver');
      continue;
    }
    member.congestedAt = null;
    ws.send(data, { binary: true, compress: false });
  }
}
