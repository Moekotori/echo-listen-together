// Only the current programme; no paths, URLs, library IDs or persistent cache.
const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';
const time = value => Number.isFinite(value) ? Math.max(0, Math.min(86400000, value)) : 0;
export function readSharedLyrics(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.lines)) return null;
  const lines = [];
  let bytes = 0;
  for (const raw of value.lines.slice(0, 400)) {
    if (!raw || typeof raw !== 'object') continue;
    const line = { timeMs: time(raw.timeMs), text: text(raw.text, 1000) };
    if (raw.translation) line.translation = text(raw.translation, 1000);
    if (raw.romanization) line.romanization = text(raw.romanization, 1000);
    if (Array.isArray(raw.words)) line.words = raw.words.slice(0, 128)
      .filter(word => word && typeof word === 'object').map(word => ({
        text: text(word.text, 100), startMs: time(word.startMs), endMs: word.endMs === null ? null : time(word.endMs),
      }));
    bytes += Buffer.byteLength(JSON.stringify(line));
    if (bytes > 28000) break;
    lines.push(line);
  }
  return { provider: text(value.provider, 40), offsetMs: Number.isFinite(value.offsetMs)
    ? Math.max(-10000, Math.min(10000, value.offsetMs)) : 0,
    lines, truncated: value.truncated === true || lines.length < value.lines.length };
}
export function readMediaClock(value) {
  if (!value || !Array.isArray(value.mediaAnchors) || !value.mediaAnchors.length || value.mediaAnchors.length > 32) return null;
  const mediaAnchors = [];
  let previous = -1;
  for (const a of value.mediaAnchors) {
    if (!a || !Number.isFinite(a.streamFrame) || a.streamFrame < 0 || a.streamFrame < previous || a.streamFrame > 48000 * 86400
      || !Number.isFinite(a.mediaAnchorSeconds) || a.mediaAnchorSeconds < -1 || a.mediaAnchorSeconds > 86400
      || !Number.isFinite(a.playbackRate) || a.playbackRate < 0.1 || a.playbackRate > 8) return null;
    previous = a.streamFrame;
    mediaAnchors.push({ streamFrame: a.streamFrame, mediaAnchorSeconds: a.mediaAnchorSeconds, playbackRate: a.playbackRate });
  }
  return { mediaAnchorSeconds: 0, playbackRate: 1, mediaAnchors };
}
