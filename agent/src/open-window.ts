import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from './config.ts';

const WINDOWS_BROWSERS = [
  'Microsoft/Edge/Application/msedge.exe',
  'Google/Chrome/Application/chrome.exe',
  'BraveSoftware/Brave-Browser/Application/brave.exe',
];
const MAC_BROWSERS = ['Google Chrome', 'Microsoft Edge', 'Brave Browser'];

/**
 * Abre una página del panel en una ventana propia: modo aplicación de Edge, Chrome
 * o Brave (sin pestañas ni barra de direcciones). Si no hay ninguno, el navegador por defecto.
 */
export function openPanelWindow(page = '/'): void {
  const url = `http://127.0.0.1:${config.port}${page}`;
  const appArgs = [`--app=${url}`, '--window-size=1100,760'];
  const [command, args] = process.platform === 'darwin' ? macCommand(url, appArgs) : windowsCommand(url, appArgs);
  spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

function windowsCommand(url: string, appArgs: string[]): [string, string[]] {
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA];
  const exe = WINDOWS_BROWSERS
    .flatMap((b) => roots.filter((r) => r !== undefined).map((r) => path.join(r, b)))
    .find((p) => existsSync(p));
  return exe ? [exe, appArgs] : ['cmd.exe', ['/c', 'start', '', url]];
}

function macCommand(url: string, appArgs: string[]): [string, string[]] {
  const app = MAC_BROWSERS.find((name) =>
    ['/Applications', path.join(os.homedir(), 'Applications')].some((dir) => existsSync(path.join(dir, `${name}.app`))),
  );
  // "-n" hace que el navegador reciba los argumentos aunque ya esté abierto.
  return app ? ['open', ['-na', app, '--args', ...appArgs]] : ['open', [url]];
}
