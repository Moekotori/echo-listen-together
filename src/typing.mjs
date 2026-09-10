// Ephemeral peer state only: no draft text, persistence or per-room timers.
export function sendTyping(rooms, peer, input, now = performance.now()) {
  const room = rooms.rooms.get(peer.roomId);
  if (!room || room.members.get(peer.id) !== peer) throw new Error('room_required');
  if (typeof input.active !== 'boolean' || input.roomId !== room.id) throw new Error('invalid_typing');
  if (peer.typingRoom !== room.id) { peer.typingRoom = room.id; peer.typingAt = -Infinity; peer.typingActive = false; }
  if (input.active && now - peer.typingAt < 2000 || !input.active && !peer.typingActive) return false;
  if (input.active) peer.typingAt = now;
  peer.typingActive = input.active;
  const presence = { roomId: room.id, senderId: peer.id, active: input.active };
  for (const member of room.members.values()) if (member.id !== peer.id) rooms.notify(member, { type: 'typing', presence });
  return true;
}
