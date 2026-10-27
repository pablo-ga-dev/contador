// Abre el panel en una ventana propia (modo aplicación de Edge, Chrome o Brave:
// sin pestañas ni barra de direcciones). Si no hay ninguno, usa el navegador por defecto.
// Uso: npm run panel   (con el agente en marcha)
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';

const url = `http://127.0.0.1:${config.port}/`;

try {
  await fetch(`${url}api/summary`);
} catch {
  console.error('El agente no está en marcha. Arráncalo primero con npm start.');
  process.exit(1);
}

const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA];
const browsers = [
  'Microsoft/Edge/Application/msedge.exe',
  'Google/Chrome/Application/chrome.exe',
  'BraveSoftware/Brave-Browser/Application/brave.exe',
];
const exe = browsers
  .flatMap((b) => roots.filter((r) => r !== undefined).map((r) => path.join(r, b)))
  .find((p) => existsSync(p));

const [command, args] = exe
  ? [exe, [`--app=${url}`, '--window-size=1100,760']]
  : ['cmd.exe', ['/c', 'start', '', url]];
spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
console.log(`Panel abierto: ${url}`);
