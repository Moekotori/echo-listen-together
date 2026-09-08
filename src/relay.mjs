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
  if (!room || room.hostId !== peer.id || !room.streamEpoch || !validPacket(data, room.streamEpoch)) return;
  const now = Date.now();
  if (now - peer.audioWindow >= 1000) { peer.audioWindow = now; peer.audioPackets = 0; peer.audioBytes = 0; }
  if (++peer.audioPackets > 100 || (peer.audioBytes += data.length) > 65536) { peer.ws?.close(1008, 'audio_rate_limit'); return; }
  for (const member of room.members.values()) {
    const ws = member.ws;
    if (member.id === peer.id || !ws || ws.readyState !== 1) continue;
    // Close lagging TCP connections instead of retaining/replaying stale audio.
    if (ws.bufferedAmount > 16384) { ws.close(1013, 'slow_receiver'); continue; }
    ws.send(data, { binary: true, compress: false });
  }
}
