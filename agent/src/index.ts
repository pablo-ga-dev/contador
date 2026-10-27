import path from 'node:path';
import { config } from './config.ts';
import { Tracker } from './core/tracker.ts';
import { LocalServer } from './server/local-server.ts';
import { BrowserReceiver } from './sources/browser/browser-receiver.ts';
import { WindowsWindowSource } from './sources/windows/windows-window-source.ts';
import { SegmentStore } from './storage/segment-store.ts';

if (process.platform !== 'win32') {
  console.error('De momento el agente solo funciona en Windows.');
  process.exit(1);
}

const dbFile = path.join(config.dataDir, 'contador.db');
const store = new SegmentStore(dbFile);
const browser = new BrowserReceiver();
const server = new LocalServer(config.port, store, browser);
const tracker = new Tracker(store, browser);
const windows = new WindowsWindowSource(config.pollIntervalSeconds);

server.start();
windows.start((sample) => tracker.handle(sample));

console.log(`Contador en marcha. Datos en ${dbFile}`);
console.log(`Panel: http://127.0.0.1:${config.port} (o npm run panel para abrirlo en su ventana)`);
console.log('Pulsa Ctrl+C para parar.');

function shutdown(): void {
  tracker.stopAt(new Date());
  windows.stop();
  server.stop();
  store.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
