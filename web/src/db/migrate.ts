// Aplica, en orden y una sola vez, los archivos de migrations/. Lo hace el servidor al
// arrancar; también se puede lanzar a mano con: npm run migrate (scripts/migrate.ts)
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { config } from '../config.ts';

const dir = fileURLToPath(new URL('./migrations/', import.meta.url));

/** Devuelve los nombres de las migraciones aplicadas ahora. */
export async function runMigrations(): Promise<string[]> {
  // Conexión aparte que admite varias sentencias por archivo.
  const conn = await mysql.createConnection({ uri: config.databaseUrl, multipleStatements: true, charset: 'utf8mb4_unicode_ci' });
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name       VARCHAR(255) PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci`);
    const [rows] = await conn.query('SELECT name FROM schema_migrations');
    const applied = new Set((rows as { name: string }[]).map((r) => r.name));
    const pending = (await readdir(dir)).filter((f) => f.endsWith('.sql') && !applied.has(f)).sort();
    for (const file of pending) {
      // En MySQL/MariaDB los CREATE/ALTER no van en transacción: cada archivo se registra al terminar.
      await conn.query(await readFile(`${dir}${file}`, 'utf8'));
      await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
    }
    return pending;
  } finally {
    await conn.end();
  }
}
