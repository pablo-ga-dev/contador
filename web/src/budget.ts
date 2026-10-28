import { sql } from './db/index.ts';

/**
 * Horas contratadas de un cliente.
 *
 * Cada mes (desde que empieza el seguimiento) el tiempo se descuenta primero de la
 * cuota mensual, que no se acumula de un mes a otro. Lo que pase de la cuota sale de
 * los bonos, del más antiguo al más nuevo; los bonos no caducan y también cubren el
 * exceso de meses anteriores. Lo que pase de los bonos es exceso.
 */
export interface Budget {
  tracking: boolean;
  trackingSince: string | null;
  monthlySeconds: number | null;
  /** Mes actual (AAAA-MM). */
  month: string;
  /** Tiempo de este mes y lo que queda de su cuota. */
  usedThisMonth: number;
  monthlyRemaining: number;
  packs: { id: number; seconds: number; purchasedOn: string; note: string | null; remainingSeconds: number }[];
  packsRemaining: number;
  /** Lo que queda en total: cuota de este mes más bonos. */
  available: number;
  /** Tiempo por encima de cuotas y bonos. */
  excess: number;
  /**
   * none: sin seguimiento o sin horas contratadas (no se avisa de nada);
   * ok: le quedan horas; exhausted: le quedan 0; over: se ha pasado.
   */
  status: 'none' | 'ok' | 'exhausted' | 'over';
}

interface ClientHours {
  id: number;
  track_hours: boolean;
  monthly_seconds: number | null;
  tracking_since: string | null;
}

interface Pack {
  id: number;
  client_id: number;
  seconds: number;
  purchased_on: string;
  note: string | null;
}

/** Cálculo puro (sin base de datos), para poder probarlo aparte. */
export function computeBudget(
  client: { tracking: boolean; trackingSince: string | null; monthlySeconds: number | null },
  usageByMonth: Map<string, number>,
  packs: { id: number; seconds: number; purchasedOn: string; note: string | null }[],
  month: string,
): Budget {
  const monthly = client.monthlySeconds ?? 0;
  let overflow = 0;
  for (const [m, used] of usageByMonth) {
    if (m > month) continue;
    overflow += Math.max(0, used - monthly);
  }
  const usedThisMonth = usageByMonth.get(month) ?? 0;
  const monthlyRemaining = Math.max(0, monthly - usedThisMonth);

  // Los bonos, del más antiguo al más nuevo, cubren el tiempo que pasa de la cuota.
  const sorted = [...packs].sort((a, b) => a.purchasedOn.localeCompare(b.purchasedOn) || a.id - b.id);
  let toCover = overflow;
  const withRemaining = sorted.map((p) => {
    const used = Math.min(p.seconds, toCover);
    toCover -= used;
    return { ...p, remainingSeconds: p.seconds - used };
  });
  const packsRemaining = withRemaining.reduce((s, p) => s + p.remainingSeconds, 0);
  const excess = toCover;
  const available = monthlyRemaining + packsRemaining;
  const hasHours = monthly > 0 || packs.length > 0;

  let status: Budget['status'] = 'none';
  if (client.tracking && hasHours) status = excess > 0 ? 'over' : available === 0 ? 'exhausted' : 'ok';

  return {
    tracking: client.tracking,
    trackingSince: client.trackingSince,
    monthlySeconds: client.monthlySeconds,
    month,
    usedThisMonth,
    monthlyRemaining,
    packs: withRemaining,
    packsRemaining,
    available,
    excess,
    status,
  };
}

/** Horas de los clientes con seguimiento activado (o de los indicados). */
export async function loadBudgets(ids?: number[]): Promise<Map<number, Budget>> {
  const [{ month }] = await sql<{ month: string }[]>`SELECT to_char(current_date, 'YYYY-MM') AS month`;
  const clients = await sql<ClientHours[]>`
    SELECT id, track_hours, monthly_seconds, tracking_since::text AS tracking_since
      FROM clients
     WHERE ${ids ? sql`id IN ${sql(ids)}` : sql`track_hours`}`;
  if (clients.length === 0) return new Map();
  const clientIds = clients.map((c) => c.id);

  const [usage, packs] = await Promise.all([
    sql<{ client_id: number; month: string; seconds: number }[]>`
      SELECT i.client_id, to_char(i.date, 'YYYY-MM') AS month, SUM(i.seconds)::int AS seconds
        FROM day_items i JOIN clients c ON c.id = i.client_id
       WHERE i.client_id IN ${sql(clientIds)}
         AND i.date >= COALESCE(c.tracking_since, date_trunc('month', current_date)::date)
       GROUP BY 1, 2`,
    sql<Pack[]>`
      SELECT id, client_id, seconds, purchased_on::text AS purchased_on, note
        FROM client_packs WHERE client_id IN ${sql(clientIds)}`,
  ]);

  const result = new Map<number, Budget>();
  for (const c of clients) {
    const byMonth = new Map(usage.filter((u) => u.client_id === c.id).map((u) => [u.month, u.seconds]));
    const own = packs
      .filter((p) => p.client_id === c.id)
      .map((p) => ({ id: p.id, seconds: p.seconds, purchasedOn: p.purchased_on, note: p.note }));
    result.set(
      c.id,
      computeBudget(
        { tracking: c.track_hours, trackingSince: c.tracking_since, monthlySeconds: c.monthly_seconds },
        byMonth,
        own,
        month,
      ),
    );
  }
  return result;
}

/** Lo justo para avisar (lista de clientes, agente). */
export function budgetSummary(b: Budget | undefined) {
  if (!b || b.status === 'none') return null;
  return { status: b.status, available: b.available, excess: b.excess };
}
