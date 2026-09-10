import { readMediaClock } from './lyrics.mjs';

// Small clock deltas never repeat lyrics, artwork, chat or member snapshots.
export function updateMediaClock(rooms, peer, input, now = performance.now()) {
  const room = rooms.owned(peer);
  if (!room.streamEpoch || input.epoch !== room.streamEpoch) throw new Error('stream_changed');
  if (!room.track) throw new Error('metadata_missing');
  const clock = input.clock === null ? null : readMediaClock(input.clock);
  if (input.clock !== null && !clock) throw new Error('invalid_clock');
  if (JSON.stringify(clock) === JSON.stringify(room.track.clock)) return true;
  if (room.clockAt !== undefined && now - room.clockAt < 500) throw new Error('clock_rate_limit');
  room.clockAt = now;
  room.track.clock = clock;
  const rate = clock?.mediaAnchors.at(-1)?.playbackRate;
  if (rate !== undefined) room.track.technical = { ...room.track.technical, playbackRate: rate };
  for (const member of room.members.values()) rooms.notify(member, { type: 'clock', roomId: room.id,
    epoch: room.streamEpoch, clock });
  return true;
}
