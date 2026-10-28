/** Conexión a MySQL o MariaDB: una URL o, más cómodo con phpMyAdmin, las piezas por separado. */
function database(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  if (!DB_USER || !DB_NAME) {
    console.error('Falta la conexión a la base de datos: DB_HOST, DB_USER, DB_PASSWORD y DB_NAME en .env (copia .env.example).');
    process.exit(1);
  }
  const auth = `${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASSWORD ?? '')}`;
  return `mysql://${auth}@${DB_HOST ?? 'localhost'}:${DB_PORT ?? 3306}/${encodeURIComponent(DB_NAME)}`;
}

export const config = {
  databaseUrl: database(),
  port: Number(process.env.PORT ?? 3030),
  /** true en producción con HTTPS: la cookie de sesión solo viaja cifrada. */
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  /** Duración de la sesión web. */
  sessionDays: 30,
  /** Zona horaria con la que se decide qué día y qué mes es "hoy" (meses de las horas contratadas). */
  timezone: process.env.TIMEZONE ?? 'Europe/Madrid',
};

/** Fecha de hoy (AAAA-MM-DD) en la zona horaria de la empresa. */
export function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(new Date());
}
