import type { ReviewStore } from '../storage/review-store.ts';
import type { SegmentStore } from '../storage/segment-store.ts';
import { localDate } from './day-range.ts';

export const DEFAULT_RETENTION_DAYS = 60;
export const MIN_RETENTION_DAYS = 7;
export const MAX_RETENTION_DAYS = 365;
const CHECK_INTERVAL_MS = 6 * 3600 * 1000;

export function retentionDays(reviews: ReviewStore): number {
  return Number(reviews.getSetting('retentionDays') ?? DEFAULT_RETENTION_DAYS);
}

/**
 * Borra de este PC el detalle de los días más antiguos que el tiempo de guardado:
 * los tramos (webs, apps, chats y lo que quedó sin cliente) y las revisiones ya
 * enviadas. Lo que no se ha podido enviar se conserva hasta que se envíe.
 * Se hace al arrancar y cada 6 horas.
 */
export class Retention {
  private segments: SegmentStore;
  private reviews: ReviewStore;
  private timer: NodeJS.Timeout | null = null;

  constructor(segments: SegmentStore, reviews: ReviewStore) {
    this.segments = segments;
    this.reviews = reviews;
  }

  start(): void {
    this.run();
    this.timer = setInterval(() => this.run(), CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Devuelve cuántos días se han borrado. */
  run(now = new Date()): number {
    // Medianoche local del primer día que se conserva.
    const keepFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate() - retentionDays(this.reviews) + 1);
    const days = this.segments.activeDates(new Date(0), keepFrom).length;
    this.segments.deleteBefore(keepFrom);
    this.reviews.deleteSentBefore(localDate(keepFrom));
    return days;
  }
}
