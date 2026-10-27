import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config } from '../config.ts';
import { dayRange, localDate } from '../core/day-range.ts';
import type { BrowserReceiver } from '../sources/browser/browser-receiver.ts';
import type { SegmentStore } from '../storage/segment-store.ts';

const PANEL_FILE = fileURLToPath(new URL('../ui/panel.html', import.meta.url));
const MAX_BODY_BYTES = 4096;
/** Un tramo cuyo final es más reciente que esto se considera "lo que estás haciendo ahora". */
const CURRENT_MAX_AGE_MS = config.pollIntervalSeconds * 3 * 1000;

/**
 * Servidor del agente, solo en 127.0.0.1:
 *   POST /browser       la extensión informa del dominio de la pestaña activa
 *   GET  /              panel con el tiempo del día
 *   GET  /api/summary   datos del panel (?date=AAAA-MM-DD, por defecto hoy)
 */
export class LocalServer {
  private server: http.Server | null = null;
  private port: number;
  private store: SegmentStore;
  private browser: BrowserReceiver;

  constructor(port: number, store: SegmentStore, browser: BrowserReceiver) {
    this.port = port;
    this.store = store;
    this.browser = browser;
  }

  start(): void {
    this.server = http.createServer((req, res) => {
      this.route(req, res).catch((err: unknown) => {
        console.error(`[servidor] ${err instanceof Error ? err.message : String(err)}`);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    this.server.on('error', (err) => console.error(`[servidor] ${err.message}`));
    this.server.listen(this.port, '127.0.0.1');
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }

  private async route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Solo atendemos peticiones dirigidas a nosotros: así una web maliciosa no puede
    // leer los datos haciéndose pasar por 127.0.0.1 ("DNS rebinding").
    const host = req.headers.host ?? '';
    if (host !== `127.0.0.1:${this.port}` && host !== `localhost:${this.port}`) {
      res.writeHead(403).end();
      return;
    }
    const url = new URL(req.url ?? '/', `http://${host}`);

    if (req.method === 'POST' && url.pathname === '/browser') return this.browserReport(req, res);
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(await readFile(PANEL_FILE));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/summary') {
      return this.summary(url.searchParams.get('date') ?? undefined, res);
    }
    res.writeHead(404).end();
  }

  /**
   * Exige la cabecera X-Contador: una web normal no puede enviarla a otro origen
   * sin una comprobación previa (CORS) que aquí no aceptamos.
   */
  private browserReport(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.headers['x-contador'] !== '1') {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) req.destroy();
    });
    req.on('end', () => {
      try {
        const { domain } = JSON.parse(body) as { domain: unknown };
        this.browser.record(typeof domain === 'string' && domain ? domain : null);
        res.writeHead(204).end();
      } catch {
        res.writeHead(400).end();
      }
    });
  }

  private summary(date: string | undefined, res: http.ServerResponse): void {
    const range = dayRange(date);
    if (!range) {
      res.writeHead(400).end();
      return;
    }
    const { from, to } = range;
    const byApp = this.store.totalsBy('app', from, to);
    const latest = this.store.latest();
    const now = Date.now();
    const current =
      latest && now - latest.end.getTime() <= CURRENT_MAX_AGE_MS
        ? {
            app: latest.app,
            title: latest.title,
            domain: latest.domain,
            chat: latest.chat,
            since: latest.start.toISOString(),
            seconds: (latest.end.getTime() - latest.start.getTime()) / 1000,
          }
        : null;

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(
      JSON.stringify({
        date: localDate(from),
        today: localDate(from) === localDate(new Date()),
        totalSeconds: byApp.reduce((sum, t) => sum + t.seconds, 0),
        byApp,
        byDomain: this.store.totalsBy('domain', from, to),
        byChat: this.store.totalsBy('chat', from, to),
        current,
      }),
    );
  }
}
