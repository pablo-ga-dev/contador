import { Hono } from 'hono';
import { isAdmin, requireUser, type AppEnv, type User } from '../auth/middleware.ts';
import { budgetSummary, loadBudgets } from '../budget.ts';
import { Sql, db, iso, sql } from '../db/index.ts';
import { HttpError, parseDate, parseId } from '../http.ts';

/**
 * Informes de tiempo. Un administrador ve los de todo el equipo; un usuario,
 * solo los suyos (también en las fichas de cliente y en las estadísticas).
 */
export const reportRoutes = new Hono<AppEnv>();
reportRoutes.use(requireUser);

type Bucket = 'client' | 'internal' | 'unassigned';

/** En el resumen de un cliente: cuántas actividades y comentarios recientes se muestran. */
const TOP_ACTIVITIES = 20;
const RECENT_NOTES = 30;
/** Rango máximo de las estadísticas, para no recorrer años de datos por error. */
const MAX_RANGE_DAYS = 3 * 366;

interface Totals {
  client: number;
  internal: number;
  unassigned: number;
}

/** Condición "solo lo suyo" para un usuario normal (columna con el user_id de la tabla consultada). */
function mine(user: User, column: 'i.user_id' | 'n.user_id' | 'u.id' | 'd.user_id'): Sql {
  return isAdmin(user) ? sql`TRUE` : new Sql(`${column} = ?`, [user.id]);
}

/** Un usuario solo puede ver el detalle de sí mismo. */
function checkPerson(user: User, userId: number): void {
  if (!isAdmin(user) && userId !== user.id) throw new HttpError(403, 'Solo puedes ver tus propias horas.');
}

// --- Semana por persona y día ------------------------------------------------

/**
 * Semana por persona: para cada usuario y día (de lunes a domingo), el tiempo por
 * tipo. "Sin cliente" es solo el total que envía el agente. Un día sin nada no aparece;
 * confirmed dice si el agente lo ha confirmado (si no, solo tiene tiempo manual).
 */
reportRoutes.get('/week', async (c) => {
  const user = c.get('user');
  const start = parseDate(c.req.query('start'));
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const end = days[6]!;

  const users = await db.query<{ id: number; name: string }>(sql`
    SELECT id, name FROM users u WHERE ${mine(user, 'u.id')} ORDER BY name`);
  const rows = await db.query<{ user_id: number; date: string; confirmed_at: string | null; unassigned: number; client: number; internal: number }>(sql`
    SELECT d.user_id, d.date, d.confirmed_at, d.unassigned_seconds AS unassigned,
           COALESCE(SUM(CASE WHEN i.bucket = 'client' THEN i.seconds END), 0) AS client,
           COALESCE(SUM(CASE WHEN i.bucket = 'internal' THEN i.seconds END), 0) AS internal
      FROM days d LEFT JOIN day_items i ON i.user_id = d.user_id AND i.date = d.date
     WHERE d.date BETWEEN ${start} AND ${end} AND ${mine(user, 'd.user_id')}
     GROUP BY d.user_id, d.date, d.confirmed_at, d.unassigned_seconds`);

  const byUser = new Map(users.map((u) => [u.id, { ...u, days: {} as Record<string, Totals & { confirmed: boolean }> }]));
  for (const r of rows) {
    const person = byUser.get(r.user_id);
    if (!person) continue;
    person.days[r.date] = {
      client: Number(r.client),
      internal: Number(r.internal),
      unassigned: Number(r.unassigned),
      confirmed: r.confirmed_at !== null,
    };
  }
  return c.json({ days, users: [...byUser.values()] });
});

/**
 * Detalle de un día de una persona: por cliente (o interno), con sus actividades, y el
 * total sin cliente (sin detalle). Lo apuntado a mano en la web lleva su id para borrarlo.
 */
