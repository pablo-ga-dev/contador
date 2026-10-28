import { Hono } from 'hono';
import { requireUser, type AppEnv } from '../auth/middleware.ts';
import { budgetSummary, loadBudgets } from '../budget.ts';
import { sql } from '../db/index.ts';
import { HttpError } from '../http.ts';

/** Informes de tiempo. De momento todo el equipo ve los tiempos de todos. */
export const reportRoutes = new Hono<AppEnv>();
reportRoutes.use(requireUser);

type Bucket = 'client' | 'internal' | 'unassigned';

/** En el resumen de un cliente: cuántas actividades y comentarios recientes se muestran. */
const TOP_ACTIVITIES = 20;
const RECENT_NOTES = 30;

interface Totals {
  client: number;
  internal: number;
  unassigned: number;
}

/**
 * Semana por persona: para cada usuario y día (de lunes a domingo), el tiempo
 * confirmado por tipo. Un día sin confirmar no aparece.
 */
reportRoutes.get('/week', async (c) => {
  const start = parseDate(c.req.query('start'));
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const end = days[6]!;

  const users = await sql<{ id: number; name: string }[]>`SELECT id, name FROM users ORDER BY lower(name)`;
  const rows = await sql<{ user_id: number; date: string; bucket: Bucket; seconds: string }[]>`
    SELECT d.user_id, d.date::text AS date, i.bucket, COALESCE(SUM(i.seconds), 0) AS seconds
      FROM days d LEFT JOIN day_items i USING (user_id, date)
     WHERE d.date BETWEEN ${start} AND ${end}
     GROUP BY d.user_id, d.date, i.bucket`;

  const byUser = new Map(users.map((u) => [u.id, { ...u, days: {} as Record<string, Totals> }]));
  for (const r of rows) {
    const user = byUser.get(r.user_id);
    if (!user) continue;
    const day = (user.days[r.date] ??= { client: 0, internal: 0, unassigned: 0 });
    if (r.bucket) day[r.bucket] += Number(r.seconds);
  }
  return c.json({ days, users: [...byUser.values()] });
});

/** Detalle de un día de una persona: por cliente (o interno / sin cliente), con sus actividades. */
reportRoutes.get('/day', async (c) => {
  const date = parseDate(c.req.query('date'));
  const userId = parseId(c.req.query('userId'), 'la persona');
  const [user] = await sql<{ id: number; name: string }[]>`SELECT id, name FROM users WHERE id = ${userId}`;
  if (!user) throw new HttpError(404, 'Esa persona no existe.');
  const [day] = await sql<{ confirmed_at: Date }[]>`
    SELECT confirmed_at FROM days WHERE user_id = ${userId} AND date = ${date}`;
  const items = await sql<{ bucket: Bucket; client_id: number | null; client_name: string | null; kind: string; key: string; seconds: number }[]>`
    SELECT i.bucket, i.client_id, c.name AS client_name, i.kind, i.key, i.seconds
      FROM day_items i LEFT JOIN clients c ON c.id = i.client_id
     WHERE i.user_id = ${userId} AND i.date = ${date}
     ORDER BY i.seconds DESC`;
  const notes = await sql<{ client_id: number | null; note: string }[]>`
    SELECT client_id, note FROM day_notes WHERE user_id = ${userId} AND date = ${date}`;
  // Cada comentario de cliente va con su grupo; el general, aparte.
  const groups = groupItems(items).map((g) => ({
    ...g,
    note: g.bucket === 'client' ? notes.find((n) => n.client_id === g.clientId)?.note ?? null : null,
  }));
  return c.json({
    user,
    date,
    confirmedAt: day?.confirmed_at ?? null,
    note: notes.find((n) => n.client_id === null)?.note ?? null,
    groups,
  });
});

