// Utilidades compartidas por las páginas del panel.

/** Nombres de proceso → nombre reconocible. */
const APP_NAMES = {
  'Code': 'VS Code', 'chrome': 'Chrome', 'msedge': 'Edge', 'firefox': 'Firefox', 'brave': 'Brave',
  'WhatsApp.Root': 'WhatsApp', 'WhatsApp': 'WhatsApp', 'explorer': 'Explorador de archivos',
  'WINWORD': 'Word', 'EXCEL': 'Excel', 'POWERPNT': 'PowerPoint', 'OUTLOOK': 'Outlook',
  'olk': 'Outlook', 'ms-teams': 'Teams', 'Teams': 'Teams', 'Figma': 'Figma', 'Slack': 'Slack',
  'Claude': 'Claude', 'WindowsTerminal': 'Terminal', 'powershell': 'PowerShell', 'pwsh': 'PowerShell',
};
export const appName = (app) => APP_NAMES[app] ?? app;

export function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m > 0 || seconds < 1) return `${m} min`;
  return `${Math.floor(seconds)} s`;
}

const pad = (n) => String(n).padStart(2, '0');
export const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayISO = () => toISODate(new Date());
export function shiftDay(iso, delta) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return toISODate(d);
}
/** "Martes, 27 de octubre". */
export function longDate(iso) {
  const text = new Date(`${iso}T00:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  return text.charAt(0).toUpperCase() + text.slice(1);
}
/** "lun 26 oct". */
export function shortDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Llama a la API local del agente. Todo lo que no es GET va como JSON (protección CSRF). */
export async function api(method, path, body) {
  const send = method !== 'GET';
  const res = await fetch(path, {
    method,
    cache: 'no-store',
    headers: send ? { 'Content-Type': 'application/json' } : {},
    body: send ? JSON.stringify(body ?? {}) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Error ${res.status}`);
  return data;
}
