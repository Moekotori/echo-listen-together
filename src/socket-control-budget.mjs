// Account for control writes already owned by ws; never keep a second payload queue.
const pending = new WeakMap();
export const queuedControlBytes = ws => pending.get(ws) ?? 0;
export function reserveControlBytes(ws, bytes) {
  const queued = queuedControlBytes(ws);
  if (!Number.isSafeInteger(bytes) || bytes < 0 || queued + bytes > 262144) return null;
  pending.set(ws, queued + bytes);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = Math.max(0, queuedControlBytes(ws) - bytes);
    if (remaining) pending.set(ws, remaining);
    else pending.delete(ws);
  };
}
