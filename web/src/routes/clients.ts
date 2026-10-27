import { Hono } from 'hono';
import { requireUser, type AppEnv } from '../auth/middleware.ts';
import { sql } from '../db/index.ts';
import { HttpError, jsonBody, text } from '../http.ts';

export const clientRoutes = new Hono<AppEnv>();
clientRoutes.use(requireUser);

clientRoutes.get('/', async (c) => {
  return c.json(await sql`SELECT id, name FROM clients ORDER BY lower(name)`);
});

clientRoutes.post('/', async (c) => {
  const name = text((await jsonBody(c)).name, 'el nombre del cliente', 120);
  const [created] = await sql<{ id: number; name: string }[]>`
    INSERT INTO clients (name, created_by) VALUES (${name}, ${c.get('user').id})
    ON CONFLICT (lower(name)) DO NOTHING
    RETURNING id, name`;
  if (created) return c.json(created, 201);
  // Ya existía (quizá lo creó un compañero a la vez): lo devolvemos para que se pueda usar.
  const [existing] = await sql<{ id: number; name: string }[]>`
    SELECT id, name FROM clients WHERE lower(name) = lower(${name})`;
  if (!existing) throw new HttpError(409, 'No se pudo crear el cliente.');
  return c.json(existing, 200);
});
