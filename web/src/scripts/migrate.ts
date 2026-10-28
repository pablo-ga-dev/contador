// Crea o actualiza las tablas. El servidor también lo hace al arrancar.
// Uso: npm run migrate
import { runMigrations } from '../db/migrate.ts';

const applied = await runMigrations();
for (const file of applied) console.log(`Aplicada ${file}`);
console.log(applied.length ? 'Base de datos al día.' : 'Nada que aplicar: la base de datos ya estaba al día.');
