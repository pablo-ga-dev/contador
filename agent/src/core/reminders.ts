import type { ReviewStore } from '../storage/review-store.ts';
import type { SegmentStore } from '../storage/segment-store.ts';
import { dayRange, localDate } from './day-range.ts';
import { pendingDays } from './pending-days.ts';

const CHECK_INTERVAL_MS = 60_000;
/** Al arrancar esperamos un poco antes de abrir nada, para que el escritorio termine de cargar. */
const STARTUP_DELAY_MS = 60_000;
/** Solo se recuerda si estás usando el PC ahora mismo: si no, espera a que vuelvas. */
const ACTIVE_WITHIN_MS = 30_000;
export const DEFAULT_REMINDER_HOURS = 7.5;
export const MIN_REMINDER_HOURS = 1;
export const MAX_REMINDER_HOURS = 12;

export interface ReminderSettings {
  /** Recordar revisar el día X horas después de empezar a usar el PC. */
  enabled: boolean;
  hours: number;
  /** Al encender el PC, abrir la revisión si quedan días sin confirmar. */
  startupReview: boolean;
}

export function reminderSettings(reviews: ReviewStore): ReminderSettings {
  return {
    enabled: reviews.getSetting('reminderEnabled') !== 'false',
    hours: Number(reviews.getSetting('reminderHours') ?? DEFAULT_REMINDER_HOURS),
    startupReview: reviews.getSetting('startupReview') !== 'false',
  };
}

export interface RemindersDeps {
  segments: SegmentStore;
  reviews: ReviewStore;
  /** Abre una página del panel en su ventana. */
  open: (page: string) => void;
  now?: () => Date;
}

/** Abre la revisión del día cuando toca. Cada aviso sale como mucho una vez al día. */
export class Reminders {
  private deps: RemindersDeps;
  private now: () => Date;
  private timers: NodeJS.Timeout[] = [];

  constructor(deps: RemindersDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => new Date());
  }

  start(): void {
    this.timers.push(
      setTimeout(() => this.checkStartup(), STARTUP_DELAY_MS),
      setInterval(() => this.checkDaily(), CHECK_INTERVAL_MS),
    );
  }

  stop(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  /**
   * Al encender el PC (el primer arranque del agente en el día): si quedan días
   * sin confirmar, abre la revisión del más antiguo. Devuelve el día abierto.
   */
  checkStartup(): string | null {
    const { reviews, segments, open } = this.deps;
    const today = localDate(this.now());
    if (!reminderSettings(reviews).startupReview || reviews.getSetting('lastStartupReview') === today) return null;
    reviews.setSetting('lastStartupReview', today);
    const [oldest] = pendingDays(segments, reviews).unconfirmed;
    if (!oldest) return null;
    open(`/revisar?date=${oldest}`);
    return oldest;
  }

  /**
   * Pasadas X horas (7 h 30 min por defecto) desde la primera actividad del día,
   * si hoy aún no está confirmado y estás delante del PC, abre la revisión de hoy.
   */
  checkDaily(): boolean {
    const { reviews, segments, open } = this.deps;
    const settings = reminderSettings(reviews);
    const now = this.now();
    const today = localDate(now);
    if (!settings.enabled || reviews.getSetting('lastDailyReminder') === today || reviews.get(today)) return false;

    const { from, to } = dayRange(today)!;
    const first = segments.firstStart(from, to);
    if (!first || now.getTime() - first.getTime() < settings.hours * 3600 * 1000) return false;
    const latest = segments.latest();
    if (!latest || now.getTime() - latest.end.getTime() > ACTIVE_WITHIN_MS) return false;

    reviews.setSetting('lastDailyReminder', today);
    open(`/revisar?date=${today}`);
    return true;
  }
}
