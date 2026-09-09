// One bounded thumbnail per active room. No lyrics, disk cache or external URLs.
const tag = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 160) : '';
export function readArtwork(value) {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > 5464 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('invalid_cover');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < 30 || bytes.length > 4096 || bytes.toString('base64') !== value
    || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 16) !== 'WEBPVP8 '
    || bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) throw new Error('invalid_cover');
  const width = bytes.readUInt16LE(26) & 0x3fff, height = bytes.readUInt16LE(28) & 0x3fff;
  if (!width || width > 96 || !height || height > 96) throw new Error('invalid_cover');
  return value;
}
export function updateArtwork(room, input, broadcast, now = performance.now()) {
  if (!room.streamEpoch || !Number.isSafeInteger(input.epoch) || input.epoch !== room.streamEpoch) throw new Error('stream_changed');
  if (!input.track || typeof input.track !== 'object' || Array.isArray(input.track)) throw new Error('invalid_metadata');
  const track = { title: tag(input.track.title), artist: tag(input.track.artist), album: tag(input.track.album), cover: readArtwork(input.track.cover), lyrics: null };
  if (JSON.stringify(track) === JSON.stringify(room.track)) return true;
  if (room.artworkAt !== undefined && now - room.artworkAt < 500) throw new Error('metadata_rate_limit');
  room.artworkAt = now; room.track = track; broadcast(); return true;
}
