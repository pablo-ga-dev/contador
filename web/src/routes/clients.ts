import { Hono } from 'hono';
import { requireAdmin, requireUser, type AppEnv } from '../auth/middleware.ts';
import { budgetSummary, loadBudgets } from '../budget.ts';
import { today } from '../config.ts';
import { DUPLICATE, MISSING_REFERENCE, db, errorCode, sql } from '../db/index.ts';
import { HttpError, jsonBody, parseDate, parseId, text } from '../http.ts';

/** El mismo límite que en day_notes: al juntar dos comentarios no se puede pasar de aquí. */
const MAX_NOTE_LENGTH = 2000;

export const clientRoutes = new Hono<AppEnv>();
clientRoutes.use(requireUser);

/** Lista de clientes; los que tienen seguimiento de horas llevan lo que les queda (para avisar). */
clientRoutes.get('/', async (c) => {
  const [clients, budgets] = await Promise.all([
    db.query<{ id: number; name: string }>(sql`SELECT id, name FROM clients ORDER BY name`),
    loadBudgets(),
  ]);
  return c.json(clients.map((cl) => ({ ...cl, hours: budgetSummary(budgets.get(cl.id)) })));
});

/** Cualquiera puede crear clientes: hace falta al revisar el día. */
clientRoutes.post('/', async (c) => {
  const name = text((await jsonBody(c)).name, 'el nombre del cliente', 120);
  try {
    const result = await db.exec(sql`INSERT INTO clients (name, created_by) VALUES (${name}, ${c.get('user').id})`);
    return c.json({ id: result.insertId, name }, 201);
  } catch (err) {
    if (errorCode(err) !== DUPLICATE) throw err;
  }
  // Ya existía (quizá lo creó un compañero a la vez, o con otras mayúsculas o tildes): lo devolvemos.
  const existing = await db.one<{ id: number; name: string }>(sql`SELECT id, name FROM clients WHERE name = ${name}`);
  if (!existing) throw new HttpError(409, 'No se pudo crear el cliente.');
  return c.json(existing, 200);
});

/**
 * Borra un cliente sin perder el tiempo confirmado: su tiempo, comentarios, reglas y bonos
 * pasan a otro cliente (útil para unir duplicados) o, si moveTo es null, a "Sin cliente"
 * (los comentarios, al comentario general del día; las reglas y bonos se borran).
 */
clientRoutes.delete('/:id', requireAdmin, async (c) => {
  const id = parseId(c.req.param('id'), 'el cliente');
  const rawMoveTo = (await jsonBody(c)).moveTo ?? null;
  if (rawMoveTo !== null && (!Number.isInteger(rawMoveTo) || rawMoveTo === id)) {
    throw new HttpError(400, 'Elige otro cliente al que pasar el tiempo.');
  }
  const moveTo = rawMoveTo as number | null;

  const result = await db.transaction(async (tx) => {
    const client = await tx.one<{ name: string }>(sql`SELECT name FROM clients WHERE id = ${id} FOR UPDATE`);
    if (!client) throw new HttpError(404, 'Ese cliente ya no existe.');
    let targetName: string | null = null;
    if (moveTo !== null) {
      const target = await tx.one<{ name: string }>(sql`SELECT name FROM clients WHERE id = ${moveTo}`);
      if (!target) throw new HttpError(400, 'El cliente al que pasar el tiempo no existe.');
      targetName = target.name;
    }

    const moved = await tx.one<{ seconds: number }>(sql`
      SELECT COALESCE(SUM(seconds), 0) AS seconds FROM day_items WHERE client_id = ${id}`);
    if (moveTo !== null) {
      await tx.exec(sql`UPDATE day_items SET client_id = ${moveTo} WHERE client_id = ${id}`);
    } else {
      // "Sin cliente" se guarda solo como total del día: se suma ahí y se quita el detalle.
      await tx.exec(sql`
        UPDATE days d
          JOIN (SELECT user_id, date, SUM(seconds) AS seconds FROM day_items
                 WHERE client_id = ${id} GROUP BY user_id, date) m
            ON m.user_id = d.user_id AND m.date = d.date
           SET d.unassigned_seconds = d.unassigned_seconds + m.seconds`);
      await tx.exec(sql`DELETE FROM day_items WHERE client_id = ${id}`);
    }

    // Comentarios: si el destino ya tiene uno ese día, se juntan los dos.
    const notes = await tx.query<{ id: number; user_id: number; date: string; note: string }>(sql`
      SELECT id, user_id, date, note FROM day_notes WHERE client_id = ${id} ORDER BY date`);
    for (const n of notes) {
      const text = moveTo === null ? `${client.name}: ${n.note}` : n.note;
      const existing = await tx.one<{ id: number; note: string }>(sql`
        SELECT id, note FROM day_notes
         WHERE user_id = ${n.user_id} AND date = ${n.date} AND client_id <=> ${moveTo}`);
      if (existing) {
        await tx.exec(sql`
          UPDATE day_notes SET note = ${`${existing.note}\n\n${text}`.slice(0, MAX_NOTE_LENGTH)} WHERE id = ${existing.id}`);
        await tx.exec(sql`DELETE FROM day_notes WHERE id = ${n.id}`);
      } else {
        await tx.exec(sql`UPDATE day_notes SET client_id = ${moveTo}, note = ${text} WHERE id = ${n.id}`);
      }
    }

    if (moveTo !== null) {
      await tx.exec(sql`UPDATE rules SET client_id = ${moveTo} WHERE client_id = ${id}`);
      await tx.exec(sql`UPDATE client_packs SET client_id = ${moveTo} WHERE client_id = ${id}`);
    }
    await tx.exec(sql`DELETE FROM clients WHERE id = ${id}`); // Lo que quede (reglas, bonos) se borra en cascada.
    return { deleted: client.name, movedSeconds: Number(moved?.seconds ?? 0), movedTo: targetName };
  });
  return c.json(result);
});

