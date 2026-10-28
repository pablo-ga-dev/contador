import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { Activity, ActivityKind, Segment } from '../core/types.ts';

export interface Total {
  key: string;
  seconds: number;
}

const SECONDS = '(julianday(ended_at) - julianday(started_at)) * 86400';

/** Guarda los tramos en la base SQLite local (incluida en Node, sin dependencias). */
export class SegmentStore {
  private db: DatabaseSync;
  private insertStmt: StatementSync;
  private updateStmt: StatementSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS segments (
        id         INTEGER PRIMARY KEY,
        started_at TEXT NOT NULL,
        ended_at   TEXT NOT NULL,
        app        TEXT NOT NULL,
        title      TEXT NOT NULL,
        domain     TEXT,
        chat       TEXT
      );
      CREATE INDEX IF NOT EXISTS segments_started_at ON segments (started_at);
    `);
    // Bases creadas antes de detectar chats de WhatsApp.
    const columns = this.db.prepare('PRAGMA table_info(segments)').all();
    if (!columns.some((c) => c.name === 'chat')) {
      this.db.exec('ALTER TABLE segments ADD COLUMN chat TEXT');
    }
    this.insertStmt = this.db.prepare(
      'INSERT INTO segments (started_at, ended_at, app, title, domain, chat) VALUES (?, ?, ?, ?, ?, ?)',
    );
    this.updateStmt = this.db.prepare('UPDATE segments SET ended_at = ? WHERE id = ?');
  }

  insert(s: Segment): number {
    const result = this.insertStmt.run(
      s.start.toISOString(),
      s.end.toISOString(),
      s.app,
      s.title,
      s.domain,
      s.chat,
    );
    return Number(result.lastInsertRowid);
  }

  update(s: Segment): void {
    if (s.id === undefined) return;
    this.updateStmt.run(s.end.toISOString(), s.id);
  }

  /** Tiempo total entre `from` y `to`, agrupado por aplicación, dominio o chat. */
  totalsBy(field: 'app' | 'domain' | 'chat', from: Date, to: Date): Total[] {
    const rows = this.db
      .prepare(
        `SELECT ${field} AS key,
                SUM(${SECONDS}) AS seconds
           FROM segments
          WHERE started_at >= ? AND started_at < ? AND ${field} IS NOT NULL
          GROUP BY ${field}
          ORDER BY seconds DESC`,
      )
      .all(from.toISOString(), to.toISOString());
    return rows.map((r) => ({ key: String(r.key), seconds: Number(r.seconds) }));
  }

  /**
   * Tiempo entre `from` y `to` agrupado como se revisa: por dominio si es una web,
   * por chat si es WhatsApp y, si no, por aplicación.
   */
  activities(from: Date, to: Date): Activity[] {
    const rows = this.db
      .prepare(
        `SELECT CASE WHEN domain IS NOT NULL THEN 'domain'
                     WHEN chat IS NOT NULL THEN 'chat'
                     ELSE 'app' END AS kind,
                COALESCE(domain, chat, app) AS key,
                SUM(${SECONDS}) AS seconds
           FROM segments
          WHERE started_at >= ? AND started_at < ?
          GROUP BY kind, key
          ORDER BY seconds DESC`,
      )
      .all(from.toISOString(), to.toISOString());
    return rows.map((r) => ({
      kind: r.kind as ActivityKind,
      key: String(r.key),
      seconds: Math.round(Number(r.seconds)),
    }));
  }

  /** Inicio de la primera actividad entre `from` y `to`, o null si no hubo ninguna. */
  firstStart(from: Date, to: Date): Date | null {
    const row = this.db
      .prepare('SELECT MIN(started_at) AS first FROM segments WHERE started_at >= ? AND started_at < ?')
      .get(from.toISOString(), to.toISOString());
    return row?.first ? new Date(String(row.first)) : null;
  }

  /** Días (AAAA-MM-DD, hora local) con alguna actividad entre `from` y `to`. */
  activeDates(from: Date, to: Date): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT date(started_at, 'localtime') AS day
           FROM segments
          WHERE started_at >= ? AND started_at < ?
          ORDER BY day`,
      )
      .all(from.toISOString(), to.toISOString());
    return rows.map((r) => String(r.day));
  }

  /** El tramo más reciente, o null si no hay ninguno. */
  latest(): Segment | null {
    const row = this.db
      .prepare('SELECT id, started_at, ended_at, app, title, domain, chat FROM segments ORDER BY id DESC LIMIT 1')
      .get();
    if (!row) return null;
    return {
      id: Number(row.id),
      start: new Date(String(row.started_at)),
      end: new Date(String(row.ended_at)),
      app: String(row.app),
      title: String(row.title),
      domain: row.domain === null ? null : String(row.domain),
      chat: row.chat === null ? null : String(row.chat),
    };
  }
}
