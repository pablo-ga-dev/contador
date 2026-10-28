import { fileURLToPath } from 'node:url';
import type { WindowSource } from '../core/types.ts';
import { ScriptWindowSource } from './script-window-source.ts';

const WINDOWS_SCRIPT = fileURLToPath(new URL('./windows/foreground.ps1', import.meta.url));
const MAC_SCRIPT = fileURLToPath(new URL('./macos/foreground.js', import.meta.url));

/** Fuente de ventana activa e inactividad para este sistema operativo. */
export function createWindowSource(intervalSeconds: number): WindowSource {
  const interval = String(intervalSeconds);
  // Con el PID del agente, el script se cierra solo si el agente muere.
  const parent = String(process.pid);
  if (process.platform === 'win32') {
    return new ScriptWindowSource('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', WINDOWS_SCRIPT, '-IntervalSeconds', interval, '-ParentPid', parent,
    ]);
  }
  if (process.platform === 'darwin') {
    return new ScriptWindowSource('osascript', ['-l', 'JavaScript', MAC_SCRIPT, interval, parent]);
  }
  throw new Error(`DIALOGUE aún no funciona en ${process.platform}: solo en Windows y macOS.`);
}