reportRoutes.get('/day', async (c) => {
  const date = parseDate(c.req.query('date'));
  const userId = parseId(c.req.query('userId'), 'la persona');
  checkPerson(c.get('user'), userId);
  const person = await db.one<{ id: number; name: string }>(sql`SELECT id, name FROM users WHERE id = ${userId}`);
  if (!person) throw new HttpError(404, 'Esa persona no existe.');
  const day = await db.one<{ confirmed_at: string | null; unassigned_seconds: number }>(sql`
    SELECT confirmed_at, unassigned_seconds FROM days WHERE user_id = ${userId} AND date = ${date}`);
  const items = await db.query<ItemRow>(sql`
    SELECT i.id, i.source, i.bucket, i.client_id, c.name AS client_name, i.kind, i.activity_key AS \`key\`, i.seconds
      FROM day_items i LEFT JOIN clients c ON c.id = i.client_id
     WHERE i.user_id = ${userId} AND i.date = ${date}
     ORDER BY i.seconds DESC`);
  const notes = await db.query<{ client_id: number | null; note: string }>(sql`
    SELECT client_id, note FROM day_notes WHERE user_id = ${userId} AND date = ${date}`);
  // Cada comentario de cliente va con su grupo; el general, aparte.
  const groups = groupItems(items).map((g) => ({
    ...g,
    note: g.bucket === 'client' ? notes.find((n) => n.client_id === g.clientId)?.note ?? null : null,
  }));
  return c.json({
    user: person,
    date,
    confirmedAt: iso(day?.confirmed_at ?? null),
    unassignedSeconds: Number(day?.unassigned_seconds ?? 0),
    note: notes.find((n) => n.client_id === null)?.note ?? null,
    groups,
  });
});

// --- Por cliente (mes o rango) --------------------------------------------------

/** Mes por cliente: total de cada cliente (y de interno / sin cliente), con el reparto por persona. */
reportRoutes.get('/month', async (c) => {
  const { from, to, month } = parseMonth(c.req.query('month'));
  return c.json({ month, groups: await clientGroups(c.get('user'), from, to) });
});

/** Detalle de un cliente (o de interno / sin cliente) en un mes: actividades, personas, días y comentarios. */
reportRoutes.get('/month/detail', async (c) => {
  const { from, to, month } = parseMonth(c.req.query('month'));
  const detail = await clientDetail(c.get('user'), from, to, c.req.query('clientId'), c.req.query('bucket'));
  return c.json({ month, ...detail });
});

/** Estadísticas: por cliente entre dos fechas (incluidas). */
reportRoutes.get('/range/clients', async (c) => {
  const { from, to, toExclusive } = parseRange(c.req.query('from'), c.req.query('to'));
  return c.json({ from, to, groups: await clientGroups(c.get('user'), from, toExclusive) });
});

reportRoutes.get('/range/clients/detail', async (c) => {
  const { from, to, toExclusive } = parseRange(c.req.query('from'), c.req.query('to'));
  const detail = await clientDetail(c.get('user'), from, toExclusive, c.req.query('clientId'), c.req.query('bucket'));
  return c.json({ from, to, ...detail });
});

/** Total sin cliente por persona entre dos fechas (solo se guarda el total de cada día). */
function unassignedByUser(user: User, from: string, to: string) {
  return db.query<{ user_id: number; user_name: string; seconds: number }>(sql`
    SELECT d.user_id, u.name AS user_name, SUM(d.unassigned_seconds) AS seconds
      FROM days d JOIN users u ON u.id = d.user_id
     WHERE d.date >= ${from} AND d.date < ${to} AND d.unassigned_seconds > 0 AND ${mine(user, 'd.user_id')}
     GROUP BY d.user_id, u.name`);
}

async function clientGroups(user: User, from: string, to: string) {
  const items = await db.query<{ bucket: Bucket; client_id: number | null; client_name: string | null; user_id: number; user_name: string; seconds: number }>(sql`
    SELECT i.bucket, i.client_id, c.name AS client_name, i.user_id, u.name AS user_name, SUM(i.seconds) AS seconds
      FROM day_items i
      JOIN users u ON u.id = i.user_id
      LEFT JOIN clients c ON c.id = i.client_id
     WHERE i.date >= ${from} AND i.date < ${to} AND ${mine(user, 'i.user_id')}
     GROUP BY i.bucket, i.client_id, c.name, i.user_id, u.name`);
  const unassigned = await unassignedByUser(user, from, to);
  const rows = [...items, ...unassigned.map((u) => ({ ...u, bucket: 'unassigned' as const, client_id: null, client_name: null }))];

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
  list.sort((a, b) => bucketOrder(a) - bucketOrder(b) || b.seconds - a.seconds);
  return list;
}

