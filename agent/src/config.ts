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
  /** Nombres de proceso que consideramos navegadores (en minúsculas). */
  browserApps: ['chrome', 'msedge', 'brave', 'opera', 'vivaldi'],
  /** Carpeta de datos locales. Nada de aquí sale del equipo. */
  dataDir:
    process.env.CONTADOR_DATA_DIR ??
    path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'contador'),
};
