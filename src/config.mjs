const integer = (env, name, fallback, min, max) => {
  const value = Number(env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
  return value;
};
export function readConfig(env = process.env) {
  const publicUrl = env.PUBLIC_URL || 'ws://localhost:8787';
  const url = new URL(publicUrl);
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('PUBLIC_URL must be a ws/wss origin');
  return {
    name: (env.SERVER_NAME || 'ECHO 一起听').slice(0, 64), publicUrl: url.origin,
    host: env.HOST || '0.0.0.0', port: integer(env, 'PORT', 8787, 0, 65535),
    maxUsers: integer(env, 'MAX_USERS', 200, 2, 10000), maxRooms: integer(env, 'MAX_ROOMS', 30, 1, 1000),
    maxRoomUsers: integer(env, 'MAX_ROOM_USERS', 10, 2, 200),
    reconnectMs: integer(env, 'RECONNECT_SECONDS', 60, 1, 120) * 1000,
    emptyRoomMs: integer(env, 'EMPTY_ROOM_SECONDS', 60, 1, 600) * 1000,
    serverPassword: env.SERVER_PASSWORD || '', adminToken: env.ADMIN_TOKEN || '',
  };
}
