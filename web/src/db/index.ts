import mysql, { type Pool, type PoolConnection, type ResultSetHeader } from 'mysql2/promise';
import { config } from '../config.ts';

/** Trozo de SQL con sus valores. Se escribe con la plantilla sql`...`. */
export class Sql {
  text: string;
  values: unknown[];

  constructor(text: string, values: unknown[]) {
    this.text = text;
    this.values = values;
  }
}

/**
 * sql`SELECT ... WHERE id = ${id}`: los valores van siempre como parámetros (?), nunca
 * pegados al texto. Un sql`` dentro de otro se inserta tal cual, y una lista se expande
 * para usarla en IN ${lista} (no puede estar vacía).
 */
export function sql(strings: TemplateStringsArray, ...values: unknown[]): Sql {
  let text = strings[0]!;
  const params: unknown[] = [];
  values.forEach((value, i) => {
    if (value instanceof Sql) {
      text += value.text;
      params.push(...value.values);
    } else if (Array.isArray(value)) {
      if (value.length === 0) throw new Error('Lista vacía en un IN (...)');
      text += `(${value.map(() => '?').join(', ')})`;
      params.push(...value);
    } else {
      text += '?';
      params.push(value);
    }
    text += strings[i + 1]!;
  });
  return new Sql(text, params);
}

/** VALUES (?, ?), (?, ?)... para insertar varias filas de una vez. */
export function rows(values: unknown[][]): Sql {
  return new Sql(values.map((r) => `(${r.map(() => '?').join(', ')})`).join(', '), values.flat());
}

// dateStrings: las fechas llegan como 'AAAA-MM-DD' y 'AAAA-MM-DD hh:mm:ss' (UTC), sin
// conversiones de zona horaria por el camino.
const pool: Pool = mysql.createPool({
  uri: config.databaseUrl,
  dateStrings: true,
  timezone: 'Z',
  charset: 'utf8mb4_unicode_ci',
  decimalNumbers: true,
  connectionLimit: 10,
});
pool.on('connection', (connection) => {
  connection.query("SET time_zone = '+00:00'");
});

export interface Db {
  /** Filas de un SELECT. */
  query<T>(q: Sql): Promise<T[]>;
  /** Primera fila, o undefined. */
  one<T>(q: Sql): Promise<T | undefined>;
  /** INSERT, UPDATE o DELETE: filas afectadas e id insertado. */
  exec(q: Sql): Promise<ResultSetHeader>;
}

function runner(conn: Pool | PoolConnection): Db {
  return {
    async query<T>(q: Sql) {
      const [rows] = await conn.query(q.text, q.values);
      return rows as T[];
    },
    async one<T>(q: Sql) {
      const [rows] = await conn.query(q.text, q.values);
      return (rows as T[])[0];
    },
    async exec(q: Sql) {
      const [result] = await conn.query(q.text, q.values);
      return result as ResultSetHeader;
    },
  };
}

export const db = {
  ...runner(pool),

  /** Ejecuta fn dentro de una transacción: si falla, no queda nada a medias. */
  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(runner(conn));
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  end: () => pool.end(),
};

/** Fecha y hora de la base (UTC, 'AAAA-MM-DD hh:mm:ss') a ISO 8601. */
export function iso(value: string | null): string | null {
  return value ? `${value.replace(' ', 'T')}Z` : null;
}

/** Códigos de error de MySQL/MariaDB que tratamos. */
export const DUPLICATE = 'ER_DUP_ENTRY';
export const MISSING_REFERENCE = 'ER_NO_REFERENCED_ROW_2';
export const errorCode = (err: unknown) => (err as { code?: string }).code;
