import { randomUUID } from 'node:crypto';
export const fixedAudioBitrate = 256000;
export function memberRoom(rooms, peer) {
  const room = rooms.rooms.get(peer.roomId);
  if (!room || room.members.get(peer.id) !== peer) throw new Error('room_required');
  return room;
}
export function roomForPeer(snapshot) {
  return { ...snapshot, qualities: [256], quality: 256, preferredQuality: 256 };
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
