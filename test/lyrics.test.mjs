import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSharedLyrics, readMediaClock } from '../src/lyrics.mjs';
test('bounds lyrics, word timing, and shared media clocks', () => {
  const lyrics = readSharedLyrics({ lines: Array.from({ length: 1000 }, () => ({ timeMs: 1, text: '中'.repeat(1000), path: 'private' })) });
  assert.equal(lyrics.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(lyrics)) < 30000);
  assert.equal(lyrics.lines[0].path, undefined);
  const clock = { mediaAnchors: [{ streamFrame: 0, mediaAnchorSeconds: 60, playbackRate: 1 },
    { streamFrame: 48000, mediaAnchorSeconds: 61, playbackRate: 2 }] };
  assert.equal(readMediaClock(clock).mediaAnchors.length, 2);
  assert.equal(readMediaClock({ mediaAnchors: Array(33).fill(clock.mediaAnchors[0]) }), null);
  assert.equal(readMediaClock({ mediaAnchors: [...clock.mediaAnchors].reverse() }), null);
});
