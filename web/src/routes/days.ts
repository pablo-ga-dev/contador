import { Hono } from 'hono';
import { requireUser, type AppEnv } from '../auth/middleware.ts';
import { sql } from '../db/index.ts';
import { HttpError, jsonBody, text } from '../http.ts';

const KINDS = ['domain', 'chat', 'app'] as const;
const BUCKETS = ['client', 'internal', 'unassigned'] as const;
const MAX_ITEMS = 2000;
const DAY_SECONDS = 24 * 3600;

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
 * El agente envía un día confirmado. Si ya existía, se sustituye entero: así
 * se puede corregir un día volviéndolo a confirmar.
 */
dayRoutes.put('/:date', async (c) => {
  const date = c.req.param('date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    throw new HttpError(400, 'Fecha no válida (formato AAAA-MM-DD).');
  }
  const body = await jsonBody(c);
  if (!Array.isArray(body.items) || body.items.length > MAX_ITEMS) {
    throw new HttpError(400, `items debe ser una lista de como mucho ${MAX_ITEMS} actividades.`);
  }
  const items = body.items.map(parseItem);
  const user = c.get('user');

  try {
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO days (user_id, date) VALUES (${user.id}, ${date})
        ON CONFLICT (user_id, date) DO UPDATE SET confirmed_at = now()`;
      await tx`DELETE FROM day_items WHERE user_id = ${user.id} AND date = ${date}`;
      if (items.length > 0) {
        const rows = items.map((i) => ({
          user_id: user.id,
          date,
          kind: i.kind,
          key: i.key,
          seconds: i.seconds,
          bucket: i.bucket,
          client_id: i.clientId,
        }));
        await tx`INSERT INTO day_items ${tx(rows)}`;
      }
      for (const i of items) {
        if (!i.remember || i.clientId === null) continue;
        await tx`
          INSERT INTO rules (kind, key, client_id, updated_by)
          VALUES (${i.kind}, ${i.key}, ${i.clientId}, ${user.id})
          ON CONFLICT (kind, key) DO UPDATE
            SET client_id = EXCLUDED.client_id, updated_by = EXCLUDED.updated_by, updated_at = now()`;
      }
    });
  } catch (err) {
    if ((err as { code?: string }).code === '23503') throw new HttpError(400, 'Algún cliente no existe.');
    throw err;
  }
  return c.json({ date, items: items.length });
});

function parseItem(raw: unknown, index: number): DayItem {
  const where = `la actividad ${index + 1}`;
  if (!raw || typeof raw !== 'object') throw new HttpError(400, `${where} no es un objeto.`);
  const r = raw as Record<string, unknown>;
  if (!KINDS.includes(r.kind as Kind)) throw new HttpError(400, `${where}: kind no válido.`);
  if (!BUCKETS.includes(r.bucket as Bucket)) throw new HttpError(400, `${where}: bucket no válido.`);
  const seconds = r.seconds;
  if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 0 || seconds > DAY_SECONDS) {
    throw new HttpError(400, `${where}: seconds no válido.`);
  }
  const clientId = r.clientId ?? null;
  if (r.bucket === 'client' ? typeof clientId !== 'number' : clientId !== null) {
    throw new HttpError(400, `${where}: clientId solo va, y es obligatorio, cuando bucket es "client".`);
  }
  return {
    kind: r.kind as Kind,
    key: text(r.key, `la clave de ${where}`, 500),
    seconds,
    bucket: r.bucket as Bucket,
    clientId: clientId as number | null,
    remember: r.remember === true,
  };
}
