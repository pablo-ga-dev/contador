import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config } from '../config.ts';
import { dayRange, localDate } from '../core/day-range.ts';
import { pendingDays } from '../core/pending-days.ts';
import { MAX_REMINDER_HOURS, MIN_REMINDER_HOURS, reminderSettings } from '../core/reminders.ts';
import { MAX_RETENTION_DAYS, MIN_RETENTION_DAYS, retentionDays, type Retention } from '../core/retention.ts';
import { autostartStatus, setAutostart } from '../autostart.ts';
import type { Assignment, Bucket, DayNote } from '../core/types.ts';
import type { BrowserReceiver } from '../sources/browser/browser-receiver.ts';
import type { ReviewStore } from '../storage/review-store.ts';
import type { SegmentStore } from '../storage/segment-store.ts';
import type { DaySync } from '../sync/day-sync.ts';
import { WebError, type WebClient } from '../sync/web-client.ts';

const UI_DIR = new URL('../ui/', import.meta.url);
/** Páginas y recursos del panel: ruta → archivo y tipo. */
const STATIC_FILES: Record<string, [string, string]> = {
  '/': ['panel.html', 'text/html; charset=utf-8'],
  '/revisar': ['review.html', 'text/html; charset=utf-8'],
  '/ajustes': ['settings.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/common.js': ['common.js', 'text/javascript; charset=utf-8'],
  '/theme.js': ['theme.js', 'text/javascript; charset=utf-8'],
  '/logo.svg': ['logo.svg', 'image/svg+xml'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
  // Las instala "npm run fuentes"; si faltan, el panel usa las del sistema.
  '/fonts/Outfit-SemiBold.woff2': ['fonts/Outfit-SemiBold.woff2', 'font/woff2'],
  '/fonts/Switzer-Light.woff2': ['fonts/Switzer-Light.woff2', 'font/woff2'],
};
const MAX_BODY_BYTES = 1024 * 1024;
/** Un tramo cuyo final es más reciente que esto se considera "lo que estás haciendo ahora". */
const CURRENT_MAX_AGE_MS = config.pollIntervalSeconds * 3 * 1000;
/** Límites del tiempo de inactividad configurable en Ajustes. */
const MIN_IDLE_MINUTES = 1;
const MAX_IDLE_MINUTES = 60;
/** Igual que en la web: un comentario no puede pasar de aquí. */
const MAX_NOTE_LENGTH = 2000;
const KINDS: Assignment['kind'][] = ['domain', 'chat', 'app', 'manual'];
const BUCKETS: Bucket[] = ['client', 'internal', 'unassigned', 'personal'];
/** Igual que en la web: longitud máxima de una clave (y de la descripción del tiempo manual). */
const MAX_KEY_LENGTH = 255;
const DAY_SECONDS = 24 * 3600;

class RequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface LocalServerDeps {
  port: number;
  /** Ruta de la base local, para mostrarla en Ajustes. */
  dbFile: string;
  segments: SegmentStore;
  reviews: ReviewStore;
  browser: BrowserReceiver;
  web: WebClient;
  sync: DaySync;
  retention: Retention;
  /** Para el agente (cierra bien el tramo actual y sale). */
  onShutdown: () => void;
}

/**
 * Servidor del agente, solo en 127.0.0.1:
 *   POST /browser               la extensión informa del dominio de la pestaña activa
 *   GET  /, /revisar, /ajustes  páginas del panel
 *   GET  /api/summary           tiempo del día (?date=AAAA-MM-DD, por defecto hoy)
 *   GET  /api/review            actividades del día, su revisión y los días pendientes
 *   POST /api/review/:fecha     confirma un día y lo envía a la web
 *   GET  /api/catalog           clientes y reglas de la web (o la última copia si no hay conexión)
 *   POST /api/clients           crea un cliente en la web
 *   GET|PUT /api/settings       ajustes: cuenta, envíos, seguimiento y datos locales; PUT conecta con la web
 *   DELETE /api/settings/connection  desconecta el agente de la web
 *   PUT  /api/settings/tracking minutos de inactividad tras los que se deja de contar
 *   POST /api/sync              envía ahora los días pendientes
 *   PUT  /api/settings/reminders  recordatorio diario y revisión de pendientes al encender
 *   GET|PUT /api/settings/autostart  arranque automático (Windows o macOS)
 *   POST /api/shutdown          para el agente (npm run parar)
 */
export class LocalServer {
  private server: http.Server | null = null;
  private deps: LocalServerDeps;

  constructor(deps: LocalServerDeps) {
    this.deps = deps;
  }

  /** Empieza a escuchar. Falla si el puerto está ocupado (normalmente, porque ya hay otro agente). */
  start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      this.route(req, res).catch((err: unknown) => {
        if (err instanceof RequestError) return sendJson(res, err.status, { error: err.message });
        console.error(`[servidor] ${err instanceof Error ? err.message : String(err)}`);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    const server = this.server;
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.deps.port, '127.0.0.1', () => {
        server.off('error', reject);
        server.on('error', (err) => console.error(`[servidor] ${err.message}`));
        resolve();
      });
    });
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }

  private async route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Solo atendemos peticiones dirigidas a nosotros: así una web maliciosa no puede
    // leer los datos haciéndose pasar por 127.0.0.1 ("DNS rebinding").
    const host = req.headers.host ?? '';
    const { port } = this.deps;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      res.writeHead(403).end();
      return;
    }
    const url = new URL(req.url ?? '/', `http://${host}`);
    const method = req.method ?? 'GET';

    if (method === 'POST' && url.pathname === '/browser') return this.browserReport(req, res);

    // Protección CSRF: una web ajena puede enviarnos formularios, pero no JSON.
    if (method !== 'GET' && !req.headers['content-type']?.startsWith('application/json')) {
      throw new RequestError(415, 'Las peticiones deben enviarse como JSON.');
    }

    if (method === 'GET' && STATIC_FILES[url.pathname]) {
      const [file, type] = STATIC_FILES[url.pathname]!;
      let content: Buffer;
      try {
        content = await readFile(fileURLToPath(new URL(file, UI_DIR)));
      } catch {
        res.writeHead(404).end(); // p. ej. fuentes sin instalar
        return;
      }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(content);
      return;
    }
    if (method === 'GET' && url.pathname === '/api/summary') {
      return sendJson(res, 200, this.summary(url.searchParams.get('date') ?? undefined));
    }
    if (method === 'GET' && url.pathname === '/api/review') {
      return sendJson(res, 200, this.review(url.searchParams.get('date') ?? undefined));
    }
    const confirm = /^\/api\/review\/(\d{4}-\d{2}-\d{2})$/.exec(url.pathname);
    if (method === 'POST' && confirm) {
      return sendJson(res, 200, await this.confirm(confirm[1]!, await readJson(req)));
    }
    if (method === 'GET' && url.pathname === '/api/catalog') return sendJson(res, 200, await this.catalog());
    if (method === 'POST' && url.pathname === '/api/clients') {
      return sendJson(res, 201, await this.createClient(await readJson(req)));
    }
    if (method === 'GET' && url.pathname === '/api/settings') return sendJson(res, 200, this.settings());
    if (method === 'PUT' && url.pathname === '/api/settings') {
      return sendJson(res, 200, await this.saveSettings(await readJson(req)));
    }
    if (method === 'DELETE' && url.pathname === '/api/settings/connection') {
      return sendJson(res, 200, this.disconnect());
    }
    if (method === 'PUT' && url.pathname === '/api/settings/tracking') {
      return sendJson(res, 200, this.saveTracking(await readJson(req)));
    }
    if (method === 'PUT' && url.pathname === '/api/settings/retention') {
      return sendJson(res, 200, this.saveRetention(await readJson(req)));
    }
    if (method === 'POST' && url.pathname === '/api/sync') {
      await this.deps.sync.sendPending();
      return sendJson(res, 200, this.settings());
    }
    if (method === 'PUT' && url.pathname === '/api/settings/reminders') {
      return sendJson(res, 200, this.saveReminders(await readJson(req)));
    }
    if (method === 'GET' && url.pathname === '/api/settings/autostart') {
      return sendJson(res, 200, { ...(await autostartStatus()), platform: process.platform });
    }
    if (method === 'PUT' && url.pathname === '/api/settings/autostart') {
      const { enabled } = await readJson(req);
      if (typeof enabled !== 'boolean') throw new RequestError(400, 'Falta enabled (true o false).');
      await setAutostart(enabled);
      return sendJson(res, 200, { ...(await autostartStatus()), platform: process.platform });
    }
    if (method === 'POST' && url.pathname === '/api/shutdown') {
      sendJson(res, 202, { stopping: true });
      setImmediate(this.deps.onShutdown);
      return;
    }
    res.writeHead(404).end();
  }

  /**
   * Exige la cabecera X-Contador: una web normal no puede enviarla a otro origen
   * sin una comprobación previa (CORS) que aquí no aceptamos.
   */
  private async browserReport(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.headers['x-contador'] !== '1') {
      res.writeHead(404).end();
      return;
    }
    const { domain } = await readJson(req);
    this.deps.browser.record(typeof domain === 'string' && domain ? domain : null);
    res.writeHead(204).end();
  }

  private summary(date: string | undefined) {
    const { from, to } = parseDay(date);
    const { segments } = this.deps;
    const byApp = segments.totalsBy('app', from, to);
    const latest = segments.latest();
    const current =
      latest && Date.now() - latest.end.getTime() <= CURRENT_MAX_AGE_MS
        ? {
            app: latest.app,
            title: latest.title,
            domain: latest.domain,
            chat: latest.chat,
            since: latest.start.toISOString(),
            seconds: (latest.end.getTime() - latest.start.getTime()) / 1000,
          }
        : null;
    return {
      date: localDate(from),
      today: localDate(from) === localDate(new Date()),
      totalSeconds: byApp.reduce((sum, t) => sum + t.seconds, 0),
      byApp,
      byDomain: segments.totalsBy('domain', from, to),
      byChat: segments.totalsBy('chat', from, to),
      current,
    };
  }

  private review(date: string | undefined) {
    const { from, to } = parseDay(date);
    const day = localDate(from);
    return {
      date: day,
      today: day === localDate(new Date()),
      activities: this.deps.segments.activities(from, to),
      confirmed: this.deps.reviews.get(day),
      pending: pendingDays(this.deps.segments, this.deps.reviews),
    };
  }

  private async confirm(date: string, body: Record<string, unknown>) {
    parseDay(date);
    if (!Array.isArray(body.items)) throw new RequestError(400, 'Faltan las actividades (items).');
    const items = body.items.map(parseAssignment);
    this.deps.reviews.confirm(date, items, parseNotes(body.notes));
    await this.deps.sync.sendPending();
    return { confirmed: this.deps.reviews.get(date) };
  }

  /** Clientes y reglas de la web. Si no hay conexión, la última copia que tengamos. */
  private async catalog() {
    const { web, reviews } = this.deps;
    try {
      const [clients, rules] = await Promise.all([web.clients(), web.rules()]);
      reviews.setSetting('clientsCache', JSON.stringify(clients));
      reviews.setSetting('rulesCache', JSON.stringify(rules));
      return { clients, rules, warning: null };
    } catch (err) {
      if (!(err instanceof WebError)) throw err;
      return {
        clients: JSON.parse(reviews.getSetting('clientsCache') ?? '[]') as unknown[],
        rules: JSON.parse(reviews.getSetting('rulesCache') ?? '[]') as unknown[],
        warning: err.message,
        notConfigured: err.kind === 'not-configured',
      };
    }
  }

  private async createClient(body: Record<string, unknown>) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) throw new RequestError(400, 'Falta el nombre del cliente.');
    try {
      return await this.deps.web.createClient(name);
    } catch (err) {
      if (err instanceof WebError) throw new RequestError(502, err.message);
      throw err;
    }
  }

  /** Todo lo que muestra la página de Ajustes. El código del agente nunca sale de aquí. */
  private settings() {
    const { reviews, dbFile } = this.deps;
    const unsent = reviews.unsent();
    return {
      webUrl: reviews.getSetting('webUrl'),
      hasAgentCode: reviews.getSetting('agentCode') !== null,
      userName: reviews.getSetting('userName'),
      userEmail: reviews.getSetting('userEmail'),
      sync: {
        lastSentAt: reviews.lastSentAt(),
        unsent: unsent.map((d) => d.date),
        lastError: unsent.find((d) => d.lastError)?.lastError ?? null,
      },
      idleMinutes: Number(reviews.getSetting('idleMinutes') ?? config.idleThresholdSeconds / 60),
      retentionDays: retentionDays(reviews),
      reminders: reminderSettings(reviews),
      dataFile: dbFile,
    };
  }

  private saveReminders(body: Record<string, unknown>) {
    const hours = Number(body.hours);
    // Medias horas: 7,5 h son las 7 h 30 min por defecto.
    if (!Number.isFinite(hours) || hours < MIN_REMINDER_HOURS || hours > MAX_REMINDER_HOURS || (hours * 2) % 1 !== 0) {
      throw new RequestError(400, `Las horas deben estar entre ${MIN_REMINDER_HOURS} y ${MAX_REMINDER_HOURS}, en medias horas.`);
    }
    if (typeof body.enabled !== 'boolean' || typeof body.startupReview !== 'boolean') {
      throw new RequestError(400, 'Faltan enabled y startupReview (true o false).');
    }
    const { reviews } = this.deps;
    reviews.setSetting('reminderEnabled', String(body.enabled));
    reviews.setSetting('reminderHours', String(hours));
    reviews.setSetting('startupReview', String(body.startupReview));
    return this.settings();
  }

  /** Olvida el código y la cuenta; la dirección de la web se conserva para volver a conectar. */
  private disconnect() {
    const { reviews } = this.deps;
    for (const key of ['agentCode', 'userName', 'userEmail'] as const) reviews.setSetting(key, null);
    return this.settings();
  }

  private saveTracking(body: Record<string, unknown>) {
    const minutes = Number(body.idleMinutes);
    if (!Number.isInteger(minutes) || minutes < MIN_IDLE_MINUTES || minutes > MAX_IDLE_MINUTES) {
      throw new RequestError(400, `Los minutos deben ser un número entero entre ${MIN_IDLE_MINUTES} y ${MAX_IDLE_MINUTES}.`);
    }
    this.deps.reviews.setSetting('idleMinutes', String(minutes));
    return this.settings();
  }

  /** Cambia el tiempo de guardado y borra en el momento lo que ya haya quedado fuera. */
  private saveRetention(body: Record<string, unknown>) {
    const days = Number(body.retentionDays);
    if (!Number.isInteger(days) || days < MIN_RETENTION_DAYS || days > MAX_RETENTION_DAYS) {
      throw new RequestError(400, `Los días deben ser un número entero entre ${MIN_RETENTION_DAYS} y ${MAX_RETENTION_DAYS}.`);
    }
    this.deps.reviews.setSetting('retentionDays', String(days));
    return { ...this.settings(), deletedDays: this.deps.retention.run() };
  }

  /** Comprueba la conexión con los datos nuevos antes de guardarlos. */
  private async saveSettings(body: Record<string, unknown>) {
    const { reviews, web, sync } = this.deps;
    const webUrl = parseWebUrl(body.webUrl);
    const typedCode = typeof body.agentCode === 'string' ? body.agentCode.trim() : '';
    const agentCode = typedCode || reviews.getSetting('agentCode');
    if (!agentCode) throw new RequestError(400, 'Pega el código del agente que se genera en la web.');
    try {
      const me = await web.me({ webUrl, agentCode });
      reviews.setSetting('webUrl', webUrl);
      reviews.setSetting('agentCode', agentCode);
      reviews.setSetting('userName', me.name);
      reviews.setSetting('userEmail', me.email);
    } catch (err) {
      if (err instanceof WebError) throw new RequestError(400, err.message);
      throw err;
    }
    void sync.sendPending();
    return this.settings();
  }
}

