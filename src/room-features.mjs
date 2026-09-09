import { randomUUID } from 'node:crypto';
export const qualities = [128, 256, 320];
export function memberRoom(rooms, peer) {
  const room = rooms.rooms.get(peer.roomId);
  if (!room || room.members.get(peer.id) !== peer) throw new Error('room_required');
  return room;
}
export function qualityIndex(room, peer) {
  return room.multiQuality ? Math.max(0, qualities.indexOf(peer.quality || 128)) : 0;
}
export function roomForPeer(snapshot, room, peer) {
  const index = qualityIndex(room, peer);
  return { ...snapshot, qualities: room.multiQuality ? qualities : [128],
    quality: qualities[index], preferredQuality: peer.quality || 128,
    streamEpoch: room.streamEpoch ? room.streamEpoch + (room.hostId === peer.id ? 0 : index) : 0 };
}
export function selectQuality(rooms, peer, input) {
  const room = memberRoom(rooms, peer);
  if (!qualities.includes(input.value)) throw new Error('invalid_quality');
  peer.quality = input.value;
  rooms.notify(peer, { type: 'room', room: roomForPeer(rooms.publicRoom(room, true), room, peer) });
  return true;
}
export function sendChat(rooms, peer, input) {
  const room = memberRoom(rooms, peer);
  if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 500) throw new Error('invalid_chat');
  const now = Date.now();
  if (peer.chatAt !== undefined && now - peer.chatAt < 750) throw new Error('chat_rate_limit');
  peer.chatAt = now;
  // No server history or logging. Identity and room come from membership, not input.
  const message = { id: randomUUID(), roomId: room.id, senderId: peer.id, name: peer.name,
    text: input.text.trim(), sentAt: now };
  for (const member of room.members.values()) rooms.notify(member, { type: 'chat', message });
  return true;
}