async function clientDetail(user: User, from: string, to: string, clientParam?: string, bucketParam?: string) {
  let clientId: number | null = null;
  let name: string;
  if (bucketParam === 'internal' || bucketParam === 'unassigned') {
    name = bucketParam === 'internal' ? 'Interno' : 'Sin cliente';
  } else {
    clientId = parseId(clientParam, 'el cliente');
    const client = await db.one<{ name: string }>(sql`SELECT name FROM clients WHERE id = ${clientId}`);
    if (!client) throw new HttpError(404, 'Ese cliente no existe.');
    name = client.name;
  }
  // Sin cliente no tiene detalle de actividades: solo el total de cada día.
  if (bucketParam === 'unassigned') {
    const people = await unassignedByUser(user, from, to);
    const byDay = await db.query(sql`
      SELECT d.date, SUM(d.unassigned_seconds) AS seconds
        FROM days d
       WHERE d.date >= ${from} AND d.date < ${to} AND d.unassigned_seconds > 0 AND ${mine(user, 'd.user_id')}
       GROUP BY d.date ORDER BY d.date`);
    const byUser = people
      .map((p) => ({ userId: p.user_id, name: p.user_name, seconds: Number(p.seconds) }))
      .sort((a, b) => b.seconds - a.seconds);
    return { clientId, name, activities: [], byUser, byDay, notes: [] };
  }
  const match = clientId === null ? sql`i.bucket = ${bucketParam!}` : sql`i.client_id = ${clientId}`;
  const where = sql`${match} AND i.date >= ${from} AND i.date < ${to} AND ${mine(user, 'i.user_id')}`;

  const [activities, byUser, byDay] = await Promise.all([
    db.query(sql`
      SELECT i.kind, i.activity_key AS \`key\`, SUM(i.seconds) AS seconds
        FROM day_items i WHERE ${where}
       GROUP BY i.kind, i.activity_key ORDER BY seconds DESC`),
    db.query(sql`
      SELECT u.id AS userId, u.name, SUM(i.seconds) AS seconds
        FROM day_items i JOIN users u ON u.id = i.user_id WHERE ${where}
       GROUP BY u.id, u.name ORDER BY seconds DESC`),
    db.query(sql`
      SELECT i.date, SUM(i.seconds) AS seconds
        FROM day_items i WHERE ${where}
       GROUP BY i.date ORDER BY i.date`),
  ]);
  const notes = clientId === null ? [] : await db.query(sql`
    SELECT n.date, u.name AS userName, n.note
      FROM day_notes n JOIN users u ON u.id = n.user_id
     WHERE n.client_id = ${clientId} AND n.date >= ${from} AND n.date < ${to} AND ${mine(user, 'n.user_id')}
     ORDER BY n.date DESC, u.name`);
  return { clientId, name, activities, byUser, byDay, notes };
}

// --- Por persona (rango) ---------------------------------------------------------

/** Estadísticas: por persona entre dos fechas (incluidas). Un usuario solo se ve a sí mismo. */
reportRoutes.get('/range/users', async (c) => {
  const user = c.get('user');
  const { from, to, toExclusive } = parseRange(c.req.query('from'), c.req.query('to'));
  const rows = await db.query<{ id: number; name: string; client: number; internal: number; unassigned: number; days: number }>(sql`
    SELECT u.id, u.name,
           COALESCE(it.client, 0) AS client, COALESCE(it.internal, 0) AS internal,
           COALESCE(d.unassigned, 0) AS unassigned, COALESCE(d.days, 0) AS days
      FROM users u
      LEFT JOIN (
        SELECT user_id,
               SUM(CASE WHEN bucket = 'client' THEN seconds ELSE 0 END) AS client,
               SUM(CASE WHEN bucket = 'internal' THEN seconds ELSE 0 END) AS internal
          FROM day_items WHERE date >= ${from} AND date < ${toExclusive}
         GROUP BY user_id) it ON it.user_id = u.id
      LEFT JOIN (
        SELECT user_id, SUM(unassigned_seconds) AS unassigned, COUNT(*) AS days
          FROM days WHERE date >= ${from} AND date < ${toExclusive}
         GROUP BY user_id) d ON d.user_id = u.id
     WHERE ${mine(user, 'u.id')}
     ORDER BY u.name`);
  // total: tiempo de uso (todo lo enviado); used: la parte asignada a clientes o a interno.
  const users = rows.map((r) => {
    const used = Number(r.client) + Number(r.internal);
    return {
      id: r.id, name: r.name, total: used + Number(r.unassigned), used,
      client: Number(r.client), internal: Number(r.internal), unassigned: Number(r.unassigned),
      days: Number(r.days),
    };
  });
  return c.json({ from, to, users });
});