function parseDay(date: string | undefined): { from: Date; to: Date } {
  const range = dayRange(date);
  if (!range) throw new RequestError(400, 'Fecha no válida (formato AAAA-MM-DD).');
  return range;
}

function parseWebUrl(value: unknown): string {
  try {
    const url = new URL(String(value ?? '').trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error();
    return url.origin;
  } catch {
    throw new RequestError(400, 'La dirección de la web no es válida (p. ej. https://contador.tuempresa.com).');
  }
}

/** Comentarios del día (opcionales). Los vacíos se descartan. */
function parseNotes(raw: unknown): DayNote[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new RequestError(400, 'notes debe ser una lista.');
  return raw.flatMap((n, index) => {
    const r = (n && typeof n === 'object' ? n : {}) as Record<string, unknown>;
    const clientId = r.clientId ?? null;
    if ((clientId !== null && typeof clientId !== 'number') || typeof r.text !== 'string') {
      throw new RequestError(400, `El comentario ${index + 1} no es válido.`);
    }
    if (r.text.length > MAX_NOTE_LENGTH) {
      throw new RequestError(400, `El comentario ${index + 1} supera los ${MAX_NOTE_LENGTH} caracteres.`);
    }
    const text = r.text.trim();
    return text ? [{ clientId: clientId as number | null, text }] : [];
  });
}

function parseAssignment(raw: unknown, index: number): Assignment {
  const where = `la actividad ${index + 1}`;
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (!KINDS.includes(r.kind as Assignment['kind'])) throw new RequestError(400, `${where}: tipo no válido.`);
  if (!BUCKETS.includes(r.bucket as Bucket)) throw new RequestError(400, `${where}: asignación no válida.`);
  const key = typeof r.key === 'string' ? r.key.trim() : '';
  if (!key) throw new RequestError(400, r.kind === 'manual' ? `${where}: falta la descripción.` : `${where}: falta la clave.`);
  if (key.length > MAX_KEY_LENGTH) throw new RequestError(400, `${where}: el texto es demasiado largo.`);
  if (typeof r.seconds !== 'number' || r.seconds < 0 || r.seconds > DAY_SECONDS) {
    throw new RequestError(400, `${where}: tiempo no válido.`);
  }
  if (r.kind === 'manual' && r.bucket !== 'client' && r.bucket !== 'internal') {
    throw new RequestError(400, `${where}: el tiempo manual va a un cliente o a interno.`);
  }
  const isClient = r.bucket === 'client';
  if (isClient && typeof r.clientId !== 'number') throw new RequestError(400, `${where}: falta el cliente.`);
  return {
    kind: r.kind as Assignment['kind'],
    key,
    seconds: Math.round(r.seconds),
    bucket: r.bucket as Bucket,
    clientId: isClient ? (r.clientId as number) : null,
    remember: isClient && r.kind !== 'manual' && r.remember === true,
  };
}

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        reject(new RequestError(413, 'Petición demasiado grande.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        const parsed: unknown = JSON.parse(body);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          resolve(parsed as Record<string, unknown>);
          return;
        }
      } catch {
        // Se trata abajo.
      }
      reject(new RequestError(400, 'El cuerpo de la petición debe ser un objeto JSON.'));
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
