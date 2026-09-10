import { text } from './security.mjs';

// Programme state is authoritative host input, independent of audio liveness.
export function updateProgramme(room, input) {
  const state = input.programmeState ?? (input.epoch ? 'playing' : 'stopped');
  if (!['playing', 'paused', 'stopped'].includes(state)
      || (state === 'playing') !== (input.epoch > 0)) throw new Error('invalid_programme_state');
  const title = text(input.title, 160, true);
  const retainTrack = state === 'paused' && title === room.title;
  if (!retainTrack && (room.streamEpoch !== input.epoch || !input.epoch)) {
    room.track = null; room.artworkAt = undefined;
    room.clockAt = undefined;
  }
  room.programmeState = state;
  room.streamEpoch = input.epoch;
  room.title = state === 'stopped' ? '' : title;
}