/** Estadísticas de una persona entre dos fechas: por cliente, actividades y días. */
reportRoutes.get('/range/users/:id', async (c) => {
  const userId = parseId(c.req.param('id'), 'la persona');
  checkPerson(c.get('user'), userId);
  const { from, to, toExclusive } = parseRange(c.req.query('from'), c.req.query('to'));
  const person = await db.one<{ id: number; name: string }>(sql`SELECT id, name FROM users WHERE id = ${userId}`);
  if (!person) throw new HttpError(404, 'Esa persona no existe.');
  const where = sql`i.user_id = ${userId} AND i.date >= ${from} AND i.date < ${toExclusive}`;

  const [groups, activities, itemDays, unassignedDays] = await Promise.all([
    db.query<{ bucket: Bucket; client_id: number | null; name: string | null; seconds: number }>(sql`
      SELECT i.bucket, i.client_id, c.name, SUM(i.seconds) AS seconds
        FROM day_items i LEFT JOIN clients c ON c.id = i.client_id WHERE ${where}
       GROUP BY i.bucket, i.client_id, c.name`),
    db.query(sql`
      SELECT i.kind, i.activity_key AS \`key\`, SUM(i.seconds) AS seconds
        FROM day_items i WHERE ${where}
       GROUP BY i.kind, i.activity_key ORDER BY seconds DESC LIMIT ${TOP_ACTIVITIES}`),
    db.query<{ date: string; seconds: number }>(sql`
      SELECT i.date, SUM(i.seconds) AS seconds
        FROM day_items i WHERE ${where}
       GROUP BY i.date`),
    db.query<{ date: string; seconds: number }>(sql`
      SELECT date, unassigned_seconds AS seconds FROM days
       WHERE user_id = ${userId} AND date >= ${from} AND date < ${toExclusive} AND unassigned_seconds > 0`),
  ]);
  const byClient = groups
    .map((g) => ({ bucket: g.bucket, clientId: g.client_id, name: g.name ?? '', seconds: Number(g.seconds) }));
  const unassigned = unassignedDays.reduce((s, d) => s + Number(d.seconds), 0);
  if (unassigned > 0) byClient.push({ bucket: 'unassigned', clientId: null, name: '', seconds: unassigned });
  byClient.sort((a, b) => bucketOrder(a) - bucketOrder(b) || b.seconds - a.seconds);
  // Por día, el tiempo de uso: lo asignado más lo que quedó sin cliente.
  const perDay = new Map<string, number>();
  for (const d of [...itemDays, ...unassignedDays]) perDay.set(d.date, (perDay.get(d.date) ?? 0) + Number(d.seconds));
  const byDay = [...perDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, seconds]) => ({ date, seconds }));
  return c.json({ from, to, user: person, byClient, activities, byDay });
});

// --- Clientes ------------------------------------------------------------------

/** Tiempo total de cada cliente desde siempre, para la lista de Clientes (el propio, si es usuario). */
reportRoutes.get('/clients', async (c) => {
  const rows = await db.query<{ id: number; seconds: number; last_date: string | null }>(sql`
    SELECT i.client_id AS id, SUM(i.seconds) AS seconds, MAX(i.date) AS last_date
      FROM day_items i WHERE i.client_id IS NOT NULL AND ${mine(c.get('user'), 'i.user_id')}
     GROUP BY i.client_id`);
  return c.json(rows.map((r) => ({ id: r.id, seconds: Number(r.seconds), lastDate: r.last_date })));
});

/** Clientes con seguimiento de horas que las han agotado o se han pasado. */
reportRoutes.get('/alerts', async (c) => {
  const budgets = await loadBudgets();
  const ids = [...budgets].filter(([, b]) => b.status === 'exhausted' || b.status === 'over').map(([id]) => id);
  if (ids.length === 0) return c.json([]);
  const names = await db.query<{ id: number; name: string }>(sql`SELECT id, name FROM clients WHERE id IN ${ids}`);
  return c.json(
    names
      .map((n) => ({ id: n.id, name: n.name, ...budgetSummary(budgets.get(n.id))! }))
      .sort((a, b) => b.excess - a.excess || a.name.localeCompare(b.name, 'es')),
  );
});

