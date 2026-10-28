import type { ReviewStore } from '../storage/review-store.ts';
import type { SegmentStore } from '../storage/segment-store.ts';
import { dayRange } from './day-range.ts';

/** Cuántos días hacia atrás se buscan días sin confirmar. */
const LOOKBACK_DAYS = 14;

/** Días recientes con actividad sin confirmar (sin contar hoy) y días confirmados sin enviar. */
export function pendingDays(segments: SegmentStore, reviews: ReviewStore) {
  const today = dayRange()!.from;
  const since = new Date(today);
  since.setDate(since.getDate() - LOOKBACK_DAYS);
  const confirmed = reviews.confirmedDates();
  return {
    unconfirmed: segments.activeDates(since, today).filter((d) => !confirmed.has(d)),
    unsent: reviews.unsent().map((d) => ({ date: d.date, error: d.lastError })),
  };
}
