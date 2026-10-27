import http from 'node:http';
import type { BrowserSample, BrowserSource } from '../../core/types.ts';

const MAX_BODY_BYTES = 4096;

/**
 * Pequeño servidor local que recibe de la extensión el dominio de la pestaña activa.
 * Solo escucha en 127.0.0.1 y exige la cabecera X-Contador: una web normal no
 * puede enviarla a otro origen sin una comprobación previa (CORS) que aquí no aceptamos.
 */
export class BrowserReceiver implements BrowserSource {
  private last: BrowserSample | null = null;
  private server: http.Server | null = null;
  private port: number;

  constructor(port: number) {
    this.port = port;
  }

  start(): void {
    this.server = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/browser' || req.headers['x-contador'] !== '1') {
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
          this.last = { at: new Date(), domain: typeof domain === 'string' && domain ? domain : null };
          res.writeHead(204).end();
        } catch {
          res.writeHead(400).end();
        }
      });
    });
    this.server.on('error', (err) => console.error(`[navegador] ${err.message}`));
    this.server.listen(this.port, '127.0.0.1');
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }

  latest(): BrowserSample | null {
    return this.last;
  }
}
