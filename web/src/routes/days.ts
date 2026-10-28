import { Hono } from 'hono';
import { requireUser, type AppEnv } from '../auth/middleware.ts';
import { today } from '../config.ts';
import { MISSING_REFERENCE, db, errorCode, rows, sql } from '../db/index.ts';
import { HttpError, jsonBody, parseDate, parseId, text } from '../http.ts';

/** "manual": tiempo apuntado a mano; su clave es la descripción. */
const KINDS = ['domain', 'chat', 'app', 'manual'] as const;
/** "unassigned" solo se acepta para sumarlo al total del día: su detalle no se guarda. */
const BUCKETS = ['client', 'internal', 'unassigned'] as const;
const MAX_ITEMS = 2000;
const MAX_KEY_LENGTH = 255;
const MAX_NOTES = 100;
const MAX_NOTE_LENGTH = 2000;
const DAY_SECONDS = 24 * 3600;

/** Comentario del día: general (clientId null) o de un cliente. */
interface DayNote {
  clientId: number | null;
  text: string;
}

type Kind = (typeof KINDS)[number];
type Bucket = (typeof BUCKETS)[number];

interface DayItem {
  kind: Kind;
  key: string;
  seconds: number;
  bucket: Bucket;
  clientId: number | null;
  /** Guardar "esta actividad → este cliente" como regla del equipo. */
  remember: boolean;
}

export const dayRoutes = new Hono<AppEnv>();
dayRoutes.use(requireUser);

/**
 * El agente envía un día confirmado. Si ya existía, se sustituye todo lo que envió
 * el agente (así se puede corregir volviéndolo a confirmar); lo apuntado a mano en
 * la web se conserva.
 *
 * "Sin cliente" llega solo como total (unassignedSeconds): su detalle se queda en el PC.
 * Las partidas "unassigned" que envíe un agente antiguo se suman a ese total.
 */
dayRoutes.put('/:date', async (c) => {
  const date = parseDate(c.req.param('date'));
  const body = await jsonBody(c);
  if (!Array.isArray(body.items) || body.items.length > MAX_ITEMS) {
    throw new HttpError(400, `items debe ser una lista de como mucho ${MAX_ITEMS} actividades.`);
  }
  const parsed = body.items.map(parseItem);
  const items = parsed.filter((i) => i.bucket !== 'unassigned');
  const unassigned = Math.min(
    DAY_SECONDS,
    parseSeconds(body.unassignedSeconds ?? 0, 'unassignedSeconds') +
      parsed.filter((i) => i.bucket === 'unassigned').reduce((s, i) => s + i.seconds, 0),
  );
  const notes = parseNotes(body.notes);
  const user = c.get('user');

  try {
    await db.transaction(async (tx) => {
      await tx.exec(sql`
        INSERT INTO days (user_id, date, confirmed_at, unassigned_seconds)
        VALUES (${user.id}, ${date}, UTC_TIMESTAMP(), ${unassigned})
        ON DUPLICATE KEY UPDATE confirmed_at = UTC_TIMESTAMP(), unassigned_seconds = VALUES(unassigned_seconds)`);
      await tx.exec(sql`DELETE FROM day_items WHERE user_id = ${user.id} AND date = ${date} AND source = 'agent'`);
      if (items.length > 0) {
        await tx.exec(sql`
          INSERT INTO day_items (user_id, date, kind, activity_key, seconds, bucket, client_id, source)
          VALUES ${rows(items.map((i) => [user.id, date, i.kind, i.key, i.seconds, i.bucket, i.clientId, 'agent']))}`);
      }
      for (const i of items) {
        if (!i.remember || i.clientId === null) continue;
        await tx.exec(sql`
          INSERT INTO rules (kind, activity_key, client_id, updated_by)
          VALUES (${i.kind}, ${i.key}, ${i.clientId}, ${user.id})
          ON DUPLICATE KEY UPDATE
            client_id = VALUES(client_id), updated_by = VALUES(updated_by), updated_at = UTC_TIMESTAMP()`);
      }
      await tx.exec(sql`DELETE FROM day_notes WHERE user_id = ${user.id} AND date = ${date}`);
      if (notes.length > 0) {
        await tx.exec(sql`
          INSERT INTO day_notes (user_id, date, client_id, note)
          VALUES ${rows(notes.map((n) => [user.id, date, n.clientId, n.text]))}`);
      }
    });
  } catch (err) {
    if (errorCode(err) === MISSING_REFERENCE) throw new HttpError(400, 'Algún cliente no existe.');
    throw err;
  }
  return c.json({ date, items: items.length, notes: notes.length });
});

/**
 * Tiempo apuntado a mano desde la web, para uno mismo: a un cliente o a interno,
 * con una descripción. Si el día no existía, se crea sin confirmar.
 */
