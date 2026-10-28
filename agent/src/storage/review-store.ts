import type { DatabaseSync } from 'node:sqlite';
import type { Assignment } from '../core/types.ts';

/** Día revisado por el usuario. Se guarda aquí antes de enviarlo, por si no hay conexión. */
export interface ConfirmedDay {
  date: string;
  confirmedAt: string;
  /** Todas las asignaciones, incluidas las de "Personal" (que no se envían). */
  items: Assignment[];
  /** null mientras está pendiente de enviar a la web. */
  sentAt: string | null;
  lastError: string | null;
}

export type SettingKey =
  | 'webUrl'
  | 'agentCode'
  | 'userName'
  | 'userEmail'
  | 'clientsCache'
  | 'rulesCache'
  | 'idleMinutes';

/** Ajustes del agente y días confirmados, en la misma base SQLite local. */
export class ReviewStore {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS confirmed_days (
        date         TEXT PRIMARY KEY,
        confirmed_at TEXT NOT NULL,
        items        TEXT NOT NULL,
        sent_at      TEXT,
        last_error   TEXT
      );
    `);
  }

  getSetting(key: SettingKey): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? String(row.value) : null;
  }

  setSetting(key: SettingKey, value: string | null): void {
    if (value === null) {
      this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    } else {
      this.db
        .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
        .run(key, value);
    }
  }

  /** Guarda la revisión de un día como pendiente de enviar (sustituye a la anterior). */
  confirm(date: string, items: Assignment[]): void {
    this.db
      .prepare(
        `INSERT INTO confirmed_days (date, confirmed_at, items, sent_at, last_error)
         VALUES (?, ?, ?, NULL, NULL)
         ON CONFLICT (date) DO UPDATE
           SET confirmed_at = excluded.confirmed_at, items = excluded.items, sent_at = NULL, last_error = NULL`,
      )
      .run(date, new Date().toISOString(), JSON.stringify(items));
  }

  get(date: string): ConfirmedDay | null {
    const row = this.db.prepare('SELECT * FROM confirmed_days WHERE date = ?').get(date);
    return row ? toConfirmedDay(row) : null;
  }

  confirmedDates(): Set<string> {
    const rows = this.db.prepare('SELECT date FROM confirmed_days').all();
    return new Set(rows.map((r) => String(r.date)));
  }

  /** Días confirmados que aún no se han podido enviar, del más antiguo al más reciente. */
  unsent(): ConfirmedDay[] {
    return this.db
      .prepare('SELECT * FROM confirmed_days WHERE sent_at IS NULL ORDER BY date')
      .all()
      .map(toConfirmedDay);
  }

  /** Cuándo se envió algo a la web por última vez, o null si nunca. */
  lastSentAt(): string | null {
    const row = this.db.prepare('SELECT MAX(sent_at) AS last FROM confirmed_days').get();
    return row?.last ? String(row.last) : null;
  }

  /** Marca el día como enviado, salvo que se haya vuelto a confirmar mientras tanto. */
  markSent(day: ConfirmedDay): void {
    this.db
      .prepare('UPDATE confirmed_days SET sent_at = ?, last_error = NULL WHERE date = ? AND confirmed_at = ?')
      .run(new Date().toISOString(), day.date, day.confirmedAt);
  }

  markError(day: ConfirmedDay, message: string): void {
    this.db
      .prepare('UPDATE confirmed_days SET last_error = ? WHERE date = ? AND confirmed_at = ?')
      .run(message, day.date, day.confirmedAt);
  }
}

function toConfirmedDay(row: Record<string, unknown>): ConfirmedDay {
  return {
    date: String(row.date),
    confirmedAt: String(row.confirmed_at),
    items: JSON.parse(String(row.items)) as Assignment[],
    sentAt: row.sent_at === null ? null : String(row.sent_at),
    lastError: row.last_error === null ? null : String(row.last_error),
  };
}
