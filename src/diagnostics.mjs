const counterNames = ['ingress', 'accepted', 'forwarded', 'invalid', 'unauthorized', 'epochRejected', 'rateLimited', 'congested'];
const reasons = new Set(['connection_closed', 'heartbeat_timeout', 'hello_timeout', 'invalid_audio', 'ingress_limit',
  'invalid_request', 'control_rate_limit', 'audio_rate_limit', 'slow_receiver', 'server_shutdown', 'replaced']);
/** Fixed state per live socket; no content, identities, IPs, packet buffers or per-packet logging. */
export function createDiagnostics({ now = () => performance.now(), write = line => {
  if (process.stdout.writableLength > 65536) return false;
  process.stdout.write(line); return true;
} } = {}) {
  const sockets = new WeakMap(); let next = 0, tokens = 40, updatedAt = now(), omitted = 0;
  function emit(state, event, extra = {}) {
    const time = now(); tokens = Math.min(40, tokens + Math.max(0, time - updatedAt) * 0.02); updatedAt = time;
    if (tokens < 1) { omitted++; return; } tokens--;
    const entry = { timestamp: new Date().toISOString(), event, connection: state.connection, epoch: state.epoch,
      role: state.role, ...extra, omitted };
    try { if (write(JSON.stringify(entry) + '\n') === false) omitted++; else omitted = 0; } catch { omitted++; }
  }
  function open(ws) {
    const state = { connection: ++next, startedAt: now(), lastAudioAt: now(), lastReportAt: now(), epoch: 0,
      role: 'none', stalled: false, everAudio: false, reason: 'connection_closed',
      counters: Object.fromEntries(counterNames.map(key => [key, 0])), previous: null };
    sockets.set(ws, state); emit(state, 'connection_open');
  }
  function count(ws, key) {
    const state = sockets.get(ws); if (!state || !counterNames.includes(key)) return;
    state.counters[key]++;
    if (key === 'accepted' || key === 'forwarded') {
      state.lastAudioAt = now(); state.everAudio = true;
      if (state.stalled) { emit(state, 'audio_recovered', { ...state.counters }); state.stalled = false; }
    }
  }
  function reason(ws, value) { const state = sockets.get(ws); if (state) state.reason = reasons.has(value) ? value : 'connection_closed'; }
  function observe(ws, epoch, role) {
    const state = sockets.get(ws); if (!state) return;
    if (state.epoch !== epoch || state.role !== role) {
      state.epoch = epoch; state.role = role; state.lastAudioAt = now(); state.everAudio = false; state.stalled = false;
      emit(state, epoch ? 'stream_expected' : 'stream_stopped');
    }
    const time = now(), idleMs = time - state.lastAudioAt;
    if (epoch && idleMs >= 2000 && (!state.stalled || time - state.lastReportAt >= 10000)) {
      emit(state, state.everAudio ? 'audio_stalled' : 'audio_first_packet_timeout', { idleMs, ...state.counters });
      state.stalled = true; state.lastReportAt = time;
    }
    const previous = state.previous;
    const hasFault = ['invalid', 'unauthorized', 'epochRejected', 'rateLimited', 'congested'].some(key => state.counters[key] > (previous?.[key] ?? 0));
    if (time - state.lastReportAt >= (hasFault ? 10000 : 30000)) {
      emit(state, hasFault ? 'audio_transport_fault' : 'connection_summary', { ...state.counters });
      state.lastReportAt = time; state.previous = { ...state.counters };
    }
  }
  function close(ws, code = 1006, remoteReason = '') {
    const state = sockets.get(ws); if (!state) return;
    const closeCode = Number.isInteger(code) && code >= 0 && code <= 4999 ? code : 1006;
    emit(state, 'connection_closed', { reason: reasons.has(remoteReason) ? remoteReason : state.reason,
      closeCode, elapsedMs: now() - state.startedAt, ...state.counters });
    sockets.delete(ws);
  }
  return { open, count, reason, observe, close };
}
