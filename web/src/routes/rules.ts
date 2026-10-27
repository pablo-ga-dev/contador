import { Hono } from 'hono';
import { requireUser, type AppEnv } from '../auth/middleware.ts';
import { sql } from '../db/index.ts';

/** Reglas del equipo: qué cliente se preselecciona para cada dominio, chat o app. */
export const ruleRoutes = new Hono<AppEnv>();
ruleRoutes.use(requireUser);

ruleRoutes.get('/', async (c) => {
  return c.json(await sql`SELECT kind, key, client_id AS "clientId" FROM rules ORDER BY kind, key`);
});