/** Activa o desactiva el seguimiento de horas y fija la cuota mensual y desde cuándo se cuenta. */
clientRoutes.patch('/:id', requireAdmin, async (c) => {
  const id = parseId(c.req.param('id'), 'el cliente');
  const body = await jsonBody(c);
  const current = await db.one<{ track_hours: number; tracking_since: string | null; monthly_seconds: number | null }>(sql`
    SELECT track_hours, tracking_since, monthly_seconds FROM clients WHERE id = ${id}`);
  if (!current) throw new HttpError(404, 'Ese cliente no existe.');

  const track = typeof body.trackHours === 'boolean' ? body.trackHours : Boolean(current.track_hours);
  let monthly = current.monthly_seconds;
  if (body.monthlyHours !== undefined) {
    monthly = body.monthlyHours === null || body.monthlyHours === 0 ? null : hoursToSeconds(body.monthlyHours, 'Las horas mensuales');
  }
  let since = current.tracking_since;
  if (body.trackingSince !== undefined) since = parseDate(body.trackingSince, 'La fecha de inicio');
  // Al activarlo por primera vez, se cuenta desde el día 1 de este mes.
  if (track && !since) since = `${today().slice(0, 7)}-01`;

  await db.exec(sql`
    UPDATE clients SET track_hours = ${track}, tracking_since = ${since}, monthly_seconds = ${monthly}
     WHERE id = ${id}`);
  return c.json((await loadBudgets([id])).get(id));
});

/** Añade un bono de horas (no caduca). */
clientRoutes.post('/:id/packs', requireAdmin, async (c) => {
  const id = parseId(c.req.param('id'), 'el cliente');
  const body = await jsonBody(c);
  const seconds = hoursToSeconds(body.hours, 'Las horas del bono');
  const purchasedOn = body.purchasedOn ? parseDate(body.purchasedOn, 'La fecha de compra') : today();
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 200) : null;
  try {
    await db.exec(sql`
      INSERT INTO client_packs (client_id, seconds, purchased_on, note, created_by)
      VALUES (${id}, ${seconds}, ${purchasedOn}, ${note}, ${c.get('user').id})`);
  } catch (err) {
    if (errorCode(err) === MISSING_REFERENCE) throw new HttpError(404, 'Ese cliente no existe.');
    throw err;
  }
  return c.json((await loadBudgets([id])).get(id), 201);
});

clientRoutes.delete('/:id/packs/:packId', requireAdmin, async (c) => {
  const id = parseId(c.req.param('id'), 'el cliente');
  const packId = parseId(c.req.param('packId'), 'el bono');
  const result = await db.exec(sql`DELETE FROM client_packs WHERE id = ${packId} AND client_id = ${id}`);
  if (result.affectedRows === 0) throw new HttpError(404, 'Ese bono no existe.');
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
