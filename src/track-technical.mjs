function sanitizeListeningTrackTechnical(value) {
  if (!value || typeof value !== "object") return null;
  const input = value;
  const result = {};
  const ranges = { bpm: [1, 1e3], playbackRate: [0.1, 8], sampleRate: [8e3, 1536e3], bitDepth: [1, 64], bitrate: [1, 1e8] };
  for (const key of Object.keys(ranges)) {
    const number = input[key];
    if (typeof number === "number" && Number.isFinite(number) && number >= ranges[key][0] && number <= ranges[key][1]) result[key] = number;
  }
  if (typeof input.codec === "string" && /^[a-zA-Z0-9_.+ -]{1,32}$/.test(input.codec)) result.codec = input.codec;
  return Object.keys(result).length ? result : null;
}
export {
  sanitizeListeningTrackTechnical
};
