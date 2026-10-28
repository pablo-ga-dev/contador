import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { config } from '../config.ts';
import { hashPassword, hashToken, newToken, verifyPassword } from '../auth/crypto.ts';
import { requireUser, SESSION_COOKIE, type AppEnv, type User } from '../auth/middleware.ts';
import { db, iso, sql } from '../db/index.ts';
import { HttpError, jsonBody, text } from '../http.ts';

export const MIN_PASSWORD_LENGTH = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 10;
/** Intentos fallidos recientes por email, para frenar a quien pruebe contraseñas. */
const failures = new Map<string, number[]>();

export const authRoutes = new Hono<AppEnv>();

authRoutes.post('/login', async (c) => {
  const body = await jsonBody(c);
  const email = text(body.email, 'el email').toLowerCase();
  const password = text(body.password, 'la contraseña');

  const now = Date.now();
  const recent = (failures.get(email) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
  if (recent.length >= MAX_LOGIN_FAILURES) {
    throw new HttpError(429, 'Demasiados intentos. Espera unos minutos.');
  }

  const user = await db.one<User & { password_hash: string }>(sql`
    SELECT id, email, name, role, password_hash FROM users WHERE email = ${email}`);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    failures.set(email, [...recent, now]);
    throw new HttpError(401, 'Email o contraseña incorrectos.');
  }
  failures.delete(email);

  const token = newToken();
  await db.exec(sql`
    INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (${hashToken(token)}, ${user.id}, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${config.sessionDays} DAY))`);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: config.cookieSecure,
    path: '/',
    maxAge: config.sessionDays * 24 * 3600,
  });
  return c.json({ id: user.id, email: user.email, name: user.name, role: user.role });
});

authRoutes.post('/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await db.exec(sql`DELETE FROM sessions WHERE token_hash = ${hashToken(token)}`);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.body(null, 204);
});

authRoutes.get('/me', requireUser, (c) => c.json(c.get('user')));

/** Datos del usuario para la página de Ajustes, incluido el estado de su agente. */
authRoutes.get('/profile', requireUser, async (c) => {
  const user = c.get('user');
  const row = await db.one<{ created_at: string }>(sql`SELECT created_at FROM users WHERE id = ${user.id}`);
  const agent = await db.one<{ created_at: string; last_used_at: string | null }>(sql`
    SELECT created_at, last_used_at FROM agent_tokens WHERE user_id = ${user.id}`);
  return c.json({
    ...user,
    createdAt: iso(row?.created_at ?? null),
    agent: agent ? { createdAt: iso(agent.created_at), lastUsedAt: iso(agent.last_used_at) } : null,
  });
});

authRoutes.patch('/profile', requireUser, async (c) => {
  const name = text((await jsonBody(c)).name, 'el nombre', 80);
  const user = c.get('user');
  await db.exec(sql`UPDATE users SET name = ${name} WHERE id = ${user.id}`);
  return c.json({ ...user, name });
});

authRoutes.post('/password', requireUser, async (c) => {
  const body = await jsonBody(c);
  const current = text(body.current, 'la contraseña actual');
  const next = text(body.next, 'la contraseña nueva');
  if (next.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, `La contraseña nueva debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }
  const user = c.get('user');
  const row = await db.one<{ password_hash: string }>(sql`SELECT password_hash FROM users WHERE id = ${user.id}`);
  if (!row || !(await verifyPassword(current, row.password_hash))) {
    throw new HttpError(401, 'La contraseña actual no es correcta.');
  }
  await db.exec(sql`UPDATE users SET password_hash = ${await hashPassword(next)} WHERE id = ${user.id}`);
  return c.body(null, 204);
});

/**
 * Genera el código con el que el agente del PC envía los días. Solo se muestra
 * una vez; generar otro invalida el anterior.
 */
authRoutes.post('/agent-code', requireUser, async (c) => {
  const user = c.get('user');
  const code = newToken();
  await db.transaction(async (tx) => {
    await tx.exec(sql`DELETE FROM agent_tokens WHERE user_id = ${user.id}`);
    await tx.exec(sql`INSERT INTO agent_tokens (token_hash, user_id) VALUES (${hashToken(code)}, ${user.id})`);
  });
  return c.json({ code });
});

/** Desconecta el agente: su código deja de valer. */
authRoutes.delete('/agent-code', requireUser, async (c) => {
  await db.exec(sql`DELETE FROM agent_tokens WHERE user_id = ${c.get('user').id}`);
  return c.body(null, 204);
});
