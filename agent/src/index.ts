import path from 'node:path';
import { config } from './config.ts';
import { Tracker } from './core/tracker.ts';
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
const server = new LocalServer({ port: config.port, segments, reviews, browser, web, sync });
const tracker = new Tracker(segments, browser);
const windows = new WindowsWindowSource(config.pollIntervalSeconds);

server.start();
sync.start();
windows.start((sample) => tracker.handle(sample));

console.log(`Contador en marcha. Datos en ${dbFile}`);
console.log(`Panel: http://127.0.0.1:${config.port} (o npm run panel para abrirlo en su ventana)`);
console.log('Pulsa Ctrl+C para parar.');

function shutdown(): void {
  tracker.stopAt(new Date());
  windows.stop();
  sync.stop();
  server.stop();
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
