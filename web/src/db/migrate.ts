// Aplica, en orden y una sola vez, los archivos de migrations/.
// Uso: npm run migrate
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sql } from './index.ts';

const dir = fileURLToPath(new URL('./migrations/', import.meta.url));

await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
  name       text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;
const applied = new Set((await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name));
const pending = (await readdir(dir)).filter((f) => f.endsWith('.sql') && !applied.has(f)).sort();

for (const file of pending) {
  const content = await readFile(`${dir}${file}`, 'utf8');
  await sql.begin(async (tx) => {
    await tx.unsafe(content);
    await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
  });
  console.log(`Aplicada ${file}`);
}
console.log(pending.length ? 'Base de datos al día.' : 'Nada que aplicar: la base de datos ya estaba al día.');
await sql.end();
