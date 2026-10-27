import path from 'node:path';
import { config } from './config.ts';
import { Tracker } from './core/tracker.ts';
import { BrowserReceiver } from './sources/browser/browser-receiver.ts';
import { WindowsWindowSource } from './sources/windows/windows-window-source.ts';
import { SegmentStore } from './storage/segment-store.ts';

if (process.platform !== 'win32') {
  console.error('De momento el agente solo funciona en Windows.');
  process.exit(1);
}

const dbFile = path.join(config.dataDir, 'contador.db');
const store = new SegmentStore(dbFile);
const browser = new BrowserReceiver(config.browserPort);
const tracker = new Tracker(store, browser);
const windows = new WindowsWindowSource(config.pollIntervalSeconds);

browser.start();
windows.start((sample) => tracker.handle(sample));

console.log(`Contador en marcha. Datos en ${dbFile}`);
console.log(`Esperando a la extensión del navegador en http://127.0.0.1:${config.browserPort}`);
console.log('Pulsa Ctrl+C para parar.');

function shutdown(): void {
  tracker.stopAt(new Date());
  windows.stop();
  browser.stop();
  store.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
