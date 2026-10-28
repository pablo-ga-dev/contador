// Utilidades compartidas por las páginas de la web.

/** Llama a la API. Todo lo que no es GET va como JSON (protección CSRF). Sin sesión, lleva a /login. */
export async function api(method, path, body) {
  const send = method !== 'GET';
  const res = await fetch(path, {
    method,
    headers: send ? { 'Content-Type': 'application/json' } : {},
    body: send ? JSON.stringify(body ?? {}) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.status === 401 && !path.startsWith('/api/auth/login')) {
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  }
  if (!res.ok) {
    const err = new Error(data?.error ?? `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Menú: ruta, texto y si es solo para administradores. */
const PAGES = [
  ['/', 'Tiempos', false],
  ['/estadisticas', 'Estadísticas', false],
  ['/clientes', 'Clientes', false],
  ['/equipo', 'Equipo', true],
  ['/ajustes', 'Ajustes', false],
];

export const isAdmin = (me) => me.role === 'admin';

/**
 * Comprueba la sesión y pinta la cabecera con el menú. Devuelve el usuario.
 * Con adminOnly, a quien no es administrador lo lleva a la página principal.
 */
export async function startPage(current, { adminOnly = false } = {}) {
  const me = await api('GET', '/api/auth/me');
  if (adminOnly && !isAdmin(me)) {
    location.href = '/';
    return new Promise(() => {}); // La página se va: que no siga pintando.
  }
  const header = document.createElement('header');
  const title = brand();
  const nav = document.createElement('nav');
  for (const [href, label, onlyAdmin] of PAGES) {
    if (onlyAdmin && !isAdmin(me)) continue;
    const a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    if (href === current) a.setAttribute('aria-current', 'page');
    nav.append(a);
  }
  const who = document.createElement('span');
  who.className = 'who';
  who.id = 'who';
  who.textContent = isAdmin(me) ? `${me.name} · admin` : me.name;
  const logout = document.createElement('button');
  logout.textContent = 'Salir';
  logout.addEventListener('click', async () => {
    await api('POST', '/api/auth/logout');
    location.href = '/login';
  });
  header.append(title, nav, who, logout);
  document.body.prepend(header);
  return me;
}

/** Logo y nombre DIALOGUE, enlazando a la página principal. */
export function brand() {
  const a = document.createElement('a');
  a.className = 'brand';
  a.href = '/';
  const img = document.createElement('img');
  img.src = '/logo.svg';
  img.alt = '';
  const name = document.createElement('span');
  name.textContent = 'DIALOGUE';
  a.append(img, name);
  return a;
}

export function say(id, text, kind = 'error') {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = `msg ${kind}`;
}

export function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m > 0 || seconds < 1) return `${m} min`;
  return `${Math.floor(seconds)} s`;
}

/** Nombres de proceso → nombre reconocible. */
const APP_NAMES = {
  'Code': 'VS Code', 'chrome': 'Chrome', 'msedge': 'Edge', 'firefox': 'Firefox', 'brave': 'Brave',
  'WhatsApp.Root': 'WhatsApp', 'WhatsApp': 'WhatsApp', 'explorer': 'Explorador de archivos',
  'WINWORD': 'Word', 'EXCEL': 'Excel', 'POWERPNT': 'PowerPoint', 'OUTLOOK': 'Outlook',
  'olk': 'Outlook', 'ms-teams': 'Teams', 'Teams': 'Teams', 'Figma': 'Figma', 'Slack': 'Slack',
};
export const KIND_LABELS = { domain: 'Web', chat: 'Chat', app: 'App', manual: 'Manual' };

/** Parte del tiempo de uso asignada a clientes o a interno, como "85 %"; "—" sin tiempo. */
export const usedPercent = (used, total) => (total > 0 ? `${Math.round((used / total) * 100)} %` : '—');

/** Acepta "1:30", "90", "90 min", "1h", "1h30", "1,5h". Devuelve minutos o null. */
export function parseMinutes(text) {
  const t = text.trim().toLowerCase().replace(',', '.');
  let m;
  if ((m = /^(\d+):(\d{1,2})$/.exec(t))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = /^(\d+(?:\.\d+)?)\s*h(?:\s*(\d+)\s*(?:m|min)?)?$/.exec(t))) return Math.round(parseFloat(m[1]) * 60) + Number(m[2] ?? 0);
  if ((m = /^(\d+)\s*(?:m|min)?$/.exec(t))) return Number(m[1]);
  return null;
}
export const activityLabel = (a) => (a.kind === 'app' ? APP_NAMES[a.key] ?? a.key : a.key);
export const groupLabel = (g) => (g.bucket === 'client' ? g.name : g.bucket === 'internal' ? 'Interno' : 'Sin cliente');
/** "Sin cliente" llega a la web solo como total: el detalle se queda en el PC de cada uno. */
export const UNASSIGNED_HINT = 'Solo el total: qué webs o apps fueron se queda en el PC de cada persona.';

const pad = (n) => String(n).padStart(2, '0');
export const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayISO = () => toISODate(new Date());
export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}
/** Lunes de la semana de una fecha. */
export function mondayOf(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return addDays(iso, -((d.getDay() + 6) % 7));
}
export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
export const fmtDate = (iso, opts) => new Date(`${iso}T00:00:00`).toLocaleDateString('es-ES', opts);
export function monthLabel(month) {
  const text = new Date(`${month}-01T00:00:00`).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  return text.charAt(0).toUpperCase() + text.slice(1);
}
export const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Texto corto del estado de horas de un cliente con seguimiento. */
export function hoursLabel(h) {
  if (!h) return '';
  if (h.status === 'over') return `Se ha pasado ${formatDuration(h.excess)}`;
  if (h.status === 'exhausted') return 'Horas agotadas';
  return `Quedan ${formatDuration(h.available)}`;
}

/**
 * Aviso de clientes que han agotado sus horas o se han pasado (solo los que tienen
 * seguimiento y horas contratadas). Se pinta al principio de `main`.
 */
export async function showHoursAlerts() {
  const alerts = await api('GET', '/api/reports/alerts').catch(() => []);
  document.getElementById('hours-alerts')?.remove();
  if (alerts.length === 0) return;
  const box = el('div', 'alert');
  box.id = 'hours-alerts';
  box.setAttribute('role', 'status');
  box.append(el('strong', '', alerts.length === 1 ? 'Un cliente sin horas: ' : `${alerts.length} clientes sin horas: `));
  alerts.forEach((a, i) => {
    const link = el('a', '', a.name);
    link.href = `/clientes?id=${a.id}`;
    box.append(i ? ' · ' : '', link, ` (${hoursLabel(a).toLowerCase()})`);
  });
  document.querySelector('main').prepend(box);
}

/** Crea un elemento con clase y texto. */
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
