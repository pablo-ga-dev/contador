import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { db, sql } from '../db/index.ts';
import { hashToken } from './crypto.ts';

export const SESSION_COOKIE = 'contador_session';

export type Role = 'admin' | 'user';

export interface User {
  id: number;
  email: string;
  name: string;
  /** admin: ve los tiempos de todos y gestiona equipo, clientes y horas; user: solo los suyos. */
  role: Role;
}

export type AppEnv = { Variables: { user: User } };

/**
 * Exige un usuario: la web se identifica con la cookie de sesión y el agente con
 * "Authorization: Bearer <código del agente>".
 */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = (await userFromAgentCode(c)) ?? (await userFromSession(c));
  if (!user) return c.json({ error: 'No has iniciado sesión.' }, 401);
  c.set('user', user);
  await next();
};

/** Solo para administradores (va después de requireUser). */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get('user').role !== 'admin') return c.json({ error: 'Solo un administrador puede hacer esto.' }, 403);
  await next();
};

export const isAdmin = (user: User) => user.role === 'admin';

async function userFromAgentCode(c: Context): Promise<User | null> {
  const header = c.req.header('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return null;
  const hash = hashToken(header.slice(7));
  const user = await db.one<User>(sql`
    SELECT u.id, u.email, u.name, u.role
      FROM agent_tokens t JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ${hash}`);
  if (!user) return null;
  await db.exec(sql`UPDATE agent_tokens SET last_used_at = UTC_TIMESTAMP() WHERE token_hash = ${hash}`);
  return user;
}

async function userFromSession(c: Context): Promise<User | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const user = await db.one<User>(sql`
    SELECT u.id, u.email, u.name, u.role
      FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ${hashToken(token)} AND s.expires_at > UTC_TIMESTAMP()`);
  return user ?? null;
}
