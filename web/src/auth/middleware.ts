import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { sql } from '../db/index.ts';
import { hashToken } from './crypto.ts';

export const SESSION_COOKIE = 'contador_session';

export interface User {
  id: number;
  email: string;
  name: string;
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

async function userFromAgentCode(c: Context): Promise<User | null> {
  const header = c.req.header('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return null;
  const [user] = await sql<User[]>`
    WITH t AS (
      UPDATE agent_tokens SET last_used_at = now()
       WHERE token_hash = ${hashToken(header.slice(7))}
      RETURNING user_id
    )
    SELECT u.id, u.email, u.name FROM users u JOIN t ON t.user_id = u.id`;
  return user ?? null;
}

async function userFromSession(c: Context): Promise<User | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const [user] = await sql<User[]>`
    SELECT u.id, u.email, u.name
      FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ${hashToken(token)} AND s.expires_at > now()`;
  return user ?? null;
}
