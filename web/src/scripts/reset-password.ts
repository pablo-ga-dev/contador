// Genera una contraseña temporal nueva para un usuario que ya existe y cierra sus sesiones.
// Uso: npm run reset-password -- ana@empresa.com
import { db, sql } from '../db/index.ts';
import { resetPassword } from '../users.ts';

const [email] = process.argv.slice(2);
if (!email) {
  console.error('Uso: npm run reset-password -- <email>');
  process.exit(1);
}

try {
  const user = await db.one<{ id: number; name: string }>(sql`SELECT id, name FROM users WHERE email = ${email.toLowerCase()}`);
  if (!user) {
    console.error(`No existe ningún usuario con el email ${email.toLowerCase()}.`);
    process.exitCode = 1;
  } else {
    const password = await resetPassword(user.id);
    console.log(`Contraseña restablecida para ${user.name} <${email.toLowerCase()}>`);
    console.log(`Contraseña temporal: ${password}`);
    console.log('Se han cerrado sus sesiones abiertas. Cámbiala al entrar.');
  }
} finally {
  await db.end();
}
