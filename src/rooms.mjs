import { randomUUID } from 'node:crypto';
import { token, text, hashPassword, checkPassword } from './security.mjs';
export class Rooms {
  constructor(config, notify, changed = () => {}) { this.changed = changed; this.config = config; this.notify = notify; this.rooms = new Map(); this.creating = 0; }
  publicRoom(room, details = false) {
    const base = { id: room.id, name: room.name, locked: Boolean(room.password), private: room.private, count: room.members.size, maxUsers: room.maxUsers };
    return details ? { ...base, hostId: room.hostId, streamEpoch: room.streamEpoch, title: room.title,
      members: [...room.members.values()].map(p => ({ id: p.id, name: p.name, online: Boolean(p.ws) })) } : base;
  }
  list() { return [...this.rooms.values()].filter(r => !r.private).map(r => this.publicRoom(r)); }
  broadcast(room) { for (const member of room.members.values()) this.notify(member, { type: 'room', room: this.publicRoom(room, true) }); }
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
        hostId: peer.id, members: new Map([[peer.id, peer]]), invitations: new Map(), streamEpoch: 0, title: '', emptySince: 0 };
      this.rooms.set(room.id, room); peer.roomId = room.id; if (!room.private) this.changed(); this.broadcast(room); return this.publicRoom(room, true);
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
    room.members.set(peer.id, peer); peer.roomId = room.id; room.emptySince = 0;
    if (!room.hostId) room.hostId = peer.id;
    if (!room.private) this.changed();
    this.broadcast(room); return this.publicRoom(room, true);
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
    if (!Number.isSafeInteger(input.epoch) || input.epoch < 0) throw new Error('invalid_epoch');
    room.streamEpoch = input.epoch; room.title = text(input.title, 160, true);
    this.broadcast(room); return true;
  }
  pruneInvites(room) { for (const [key, expiry] of room.invitations) if (expiry <= Date.now()) room.invitations.delete(key); }
  sweep() {
    for (const room of this.rooms.values()) {
      this.pruneInvites(room);
      if (room.emptySince && Date.now() - room.emptySince > this.config.emptyRoomMs) { this.rooms.delete(room.id); if (!room.private) this.changed(); }
    }
  }
}