/** Mes por cliente: total de cada cliente (y de interno / sin cliente), con el reparto por persona. */
reportRoutes.get('/month', async (c) => {
  const { from, to, month } = parseMonth(c.req.query('month'));
  const rows = await sql<{ bucket: Bucket; client_id: number | null; client_name: string | null; user_id: number; user_name: string; seconds: string }[]>`
    SELECT i.bucket, i.client_id, c.name AS client_name, i.user_id, u.name AS user_name, SUM(i.seconds) AS seconds
      FROM day_items i
      JOIN users u ON u.id = i.user_id
      LEFT JOIN clients c ON c.id = i.client_id
     WHERE i.date >= ${from} AND i.date < ${to}
     GROUP BY i.bucket, i.client_id, c.name, i.user_id, u.name`;

  const groups = new Map<string, { bucket: Bucket; clientId: number | null; name: string; seconds: number; byUser: { userId: number; name: string; seconds: number }[] }>();
  for (const r of rows) {
    const id = r.bucket === 'client' ? `c${r.client_id}` : r.bucket;
    const group = groups.get(id) ?? { bucket: r.bucket, clientId: r.client_id, name: r.client_name ?? '', seconds: 0, byUser: [] };
    group.seconds += Number(r.seconds);
    group.byUser.push({ userId: r.user_id, name: r.user_name, seconds: Number(r.seconds) });
    groups.set(id, group);
  }
  const list = [...groups.values()];
  list.forEach((g) => g.byUser.sort((a, b) => b.seconds - a.seconds));
  // Clientes primero (de más a menos tiempo); después interno y sin cliente.
  const order = (g: { bucket: Bucket }) => ({ client: 0, internal: 1, unassigned: 2 })[g.bucket];
  list.sort((a, b) => order(a) - order(b) || b.seconds - a.seconds);
  return c.json({ month, groups: list });
});

/** Detalle de un cliente (o de interno / sin cliente) en un mes: actividades, personas y días. */
reportRoutes.get('/month/detail', async (c) => {
  const { from, to, month } = parseMonth(c.req.query('month'));
  const bucketParam = c.req.query('bucket');
  let clientId: number | null = null;
  let name: string;
  if (bucketParam === 'internal' || bucketParam === 'unassigned') {
    name = bucketParam === 'internal' ? 'Interno' : 'Sin cliente';
  } else {
    clientId = parseId(c.req.query('clientId'), 'el cliente');
    const [client] = await sql<{ name: string }[]>`SELECT name FROM clients WHERE id = ${clientId}`;
    if (!client) throw new HttpError(404, 'Ese cliente no existe.');
    name = client.name;
  }
  const match = clientId === null
    ? sql`i.bucket = ${bucketParam!}`
    : sql`i.client_id = ${clientId}`;
  const where = sql`${match} AND i.date >= ${from} AND i.date < ${to}`;

  const [activities, byUser, byDay] = await Promise.all([
    sql`SELECT i.kind, i.key, SUM(i.seconds)::int AS seconds
          FROM day_items i WHERE ${where}
         GROUP BY i.kind, i.key ORDER BY seconds DESC`,
    sql`SELECT u.id AS "userId", u.name, SUM(i.seconds)::int AS seconds
          FROM day_items i JOIN users u ON u.id = i.user_id WHERE ${where}
         GROUP BY u.id, u.name ORDER BY seconds DESC`,
    sql`SELECT i.date::text AS date, SUM(i.seconds)::int AS seconds
          FROM day_items i WHERE ${where}
         GROUP BY i.date ORDER BY i.date`,
  ]);
  const notes = clientId === null ? [] : await sql`
    SELECT n.date::text AS date, u.name AS "userName", n.note
      FROM day_notes n JOIN users u ON u.id = n.user_id
     WHERE n.client_id = ${clientId} AND n.date >= ${from} AND n.date < ${to}
     ORDER BY n.date DESC, u.name`;
  return c.json({ month, clientId, name, activities, byUser, byDay, notes });
});

/** Tiempo total de cada cliente desde siempre, para la lista de Clientes. */
reportRoutes.get('/clients', async (c) => {
  const rows = await sql<{ id: number; seconds: number; last_date: string | null }[]>`
    SELECT client_id AS id, SUM(seconds)::int AS seconds, MAX(date)::text AS last_date
      FROM day_items WHERE client_id IS NOT NULL GROUP BY client_id`;
  return c.json(rows.map((r) => ({ id: r.id, seconds: r.seconds, lastDate: r.last_date })));
});

