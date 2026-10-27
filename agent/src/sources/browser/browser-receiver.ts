import type { BrowserSample, BrowserSource } from '../../core/types.ts';

/** Guarda el último dominio que la extensión envía al servidor local (POST /browser). */
export class BrowserReceiver implements BrowserSource {
  private last: BrowserSample | null = null;

  record(domain: string | null): void {
    this.last = { at: new Date(), domain };
  }

  latest(): BrowserSample | null {
    return this.last;
  }
}
