// Da de alta a un usuario con una contraseña temporal que se muestra una sola vez.
// Uso: npm run create-user -- ana@empresa.com "Ana López"            (usuario)
//      npm run create-user -- ana@empresa.com "Ana López" --admin    (administrador)
// El primer administrador se crea así; después, desde la página Equipo de la web.
import { runMigrations } from '../db/migrate.ts';
import { db } from '../db/index.ts';
import { createUser } from '../users.ts';

const args = process.argv.slice(2);
const admin = args.includes('--admin');
const [email, name] = args.filter((a) => a !== '--admin');
if (!email || !name) {
  console.error('Uso: npm run create-user -- <email> "<nombre>" [--admin]');
  process.exit(1);
}

try {
  await runMigrations();
  const { password } = await createUser(email, name, admin ? 'admin' : 'user');
  console.log(`${admin ? 'Administrador' : 'Usuario'} creado: ${name} <${email.toLowerCase()}>`);
  console.log(`Contraseña temporal: ${password}`);
  console.log('Pásasela por un canal privado y pídele que la cambie al entrar.');
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await db.end();
}
