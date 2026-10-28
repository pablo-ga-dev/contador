import path from 'node:path';
import { config } from './config.ts';
import { Reminders } from './core/reminders.ts';
import { Tracker } from './core/tracker.ts';
import { openPanelWindow } from './open-window.ts';
import { LocalServer } from './server/local-server.ts';
import { BrowserReceiver } from './sources/browser/browser-receiver.ts';
import { WindowsWindowSource } from './sources/windows/windows-window-source.ts';
import { openDatabase } from './storage/database.ts';
import { ReviewStore } from './storage/review-store.ts';
import { SegmentStore } from './storage/segment-store.ts';
import { DaySync } from './sync/day-sync.ts';
import { WebClient } from './sync/web-client.ts';

if (process.platform !== 'win32') {
  console.error('De momento el agente solo funciona en Windows.');
  process.exit(1);
}

const dbFile = path.join(config.dataDir, 'contador.db');
const db = openDatabase(dbFile);
const segments = new SegmentStore(db);
const reviews = new ReviewStore(db);
const browser = new BrowserReceiver();
const web = new WebClient(reviews);
const sync = new DaySync(reviews, web);
const idleMinutes = () => Number(reviews.getSetting('idleMinutes') ?? config.idleThresholdSeconds / 60);
const tracker = new Tracker(segments, browser, () => idleMinutes() * 60);
const windows = new WindowsWindowSource(config.pollIntervalSeconds);
const reminders = new Reminders({ segments, reviews, open: openPanelWindow });
const server = new LocalServer({
  port: config.port, dbFile, segments, reviews, browser, web, sync, onShutdown: shutdown,
});

// Si el puerto está ocupado es que ya hay otro agente: no arrancamos un segundo,
// que contaría todo el tiempo por duplicado.
try {
  await server.start();
} catch (err) {
  const busy = (err as NodeJS.ErrnoException).code === 'EADDRINUSE';
  console.error(busy ? `Ya hay un agente en marcha (puerto ${config.port}). No se arranca otro.` : err);
  db.close();
  process.exit(busy ? 0 : 1);
}
sync.start();
reminders.start();
windows.start((sample) => tracker.handle(sample));

console.log(`Contador en marcha. Datos en ${dbFile}`);
console.log(`Panel: http://127.0.0.1:${config.port} (o npm run panel para abrirlo en su ventana)`);
console.log('Pulsa Ctrl+C (o npm run parar) para parar.');

function shutdown(): void {
  tracker.stopAt(new Date());
  windows.stop();
  reminders.stop();
  sync.stop();
  server.stop();
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
