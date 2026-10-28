import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { config } from './config.ts';

// Arranque automático al iniciar sesión, solo para este usuario y sin permisos de administrador:
// en Windows, la clave Run del registro; en macOS, un LaunchAgent.

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export interface AutostartStatus {
  enabled: boolean;
  /** false si apunta a otra carpeta (o, en Mac, a otra versión de Node): hay que volver a activarlo. */
  upToDate: boolean;
}

export async function autostartStatus(): Promise<AutostartStatus> {
  if (process.platform === 'win32') return windows.status();
  if (process.platform === 'darwin') return mac.status();
  return { enabled: false, upToDate: false };
}

export async function setAutostart(enabled: boolean): Promise<void> {
  if (process.platform === 'win32') return windows.set(enabled);
  if (process.platform === 'darwin') return mac.set(enabled);
  throw new Error(`El arranque automático aún no funciona en ${process.platform}.`);
}

/** Windows: si estaba activado con el nombre antiguo ("Contador"), lo pasa a "DIALOGUE". */
export async function migrateLegacyAutostart(): Promise<void> {
  if (process.platform !== 'win32') return;
  try {
    await run('reg', ['query', windows.RUN_KEY, '/v', windows.LEGACY_VALUE_NAME]);
  } catch {
    return; // No había nada con el nombre antiguo.
  }
  await windows.set(true);
  await run('reg', ['delete', windows.RUN_KEY, '/v', windows.LEGACY_VALUE_NAME, '/f']);
}

const windows = {
  RUN_KEY: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  VALUE_NAME: 'DIALOGUE',
  /** Nombre con el que se registraba antes de la marca DIALOGUE. */
  LEGACY_VALUE_NAME: 'Contador',

  /** Lo que Windows ejecutará al iniciar sesión. */
  command(): string {
    const script = path.join(ROOT, 'agent', 'scripts', 'start-hidden.ps1');
    return `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${script}"`;
  },

  async status(): Promise<AutostartStatus> {
    try {
      const { stdout } = await run('reg', ['query', this.RUN_KEY, '/v', this.VALUE_NAME]);
      const value = stdout.split(/REG_SZ\s+/)[1]?.trim();
      return { enabled: true, upToDate: value === this.command() };
    } catch {
      return { enabled: false, upToDate: false };
    }
  },

  async set(enabled: boolean): Promise<void> {
    if (enabled) {
      await run('reg', ['add', this.RUN_KEY, '/v', this.VALUE_NAME, '/t', 'REG_SZ', '/d', this.command(), '/f']);
    } else if ((await this.status()).enabled) {
      await run('reg', ['delete', this.RUN_KEY, '/v', this.VALUE_NAME, '/f']);
    }
  },
};

const mac = {
  LABEL: 'com.dialogue.agent',

  file(): string {
    return path.join(os.homedir(), 'Library', 'LaunchAgents', `${this.LABEL}.plist`);
  },

  /** LaunchAgent que macOS lanza al iniciar sesión: el mismo Node con el que se activó. */
  plist(): string {
    const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const log = (name: string) => xml(path.join(config.dataDir, name));
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${this.LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(process.execPath)}</string>
    <string>--disable-warning=ExperimentalWarning</string>
    <string>agent/src/index.ts</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(ROOT)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${log('agente.log')}</string>
  <key>StandardErrorPath</key>
  <string>${log('agente-error.log')}</string>
</dict>
</plist>
`;
  },

  async status(): Promise<AutostartStatus> {
    try {
      const content = await readFile(this.file(), 'utf8');
      return { enabled: true, upToDate: content === this.plist() };
    } catch {
      return { enabled: false, upToDate: false };
    }
  },

  /**
   * Activarlo solo deja el archivo: macOS lo lanzará en el próximo inicio de sesión.
   * Desactivarlo lo borra; el agente que ya esté en marcha sigue hasta que se pare.
   */
  async set(enabled: boolean): Promise<void> {
    if (enabled) {
      await mkdir(path.dirname(this.file()), { recursive: true });
      await mkdir(config.dataDir, { recursive: true });
      await writeFile(this.file(), this.plist());
    } else {
      await rm(this.file(), { force: true });
    }
  },
};
