import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { fileURLToPath } from 'node:url';
import type { AppEnv } from './auth/middleware.ts';
import { config } from './config.ts';
import { HttpError } from './http.ts';
import { authRoutes } from './routes/auth.ts';
import { clientRoutes } from './routes/clients.ts';
import { dayRoutes } from './routes/days.ts';
import { reportRoutes } from './routes/reports.ts';
import { ruleRoutes } from './routes/rules.ts';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));
/** Páginas de la web: ruta → archivo en public/. */
const PAGES: Record<string, string> = {
  '/': 'index.html',
  '/login': 'login.html',
  '/clientes': 'clientes.html',
  '/ajustes': 'ajustes.html',
};

const app = new Hono<AppEnv>();

// Protección CSRF: una web ajena puede enviar formularios con la cookie del usuario,
// pero no peticiones JSON (el navegador exige un permiso CORS que nunca damos).
// Así que todo lo que modifica algo tiene que ser JSON. Funciona igual detrás de un proxy.
app.use('/api/*', async (c, next) => {
  const safe = c.req.method === 'GET' || c.req.method === 'HEAD';
  if (!safe && !c.req.header('content-type')?.startsWith('application/json')) {
    return c.json({ error: 'Las peticiones deben enviarse como JSON.' }, 415);
  }
  await next();
});
app.route('/api/auth', authRoutes);
app.route('/api/clients', clientRoutes);
app.route('/api/rules', ruleRoutes);
app.route('/api/days', dayRoutes);
app.route('/api/reports', reportRoutes);
app.all('/api/*', (c) => c.json({ error: 'No existe.' }, 404));
for (const [route, file] of Object.entries(PAGES)) {
  app.get(route, serveStatic({ root: publicDir, path: file }));
}
app.use('/*', serveStatic({ root: publicDir }));

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ error: 'Error interno.' }, 500);
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Contador web en http://localhost:${info.port}`);
});
