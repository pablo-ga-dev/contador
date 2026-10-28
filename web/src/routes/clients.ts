import { Hono } from 'hono';
import { requireUser, type AppEnv } from '../auth/middleware.ts';
import { sql } from '../db/index.ts';
import { HttpError, jsonBody, text } from '../http.ts';

/** El mismo límite que en day_notes: al juntar dos comentarios no se puede pasar de aquí. */
const MAX_NOTE_LENGTH = 2000;

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

/**
 * Borra un cliente sin perder el tiempo confirmado: su tiempo, comentarios y reglas
 * pasan a otro cliente (útil para unir duplicados) o, si moveTo es null, a "Sin cliente"
 * (los comentarios, al comentario general del día; las reglas se borran).
 */
clientRoutes.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const rawMoveTo = (await jsonBody(c)).moveTo ?? null;
  if (!Number.isInteger(id)) throw new HttpError(400, 'Cliente no válido.');
  if (rawMoveTo !== null && (!Number.isInteger(rawMoveTo) || rawMoveTo === id)) {
    throw new HttpError(400, 'Elige otro cliente al que pasar el tiempo.');
  }
  const moveTo = rawMoveTo as number | null;

  const result = await sql.begin(async (tx) => {
    const [client] = await tx<{ name: string }[]>`SELECT name FROM clients WHERE id = ${id} FOR UPDATE`;
    if (!client) throw new HttpError(404, 'Ese cliente ya no existe.');
    let targetName: string | null = null;
    if (moveTo !== null) {
      const [target] = await tx<{ name: string }[]>`SELECT name FROM clients WHERE id = ${moveTo}`;
      if (!target) throw new HttpError(400, 'El cliente al que pasar el tiempo no existe.');
      targetName = target.name;
    }

    const moved = await tx<{ seconds: number }[]>`
      UPDATE day_items
         SET client_id = ${moveTo}, bucket = ${moveTo === null ? 'unassigned' : 'client'}
       WHERE client_id = ${id}
      RETURNING seconds`;

    // Comentarios: si el destino ya tiene uno ese día, se juntan los dos.
    await tx`
      INSERT INTO day_notes (user_id, date, client_id, note)
      SELECT user_id, date, ${moveTo}, ${moveTo === null ? sql`${client.name} || ': ' || note` : sql`note`}
        FROM day_notes WHERE client_id = ${id}
      ON CONFLICT (user_id, date, (COALESCE(client_id, 0)))
        DO UPDATE SET note = left(day_notes.note || E'\n\n' || EXCLUDED.note, ${MAX_NOTE_LENGTH})`;
    await tx`DELETE FROM day_notes WHERE client_id = ${id}`;

    if (moveTo !== null) await tx`UPDATE rules SET client_id = ${moveTo} WHERE client_id = ${id}`;
    await tx`DELETE FROM clients WHERE id = ${id}`; // Las reglas que queden se borran en cascada.
    return { deleted: client.name, movedSeconds: moved.reduce((s, r) => s + r.seconds, 0), movedTo: targetName };
  });
  return c.json(result);
});
