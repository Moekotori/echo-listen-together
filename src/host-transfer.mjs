// Room membership remains unchanged; the new host must start a fresh programme.
export function transferHost(rooms, peer, input) {
  const room = rooms.owned(peer);
  if (typeof input.memberId !== 'string' || input.memberId.length > 128 || input.memberId === peer.id)
    throw new Error('invalid_transfer');
  const next = room.members.get(input.memberId);
  if (!next || next.ws?.readyState !== 1) throw new Error('member_unavailable');
  room.hostId = next.id;
  room.streamEpoch = 0;
  room.programmeState = 'stopped';
  room.title = '';
  room.track = null;
  room.artworkAt = undefined;
  room.invitations.clear();
  rooms.broadcast(room);
  return true;
}
