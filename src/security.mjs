import { createWorkBudget } from './abuse-guards.mjs';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
const passwordWork = createWorkBudget(2);
export const token = () => randomBytes(24).toString('base64url');
export const secretEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length <= 512 && b.length <= 512 && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function text(value, max, optional = false) {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new Error('invalid_input');
  return value.trim();
}
export async function hashPassword(password) {
  if (!password) return null;
  const salt = randomBytes(16);
  return { salt, hash: await passwordWork(() => scrypt(password, salt, 32)) };
}
export async function checkPassword(password, stored) {
  if (!stored) return true;
  if (typeof password !== 'string' || !password.length || password.length > 128) return false;
  const hash = await passwordWork(() => scrypt(password, stored.salt, 32));
  return timingSafeEqual(hash, stored.hash);
}
