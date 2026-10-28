import { Hono } from 'hono';
import { requireUser, type AppEnv } from '../auth/middleware.ts';
import { budgetSummary, loadBudgets } from '../budget.ts';
import { sql } from '../db/index.ts';
import { HttpError, jsonBody, text } from '../http.ts';

/** El mismo límite que en day_notes: al juntar dos comentarios no se puede pasar de aquí. */
const MAX_NOTE_LENGTH = 2000;

export const clientRoutes = new Hono<AppEnv>();
clientRoutes.use(requireUser);

/** Lista de clientes; los que tienen seguimiento de horas llevan lo que les queda (para avisar). */
clientRoutes.get('/', async (c) => {
  const [clients, budgets] = await Promise.all([
    sql<{ id: number; name: string }[]>`SELECT id, name FROM clients ORDER BY lower(name)`,
    loadBudgets(),
  ]);
  return c.json(clients.map((cl) => ({ ...cl, hours: budgetSummary(budgets.get(cl.id)) })));
});

/** Activa o desactiva el seguimiento de horas y fija la cuota mensual y desde cuándo se cuenta. */
clientRoutes.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await jsonBody(c);
  const [current] = await sql<{ track_hours: boolean; tracking_since: string | null }[]>`
    SELECT track_hours, tracking_since::text AS tracking_since FROM clients WHERE id = ${id}`;
  if (!current) throw new HttpError(404, 'Ese cliente no existe.');

  const track = typeof body.trackHours === 'boolean' ? body.trackHours : current.track_hours;
  let monthly: number | null | undefined;
  if (body.monthlyHours !== undefined) {
    monthly = body.monthlyHours === null || body.monthlyHours === 0 ? null : hoursToSeconds(body.monthlyHours, 'Las horas mensuales');
  }
  let since = current.tracking_since;
  if (body.trackingSince !== undefined) since = parseDate(body.trackingSince, 'La fecha de inicio');
  // Al activarlo por primera vez, se cuenta desde el día 1 de este mes.
  if (track && !since) {
    since = (await sql<{ d: string }[]>`SELECT date_trunc('month', current_date)::date::text AS d`)[0]!.d;
  }

  await sql`
    UPDATE clients
       SET track_hours = ${track},
           tracking_since = ${since},
           monthly_seconds = ${monthly === undefined ? sql`monthly_seconds` : monthly}
     WHERE id = ${id}`;
  return c.json((await loadBudgets([id])).get(id));
});

/** Añade un bono de horas (no caduca). */
clientRoutes.post('/:id/packs', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await jsonBody(c);
  const seconds = hoursToSeconds(body.hours, 'Las horas del bono');
  const purchasedOn = body.purchasedOn ? parseDate(body.purchasedOn, 'La fecha de compra') : null;
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 200) : null;
  try {
    await sql`
      INSERT INTO client_packs (client_id, seconds, purchased_on, note, created_by)
      VALUES (${id}, ${seconds}, ${purchasedOn ?? sql`current_date`}, ${note}, ${c.get('user').id})`;
  } catch (err) {
    if ((err as { code?: string }).code === '23503') throw new HttpError(404, 'Ese cliente no existe.');
    throw err;
  }
  return c.json((await loadBudgets([id])).get(id), 201);
});

clientRoutes.delete('/:id/packs/:packId', async (c) => {
  const id = Number(c.req.param('id'));
  const packId = Number(c.req.param('packId'));
  const deleted = await sql`DELETE FROM client_packs WHERE id = ${packId} AND client_id = ${id} RETURNING id`;
  if (deleted.length === 0) throw new HttpError(404, 'Ese bono no existe.');
  return c.json((await loadBudgets([id])).get(id));
});

/** Horas (admite decimales: 1,5 = 1 h 30 min) a segundos. Entre 1 minuto y 10 000 h. */
function hoursToSeconds(value: unknown, what: string): number {
  const hours = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (!Number.isFinite(hours) || hours <= 0 || hours > 10000) throw new HttpError(400, `${what} no son válidas.`);
  const seconds = Math.round(hours * 3600);
  if (seconds < 60) throw new HttpError(400, `${what} deben ser al menos 1 minuto.`);
  return seconds;
}

function parseDate(value: unknown, what: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, `${what} no es válida (AAAA-MM-DD).`);
  }
  return value;
}

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

    if (moveTo !== null) {
      await tx`UPDATE rules SET client_id = ${moveTo} WHERE client_id = ${id}`;
      await tx`UPDATE client_packs SET client_id = ${moveTo} WHERE client_id = ${id}`; // Sus bonos también.
    }
    await tx`DELETE FROM clients WHERE id = ${id}`; // Las reglas que queden se borran en cascada.
    return { deleted: client.name, movedSeconds: moved.reduce((s, r) => s + r.seconds, 0), movedTo: targetName };
  });
  return c.json(result);
});
