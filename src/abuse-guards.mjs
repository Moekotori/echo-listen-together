// Fixed per-connection counters only. No retained request bodies or deferred queues.
export function parseControl(raw) {
  if (!Buffer.isBuffer(raw) || raw.length > 49152) throw new Error('invalid_request');
  const text = raw.toString('utf8');
  let depth = 0, quoted = false, escaped = false;
  for (const character of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{' || character === '[') { if (++depth > 32) throw new Error('invalid_request'); }
    else if (character === '}' || character === ']') depth--;
  }
  let message;
  try { message = JSON.parse(text); } catch { throw new Error('invalid_json'); }
  if (!message || typeof message !== 'object' || Array.isArray(message)
    || typeof message.id !== 'string' || !message.id.length || message.id.length > 64
    || typeof message.type !== 'string' || !/^[a-zA-Z][a-zA-Z0-9]{0,31}$/.test(message.type)
    || (message.data !== undefined && (!message.data || typeof message.data !== 'object' || Array.isArray(message.data)))
    || (message.type !== 'metadata' && raw.length > 8192)) throw new Error('invalid_request');
  return message;
}

export class BinaryIngressBudget {
  frames = 1000;
  bytes = 1048576;
  constructor(now = performance.now()) { this.updatedAt = now; }
  accept(size, now = performance.now()) {
    const seconds = Math.max(0, now - this.updatedAt) / 1000;
    this.updatedAt = now;
    this.frames = Math.min(1000, this.frames + seconds * 400);
    this.bytes = Math.min(1048576, this.bytes + seconds * 393216);
    if (size <= 36 || size > 1311 || this.frames < 1 || this.bytes < size) return false;
    this.frames--; this.bytes -= size; return true;
  }
}

export function createWorkBudget(limit = 2) {
  let active = 0;
  return async work => {
    if (active >= limit) throw new Error('server_busy');
    active++;
    try { return await work(); } finally { active--; }
  };
}

export function sendControl(ws, value) {
  if (ws?.readyState !== 1) return false;
  if (ws.bufferedAmount > 65536) { ws.terminate(); return false; }
  const data = JSON.stringify(value);
  if (Buffer.byteLength(data) > 262144) { ws.terminate(); return false; }
  try { ws.send(data, error => { if (error) ws.terminate(); }); return true; }
  catch { ws.terminate(); return false; }
}
