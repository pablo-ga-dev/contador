/** Inicio y fin (hora local) del día AAAA-MM-DD, o de hoy si no se indica. null si la fecha no es válida. */
export function dayRange(date?: string): { from: Date; to: Date } | null {
  if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const from = date ? new Date(`${date}T00:00:00`) : new Date();
  if (Number.isNaN(from.getTime())) return null;
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from, to };
}

/** AAAA-MM-DD en hora local. */
export function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
