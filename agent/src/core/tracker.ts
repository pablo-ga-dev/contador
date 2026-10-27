import { config } from '../config.ts';
import type { SegmentStore } from '../storage/segment-store.ts';
import type { BrowserSource, Segment, WindowSample } from './types.ts';

/** Si entre dos muestras pasa más que esto (p. ej. el PC se suspendió), se corta el tramo. */
const MAX_GAP_MS = config.pollIntervalSeconds * 3 * 1000;

/**
 * Convierte muestras sueltas en tramos continuos: mientras sigas en la misma
 * ventana (y dominio), se alarga el tramo actual; si cambias, empieza otro.
 */
export class Tracker {
  private current: Segment | null = null;
  private store: SegmentStore;
  private browser: BrowserSource;

  constructor(store: SegmentStore, browser: BrowserSource) {
    this.store = store;
    this.browser = browser;
  }

  handle(sample: WindowSample): void {
    if (!sample.app || sample.idleSeconds >= config.idleThresholdSeconds) {
      this.stopAt(new Date(sample.at.getTime() - sample.idleSeconds * 1000));
      return;
    }

    const domain = this.domainFor(sample);
    const cur = this.current;
    const continuous = cur !== null && sample.at.getTime() - cur.end.getTime() <= MAX_GAP_MS;

    if (continuous && cur.app === sample.app && cur.title === sample.title && cur.domain === domain) {
      cur.end = sample.at;
      this.store.update(cur);
      return;
    }

    // El rato entre la última muestra y esta se lo queda el tramo anterior.
    if (continuous) {
      cur.end = sample.at;
      this.store.update(cur);
    }
    this.current = { start: sample.at, end: sample.at, app: sample.app, title: sample.title, domain };
    this.current.id = this.store.insert(this.current);
  }

  /** Cierra el tramo actual, recortándolo al momento en que dejaste de estar activo. */
  stopAt(lastActive: Date): void {
    const cur = this.current;
    if (!cur) return;
    if (lastActive < cur.end) {
      cur.end = lastActive < cur.start ? cur.start : lastActive;
      this.store.update(cur);
    }
    this.current = null;
  }

  private domainFor(sample: WindowSample): string | null {
    if (!config.browserApps.includes(sample.app.toLowerCase())) return null;
    const last = this.browser.latest();
    if (!last || sample.at.getTime() - last.at.getTime() > config.browserStaleSeconds * 1000) return null;
    return last.domain;
  }
}
