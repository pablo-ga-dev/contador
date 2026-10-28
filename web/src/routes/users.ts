import { Hono } from 'hono';
import { requireAdmin, requireUser, type AppEnv } from '../auth/middleware.ts';
import { db, iso, sql } from '../db/index.ts';
import { jsonBody, parseId, text } from '../http.ts';
import { createUser, parseRole, resetPassword, setRole } from '../users.ts';

/** Equipo: solo para administradores. */
export const userRoutes = new Hono<AppEnv>();
userRoutes.use(requireUser, requireAdmin);

userRoutes.get('/', async (c) => {
  const rows = await db.query<{ id: number; email: string; name: string; role: string; created_at: string; last_used_at: string | null }>(sql`
    SELECT u.id, u.email, u.name, u.role, u.created_at, t.last_used_at
      FROM users u LEFT JOIN agent_tokens t ON t.user_id = u.id
     ORDER BY u.name`);
  return c.json(rows.map((r) => ({
    id: r.id, email: r.email, name: r.name, role: r.role,
    createdAt: iso(r.created_at), agentLastUsedAt: iso(r.last_used_at),
  })));
});

/** Alta de un usuario; la contraseña temporal se devuelve una sola vez. */
userRoutes.post('/', async (c) => {
  const body = await jsonBody(c);
  const email = text(body.email, 'el email', 255);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return c.json({ error: 'El email no es válido.' }, 400);
  const name = text(body.name, 'el nombre', 80);
  const role = body.role === undefined ? 'user' : parseRole(body.role);
  const { id, password } = await createUser(email, name, role);
  return c.json({ id, email: email.toLowerCase(), name, role, password }, 201);
});

userRoutes.patch('/:id', async (c) => {
  const id = parseId(c.req.param('id'), 'el usuario');
  await setRole(id, parseRole((await jsonBody(c)).role));
  return c.body(null, 204);
});

/** Nueva contraseña temporal (se devuelve una sola vez) y se cierran sus sesiones. */
userRoutes.post('/:id/reset-password', async (c) => {
  const id = parseId(c.req.param('id'), 'el usuario');
  return c.json({ password: await resetPassword(id) });
});
