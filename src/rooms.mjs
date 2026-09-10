import { roomForPeer } from './room-features.mjs';
import { updateProgramme } from './programme-state.mjs';
import { randomUUID } from 'node:crypto';
import { token, text, hashPassword, checkPassword } from './security.mjs';
export class Rooms {
  constructor(config, notify, changed = () => {}) { this.changed = changed; this.config = config; this.notify = notify; this.rooms = new Map(); this.creating = 0; }
  publicRoom(room, details = false) {
    const base = { id: room.id, name: room.name, locked: Boolean(room.password), private: room.private, count: room.members.size, maxUsers: room.maxUsers };
    return details ? { ...base, hostId: room.hostId, streamEpoch: room.streamEpoch, programmeState: room.programmeState ?? (room.streamEpoch ? 'playing' : 'stopped'), title: room.title, track: room.track ?? null,
      members: [...room.members.values()].map(p => ({ id: p.id, name: p.name, ...(p.steamId ? { steamId: p.steamId } : {}), online: Boolean(p.ws) })) } : base;
  }
  list() { return [...this.rooms.values()].filter(r => !r.private).map(r => this.publicRoom(r)); }
  broadcast(room) {
    // One transient snapshot per update; never retain member lists between broadcasts.
    const message = { type: 'room', room: this.publicRoom(room, true) };
    for (const member of room.members.values()) this.notify(member, { type: 'room', room: roomForPeer(message.room, room, member) });
  }
  async create(peer, input) {
    if (peer.roomId) throw new Error('already_in_room');
    if (this.rooms.size + this.creating >= this.config.maxRooms) throw new Error('room_limit');
    const name = text(input.name, 64), password = text(input.password, 128, true);
    const maxUsers = input.maxUsers;
    if (!Number.isInteger(maxUsers) || maxUsers < 2 || maxUsers > this.config.maxRoomUsers) throw new Error('invalid_capacity');
    this.creating++;
    try {
      const passwordHash = await hashPassword(password);
      if (!peer.ws || peer.roomId) throw new Error('session_changed');
      const room = { id: randomUUID(), name, maxUsers, private: input.private === true, password: passwordHash,
        hostId: peer.id, members: new Map([[peer.id, peer]]), invitations: new Map(), streamEpoch: 0, title: '', emptySince: null };
      this.rooms.set(room.id, room); peer.roomId = room.id; if (!room.private) this.changed(); this.broadcast(room); return roomForPeer(this.publicRoom(room, true), room, peer);
    } finally { this.creating--; }
  }
  async join(peer, input) {
    if (peer.roomId) throw new Error('already_in_room');
    const room = this.rooms.get(text(input.roomId, 64));
    if (!room) throw new Error('room_not_found');
    const invitation = typeof input.invitation === 'string' ? room.invitations.get(input.invitation) : null;
    const invited = invitation && invitation > Date.now();
    if (!invited && !await checkPassword(text(input.password, 128, true), room.password)) throw new Error('wrong_password');
    // Recheck all facts after the asynchronous password operation.
    if (!peer.ws || peer.roomId || this.rooms.get(room.id) !== room) throw new Error('session_changed');
    if (room.members.size >= room.maxUsers) throw new Error('room_full');
    if (invited) room.invitations.delete(input.invitation);
    room.members.set(peer.id, peer); peer.roomId = room.id; room.emptySince = null;
    if (!room.hostId) room.hostId = peer.id;
    if (!room.private) this.changed();
    this.broadcast(room); return roomForPeer(this.publicRoom(room, true), room, peer);
  }
  leave(peer) {
    const room = this.rooms.get(peer.roomId); peer.roomId = null;
    if (!room) return;
    room.members.delete(peer.id);
    if (!room.private) this.changed();
    if (room.hostId === peer.id) {
      room.hostId = null; room.streamEpoch = 0; room.title = ''; room.invitations.clear();
      // Host departure ends the programme. No automatic source takeover.
      for (const member of room.members.values()) { member.roomId = null; this.notify(member, { type: 'room', room: null, reason: 'host_left' }); }
      room.members.clear();
      this.rooms.delete(room.id);
      return;
    }
    if (!room.members.size) room.emptySince = Date.now();
    this.broadcast(room);
  }
  owned(peer) {
    const room = this.rooms.get(peer.roomId);
    if (!room || room.hostId !== peer.id) throw new Error('host_required');
    return room;
  }
  invite(peer) {
    const room = this.owned(peer);
    this.pruneInvites(room);
    if (room.invitations.size >= 32) throw new Error('invite_limit');
    const invitation = token(), expiresAt = Date.now() + 300000;
    room.invitations.set(invitation, expiresAt);
    return { server: this.config.publicUrl, roomId: room.id, invitation, expiresAt };
  }
  stream(peer, input) {
    const room = this.owned(peer);
    if (!Number.isSafeInteger(input.epoch) || input.epoch < 0 || input.epoch > Number.MAX_SAFE_INTEGER - 2) throw new Error('invalid_epoch');
    updateProgramme(room, input);
    this.broadcast(room); return true;
  }
  pruneInvites(room) { for (const [key, expiry] of room.invitations) if (expiry <= Date.now()) room.invitations.delete(key); }
  sweep() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      this.pruneInvites(room);
      let online = false;
      let lastDisconnect = null;
      for (const member of room.members.values()) {
        if (member.ws) { online = true; break; }
        if (Number.isFinite(member.disconnectedAt)) lastDisconnect = Math.max(lastDisconnect ?? member.disconnectedAt, member.disconnectedAt);
      }
      if (online) { room.emptySince = null; continue; }
      // Retained offline members are not occupants, but their reconnect grace
      // must expire before reclaiming the room. A later disconnect restarts it.
      room.emptySince = Math.max(room.emptySince ?? lastDisconnect ?? now, lastDisconnect ?? -Infinity);
      const timeout = room.members.size ? Math.max(this.config.emptyRoomMs, this.config.reconnectMs) : this.config.emptyRoomMs;
      if (now - room.emptySince < timeout) continue;
      for (const member of room.members.values()) if (member.roomId === room.id) member.roomId = null;
      room.members.clear(); room.invitations.clear(); room.track = null; room.title = ''; room.streamEpoch = 0;
      this.rooms.delete(room.id);
      if (!room.private) this.changed();
    }
  }
}
