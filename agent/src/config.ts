import os from 'node:os';
import path from 'node:path';

export const config = {
  /** Cada cuántos segundos se mira la ventana activa. */
  pollIntervalSeconds: 5,
  /** Sin tocar teclado ni ratón durante este tiempo, se deja de contar. */
  idleThresholdSeconds: 180,
  /** Puerto local (solo 127.0.0.1) para la extensión del navegador y el panel. */
  port: Number(process.env.CONTADOR_PORT ?? 5611),
  /** Si el navegador lleva este tiempo sin informar, su dominio se da por desconocido. */
  browserStaleSeconds: 90,
  /** Apps que consideramos navegadores (en minúsculas): procesos de Windows y apps de macOS. */
  browserApps: [
    'chrome', 'msedge', 'brave', 'opera', 'vivaldi',
    'google chrome', 'microsoft edge', 'brave browser', 'arc', 'chromium',
  ],
  /** Carpeta de datos locales. Nada de aquí sale del equipo. */
  dataDir: process.env.CONTADOR_DATA_DIR ?? defaultDataDir(),
};

function defaultDataDir(): string {
  // En Windows se mantiene "contador" para no perder los datos de antes de la marca DIALOGUE.
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'contador');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'DIALOGUE');
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'), 'dialogue');
}
