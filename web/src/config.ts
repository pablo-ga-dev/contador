function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Falta la variable de entorno ${name} (copia .env.example como .env).`);
    process.exit(1);
  }
  return value;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  port: Number(process.env.PORT ?? 3030),
  /** true en producción con HTTPS: la cookie de sesión solo viaja cifrada. */
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  /** Duración de la sesión web. */
  sessionDays: 30,
};