/** Clientes con seguimiento de horas que las han agotado o se han pasado. */
reportRoutes.get('/alerts', async (c) => {
  const budgets = await loadBudgets();
  const ids = [...budgets].filter(([, b]) => b.status === 'exhausted' || b.status === 'over').map(([id]) => id);
  if (ids.length === 0) return c.json([]);
  const names = await sql<{ id: number; name: string }[]>`SELECT id, name FROM clients WHERE id IN ${sql(ids)}`;
  return c.json(
    names
      .map((n) => ({ id: n.id, name: n.name, ...budgetSummary(budgets.get(n.id))! }))
      .sort((a, b) => b.excess - a.excess || a.name.localeCompare(b.name, 'es')),
  );
});

/** Todo lo de un cliente: total, por mes, por persona, actividades y comentarios recientes. */
reportRoutes.get('/clients/:id', async (c) => {
  const clientId = parseId(c.req.param('id'), 'el cliente');
  const [client] = await sql<{ id: number; name: string; created_at: Date }[]>`
    SELECT id, name, created_at FROM clients WHERE id = ${clientId}`;
  if (!client) throw new HttpError(404, 'Ese cliente no existe.');

  const [byMonth, byUser, activities, notes] = await Promise.all([
    sql`SELECT to_char(date, 'YYYY-MM') AS month, SUM(seconds)::int AS seconds
          FROM day_items WHERE client_id = ${clientId}
         GROUP BY 1 ORDER BY 1 DESC`,
    sql`SELECT u.id AS "userId", u.name, SUM(i.seconds)::int AS seconds, MAX(i.date)::text AS "lastDate"
          FROM day_items i JOIN users u ON u.id = i.user_id WHERE i.client_id = ${clientId}
         GROUP BY u.id, u.name ORDER BY seconds DESC`,
    sql`SELECT kind, key, SUM(seconds)::int AS seconds
          FROM day_items WHERE client_id = ${clientId}
         GROUP BY kind, key ORDER BY seconds DESC LIMIT ${TOP_ACTIVITIES}`,
    sql`SELECT n.date::text AS date, u.name AS "userName", n.note
          FROM day_notes n JOIN users u ON u.id = n.user_id
         WHERE n.client_id = ${clientId}
         ORDER BY n.date DESC, u.name LIMIT ${RECENT_NOTES}`,
  ]);
  const total = (byMonth as unknown as { seconds: number }[]).reduce((s, m) => s + m.seconds, 0);
  return c.json({
    id: client.id,
    name: client.name,
    createdAt: client.created_at,
    totalSeconds: total,
    byMonth,
    byUser,
    activities,
    notes,
    hours: (await loadBudgets([clientId])).get(clientId),
  });
});

function groupItems(items: { bucket: Bucket; client_id: number | null; client_name: string | null; kind: string; key: string; seconds: number }[]) {
  const groups = new Map<string, { bucket: Bucket; clientId: number | null; name: string; seconds: number; items: { kind: string; key: string; seconds: number }[] }>();
  for (const i of items) {
    const id = i.bucket === 'client' ? `c${i.client_id}` : i.bucket;
    const group = groups.get(id) ?? { bucket: i.bucket, clientId: i.client_id, name: i.client_name ?? '', seconds: 0, items: [] };
    group.seconds += i.seconds;
    group.items.push({ kind: i.kind, key: i.key, seconds: i.seconds });
    groups.set(id, group);
  }
  const order = (g: { bucket: Bucket }) => ({ client: 0, internal: 1, unassigned: 2 })[g.bucket];
  return [...groups.values()].sort((a, b) => order(a) - order(b) || b.seconds - a.seconds);
}

function parseDate(value: string | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, 'Fecha no válida (formato AAAA-MM-DD).');
  }
  return value;
}

function parseMonth(value: string | undefined): { month: string; from: string; to: string } {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new HttpError(400, 'Mes no válido (formato AAAA-MM).');
  const [y, m] = value.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { month: value, from: `${value}-01`, to: `${next}-01` };
}

function parseId(value: string | undefined, what: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, `Falta ${what}.`);
  return id;
}

/** Suma días a una fecha AAAA-MM-DD (en UTC, para no depender de la zona horaria del servidor). */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