dayRoutes.post('/:date/manual', async (c) => {
  const date = parseDate(c.req.param('date'));
  if (date > today()) throw new HttpError(400, 'No se puede apuntar tiempo en un día que aún no ha llegado.');
  const body = await jsonBody(c);
  const seconds = parseSeconds(body.seconds, 'El tiempo');
  if (seconds < 60) throw new HttpError(400, 'Apunta al menos un minuto.');
  const bucket = body.bucket;
  if (bucket !== 'client' && bucket !== 'internal') {
    throw new HttpError(400, 'El tiempo manual va a un cliente o a interno.');
  }
  const clientId = bucket === 'client' ? parseId(body.clientId, 'el cliente') : null;
  const description = text(body.description, 'la descripción', MAX_KEY_LENGTH);
  const user = c.get('user');

  try {
    const id = await db.transaction(async (tx) => {
      await tx.exec(sql`INSERT IGNORE INTO days (user_id, date) VALUES (${user.id}, ${date})`);
      const result = await tx.exec(sql`
        INSERT INTO day_items (user_id, date, kind, activity_key, seconds, bucket, client_id, source)
        VALUES (${user.id}, ${date}, 'manual', ${description}, ${seconds}, ${bucket}, ${clientId}, 'web')`);
      return result.insertId;
    });
    return c.json({ id, date, seconds, bucket, clientId, description }, 201);
  } catch (err) {
    if (errorCode(err) === MISSING_REFERENCE) throw new HttpError(400, 'Ese cliente no existe.');
    throw err;
  }
});

/** Borra tiempo apuntado a mano en la web. Cada uno solo el suyo; lo del agente se corrige en la app. */
dayRoutes.delete('/manual/:id', async (c) => {
  const id = parseId(c.req.param('id'), 'el tiempo manual');
  const user = c.get('user');
  await db.transaction(async (tx) => {
    const item = await tx.one<{ date: string }>(sql`
      SELECT date FROM day_items WHERE id = ${id} AND user_id = ${user.id} AND source = 'web' FOR UPDATE`);
    if (!item) throw new HttpError(404, 'Ese tiempo manual no existe o no es tuyo.');
    await tx.exec(sql`DELETE FROM day_items WHERE id = ${id}`);
    // Un día que solo existía por este tiempo manual desaparece al quedarse vacío.
    await tx.exec(sql`
      DELETE FROM days
       WHERE user_id = ${user.id} AND date = ${item.date} AND confirmed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM day_items WHERE user_id = ${user.id} AND date = ${item.date})`);
  });
  return c.body(null, 204);
});

function parseSeconds(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > DAY_SECONDS) {
    throw new HttpError(400, `${what} no es válido.`);
  }
  return value;
}

/** Comentarios opcionales: vacíos se ignoran y, si se repite un cliente, vale el último. */
function parseNotes(raw: unknown): DayNote[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_NOTES) {
    throw new HttpError(400, `notes debe ser una lista de como mucho ${MAX_NOTES} comentarios.`);
  }
  const byClient = new Map<number | null, DayNote>();
  raw.forEach((n, index) => {
    const r = (n && typeof n === 'object' ? n : {}) as Record<string, unknown>;
    const clientId = r.clientId ?? null;
    if (clientId !== null && (typeof clientId !== 'number' || !Number.isInteger(clientId))) {
      throw new HttpError(400, `El comentario ${index + 1}: clientId no válido.`);
    }
    if (typeof r.text !== 'string') throw new HttpError(400, `El comentario ${index + 1}: falta el texto.`);
    const text = r.text.trim();
    if (text.length > MAX_NOTE_LENGTH) {
      throw new HttpError(400, `El comentario ${index + 1} supera los ${MAX_NOTE_LENGTH} caracteres.`);
    }
    if (text) byClient.set(clientId as number | null, { clientId: clientId as number | null, text });
  });
  return [...byClient.values()];
}

function parseItem(raw: unknown, index: number): DayItem {
  const where = `la actividad ${index + 1}`;
  if (!raw || typeof raw !== 'object') throw new HttpError(400, `${where} no es un objeto.`);
  const r = raw as Record<string, unknown>;
  if (!KINDS.includes(r.kind as Kind)) throw new HttpError(400, `${where}: kind no válido.`);
  if (!BUCKETS.includes(r.bucket as Bucket)) throw new HttpError(400, `${where}: bucket no válido.`);
  const seconds = parseSeconds(r.seconds, `${where}: seconds`);
  const clientId = r.clientId ?? null;
  if (r.bucket === 'client' ? typeof clientId !== 'number' : clientId !== null) {
    throw new HttpError(400, `${where}: clientId solo va, y es obligatorio, cuando bucket es "client".`);
  }
  if (r.kind === 'manual' && r.bucket === 'unassigned') {
    throw new HttpError(400, `${where}: el tiempo manual va a un cliente o a interno.`);
  }
  return {
    kind: r.kind as Kind,
    key: text(r.key, `la clave de ${where}`, MAX_KEY_LENGTH),
    seconds,
    bucket: r.bucket as Bucket,
    clientId: clientId as number | null,
    // Las reglas son para webs, chats y apps; el tiempo manual no se recuerda.
    remember: r.remember === true && r.kind !== 'manual',
  };
}
