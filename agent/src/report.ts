// Resumen de un día: tiempo por aplicación y por dominio.
// Uso: npm run report            (hoy)
//      npm run report 2026-10-27 (un día concreto)
import path from 'node:path';
import { config } from './config.ts';
import { SegmentStore, type Total } from './storage/segment-store.ts';

const arg = process.argv[2];
const from = arg ? new Date(`${arg}T00:00:00`) : new Date();
if (Number.isNaN(from.getTime())) {
  console.error(`Fecha no válida: ${arg} (formato AAAA-MM-DD)`);
  process.exit(1);
}
from.setHours(0, 0, 0, 0);
const to = new Date(from);
to.setDate(to.getDate() + 1);

const store = new SegmentStore(path.join(config.dataDir, 'contador.db'));

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

function print(heading: string, totals: Total[]): void {
  console.log(`\n${heading}`);
  if (totals.length === 0) {
    console.log('  (sin datos)');
    return;
  }
  const width = Math.max(...totals.map((t) => t.key.length));
  for (const t of totals) console.log(`  ${t.key.padEnd(width)}  ${formatDuration(t.seconds)}`);
}

const byApp = store.totalsBy('app', from, to);
const total = byApp.reduce((sum, t) => sum + t.seconds, 0);

console.log(`Actividad del ${from.toLocaleDateString('es-ES')}: ${formatDuration(total)}`);
print('Por aplicación', byApp);
print('Por dominio', store.totalsBy('domain', from, to));
store.close();
