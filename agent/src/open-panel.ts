// Abre el panel en una ventana propia.
// Uso: npm run panel   (con el agente en marcha)
import { config } from './config.ts';
import { openPanelWindow } from './open-window.ts';

try {
  await fetch(`http://127.0.0.1:${config.port}/api/summary`);
} catch {
  console.error('El agente no está en marcha. Arráncalo primero con npm run arrancar.');
  process.exit(1);
}

openPanelWindow('/');
console.log(`Panel abierto: http://127.0.0.1:${config.port}/`);
