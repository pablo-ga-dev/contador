import type { ReviewStore } from '../storage/review-store.ts';
import { WebError, type WebClient } from './web-client.ts';

const RETRY_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Envía a la web los días confirmados que estén pendientes: justo al confirmar,
 * al arrancar el agente y cada 10 minutos, por si no había conexión.
 */
export class DaySync {
  private store: ReviewStore;
  private web: WebClient;
  private running: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(store: ReviewStore, web: WebClient) {
    this.store = store;
    this.web = web;
  }

  start(): void {
    void this.sendPending();
    this.timer = setInterval(() => void this.sendPending(), RETRY_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Si ya hay un envío en marcha, espera a ese en vez de lanzar otro. */
  sendPending(): Promise<void> {
    this.running ??= this.sendAll().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async sendAll(): Promise<void> {
    for (const day of this.store.unsent()) {
      try {
        await this.web.putDay(day.date, day.items);
        this.store.markSent(day);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.store.markError(day, message);
        // Sin conexión o sin código válido fallarán todos: lo dejamos para el siguiente intento.
        if (err instanceof WebError && err.kind !== 'rejected') return;
      }
    }
  }
}
