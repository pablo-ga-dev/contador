import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
/** Programas que Windows abre al iniciar sesión (solo para este usuario, sin permisos de administrador). */
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const VALUE_NAME = 'DIALOGUE';
/** Nombre con el que se registraba antes de la marca DIALOGUE. */
const LEGACY_VALUE_NAME = 'Contador';
const SCRIPT = fileURLToPath(new URL('../scripts/start-hidden.ps1', import.meta.url));

/** Lo que Windows ejecutará al iniciar sesión. */
export function autostartCommand(): string {
  return `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${SCRIPT}"`;
}

/**
 * Si el arranque con Windows está activado y si apunta a esta carpeta
 * (deja de hacerlo si se mueve el proyecto de sitio).
 */
export async function autostartStatus(): Promise<{ enabled: boolean; upToDate: boolean }> {
  try {
    const { stdout } = await run('reg', ['query', RUN_KEY, '/v', VALUE_NAME]);
    const value = stdout.split(/REG_SZ\s+/)[1]?.trim();
    return { enabled: true, upToDate: value === autostartCommand() };
  } catch {
    return { enabled: false, upToDate: false };
  }
}

export async function setAutostart(enabled: boolean): Promise<void> {
  if (enabled) {
    await run('reg', ['add', RUN_KEY, '/v', VALUE_NAME, '/t', 'REG_SZ', '/d', autostartCommand(), '/f']);
  } else if ((await autostartStatus()).enabled) {
    await run('reg', ['delete', RUN_KEY, '/v', VALUE_NAME, '/f']);
  }
}

/** Si estaba activado con el nombre antiguo ("Contador"), lo pasa a "DIALOGUE". */
export async function migrateLegacyAutostart(): Promise<void> {
  try {
    await run('reg', ['query', RUN_KEY, '/v', LEGACY_VALUE_NAME]);
  } catch {
    return; // No había nada con el nombre antiguo.
  }
  await setAutostart(true);
  await run('reg', ['delete', RUN_KEY, '/v', LEGACY_VALUE_NAME, '/f']);
}
