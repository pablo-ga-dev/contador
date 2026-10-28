// Arranca el agente en segundo plano, sin ventana y sin depender de la terminal.
// Si ya hay uno en marcha, no hace nada (dos contarían el tiempo dos veces).
// Uso: npm run arrancar   (también lo usa el arranque con Windows)
import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));

try {
  await fetch(`http://127.0.0.1:${config.port}/api/settings`, { signal: AbortSignal.timeout(2000) });
  console.log('El agente ya estaba en marcha.');
  process.exit(0);
} catch {
  // No responde: lo arrancamos.
}

mkdirSync(config.dataDir, { recursive: true });
const out = openSync(path.join(config.dataDir, 'agente.log'), 'w');
const err = openSync(path.join(config.dataDir, 'agente-error.log'), 'w');
spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'agent/src/index.ts'], {
  cwd: root,
  detached: true,
  stdio: ['ignore', out, err],
  windowsHide: true,
}).unref();
console.log(`Agente arrancado en segundo plano. Panel: http://127.0.0.1:${config.port}`);
console.log(`Lo que escribe está en ${config.dataDir} (agente.log y agente-error.log).`);
