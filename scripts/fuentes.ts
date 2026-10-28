// Instala las fuentes de la marca (Outfit SemiBold y Switzer Light) desde el zip
// de Fontshare en el panel del agente y en la web.
// Uso: npm run fuentes -- C:\ruta\FontshareKit-XXXX.zip
//
// La licencia de Fontshare (ITF FFL) permite usarlas en nuestras propias web y app,
// pero no publicarlas: por eso no están en el repositorio y cada máquina las instala
// desde su copia descargada de Fontshare. Sin ellas se usan fuentes del sistema.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FONTS = ['Outfit-SemiBold.woff2', 'Switzer-Light.woff2'];
const root = fileURLToPath(new URL('..', import.meta.url));
const targets = [path.join(root, 'agent/src/ui/fonts'), path.join(root, 'web/public/fonts')];

const zip = process.argv[2];
if (!zip) {
  console.error('Uso: npm run fuentes -- <ruta del zip de Fontshare>');
  process.exit(1);
}

// tar de Windows 10+ y de macOS (bsdtar) sabe abrir zip; en Windows usamos el del sistema,
// no el de Git, que no los entiende.
const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
const tmp = mkdtempSync(path.join(os.tmpdir(), 'dialogue-fuentes-'));
try {
  execFileSync(tar, ['-xf', path.resolve(zip), '-C', tmp]);
  const found = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (FONTS.includes(entry.name)) found.set(entry.name, full);
    }
  };
  walk(tmp);
  const missing = FONTS.filter((f) => !found.has(f));
  if (missing.length) {
    console.error(`No encuentro en el zip: ${missing.join(', ')}`);
    process.exit(1);
  }
  for (const dir of targets) {
    mkdirSync(dir, { recursive: true });
    // Quita las fuentes de versiones anteriores de la marca.
    for (const old of readdirSync(dir)) {
      if (old.endsWith('.woff2') && !FONTS.includes(old)) rmSync(path.join(dir, old));
    }
    for (const [name, file] of found) copyFileSync(file, path.join(dir, name));
    console.log(`Fuentes instaladas en ${path.relative(root, dir)}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
