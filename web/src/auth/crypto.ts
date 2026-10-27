import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEY_LENGTH = 64;

/** Hash de contraseña con scrypt y sal aleatoria: "scrypt$<sal>$<hash>" en base64. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(key, expected);
}

/** Token aleatorio para sesiones y códigos de agente. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** En la base de datos solo guardamos el hash: si se filtrara, los tokens no servirían. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
