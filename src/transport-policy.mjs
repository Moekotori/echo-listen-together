import { queuedControlBytes } from './socket-control-budget.mjs';
// Fixed budgets only: no audio queue and no per-packet timers.
const congestion = new WeakMap();
export function allowAudioSend(ws, now = performance.now()) {
  if (ws.bufferedAmount <= 65536 && Math.max(0, ws.bufferedAmount - queuedControlBytes(ws)) <= 16384) { congestion.delete(ws); return true; }
  const since = congestion.get(ws) ?? now;
  congestion.set(ws, since);
  if (now - since >= 10000) ws.close(1013, 'slow_receiver');
  return false;
}

export class AudioRateBudget {
  packets = 200;
  bytes = 131072;
  updatedAt;
  limitedAt = null;
  constructor(now = performance.now()) { this.updatedAt = now; }
  accept(size, ws, now = performance.now()) {
    const elapsed = Math.max(0, now - this.updatedAt) / 1000;
    this.updatedAt = now;
    this.packets = Math.min(200, this.packets + elapsed * 100);
    this.bytes = Math.min(131072, this.bytes + elapsed * 65536);
    if (this.packets >= 100 && this.bytes >= 65536) this.limitedAt = null;
    if (this.packets < 1 || this.bytes < size) {
      this.limitedAt ??= now;
      if (now - this.limitedAt >= 5000) ws.close(1008, 'audio_rate_limit');
      return false;
    }
    this.packets--; this.bytes -= size;
    return true;
  }
}