/**
 * Todo lo de un cliente: total, por mes, por persona, actividades y comentarios recientes.
 * Un usuario ve solo su propio tiempo con el cliente; las horas contratadas, de todos.
 */
reportRoutes.get('/clients/:id', async (c) => {
  const user = c.get('user');
  const clientId = parseId(c.req.param('id'), 'el cliente');
  const client = await db.one<{ id: number; name: string; created_at: string }>(sql`
    SELECT id, name, created_at FROM clients WHERE id = ${clientId}`);
  if (!client) throw new HttpError(404, 'Ese cliente no existe.');
  const where = sql`i.client_id = ${clientId} AND ${mine(user, 'i.user_id')}`;

  const [byMonth, byUser, activities, notes] = await Promise.all([
    db.query<{ month: string; seconds: number }>(sql`
      SELECT DATE_FORMAT(i.date, '%Y-%m') AS month, SUM(i.seconds) AS seconds
        FROM day_items i WHERE ${where}
       GROUP BY month ORDER BY month DESC`),
    db.query(sql`
      SELECT u.id AS userId, u.name, SUM(i.seconds) AS seconds, MAX(i.date) AS lastDate
        FROM day_items i JOIN users u ON u.id = i.user_id WHERE ${where}
       GROUP BY u.id, u.name ORDER BY seconds DESC`),
    db.query(sql`
      SELECT i.kind, i.activity_key AS \`key\`, SUM(i.seconds) AS seconds
        FROM day_items i WHERE ${where}
       GROUP BY i.kind, i.activity_key ORDER BY seconds DESC LIMIT ${TOP_ACTIVITIES}`),
    db.query(sql`
      SELECT n.date, u.name AS userName, n.note
        FROM day_notes n JOIN users u ON u.id = n.user_id
       WHERE n.client_id = ${clientId} AND ${mine(user, 'n.user_id')}
       ORDER BY n.date DESC, u.name LIMIT ${RECENT_NOTES}`),
  ]);
  return c.json({
    id: client.id,
    name: client.name,
    createdAt: iso(client.created_at),
    totalSeconds: byMonth.reduce((s, m) => s + Number(m.seconds), 0),
    byMonth,
    byUser,
    activities,
    notes,
    hours: (await loadBudgets([clientId])).get(clientId),
  });
});

// --- Utilidades ------------------------------------------------------------------

interface ItemRow {
  id: number;
  source: 'agent' | 'web';
  bucket: Bucket;
  client_id: number | null;
  client_name: string | null;
  kind: string;
  key: string;
  seconds: number;
}

const bucketOrder = (g: { bucket: Bucket }) => ({ client: 0, internal: 1, unassigned: 2 })[g.bucket];

function groupItems(items: ItemRow[]) {
  const groups = new Map<string, { bucket: Bucket; clientId: number | null; name: string; seconds: number; items: { id: number | null; kind: string; key: string; seconds: number }[] }>();
  for (const i of items) {
    const id = i.bucket === 'client' ? `c${i.client_id}` : i.bucket;
    const group = groups.get(id) ?? { bucket: i.bucket, clientId: i.client_id, name: i.client_name ?? '', seconds: 0, items: [] };
    group.seconds += i.seconds;
    // Solo lo apuntado en la web lleva id: es lo que se puede borrar desde la web.
    group.items.push({ id: i.source === 'web' ? i.id : null, kind: i.kind, key: i.key, seconds: i.seconds });
    groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) => bucketOrder(a) - bucketOrder(b) || b.seconds - a.seconds);
}

function parseMonth(value: string | undefined): { month: string; from: string; to: string } {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new HttpError(400, 'Mes no válido (formato AAAA-MM).');
  const [y, m] = value.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { month: value, from: `${value}-01`, to: `${next}-01` };
}

/** Rango de fechas incluidas (from y to), con el día siguiente a to para consultar con "<". */
function parseRange(fromValue: string | undefined, toValue: string | undefined) {
  const from = parseDate(fromValue, 'La fecha de inicio');
  const to = parseDate(toValue, 'La fecha de fin');
  if (to < from) throw new HttpError(400, 'La fecha de fin es anterior a la de inicio.');
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (days > MAX_RANGE_DAYS) throw new HttpError(400, 'El rango es demasiado largo (máximo 3 años).');
  return { from, to, toExclusive: addDays(to, 1) };
}

/** Suma días a una fecha AAAA-MM-DD (en UTC, para no depender de la zona horaria del servidor). */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
