// Para el agente que esté en marcha en segundo plano, cerrando bien el tramo actual.
// Uso: npm run parar
import { config } from './config.ts';

try {
  const res = await fetch(`http://127.0.0.1:${config.port}/api/shutdown`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  console.log(res.ok ? 'Agente parado.' : `El agente respondió con un error ${res.status}.`);
} catch {
  console.log('El agente no estaba en marcha.');
}
