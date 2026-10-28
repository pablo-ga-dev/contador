// Genera una contraseña temporal nueva para un usuario que ya existe y cierra sus sesiones.
// Uso: npm run reset-password -- ana@empresa.com
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../auth/crypto.ts';
import { sql } from '../db/index.ts';

const [email] = process.argv.slice(2);
if (!email) {
  console.error('Uso: npm run reset-password -- <email>');
  process.exit(1);
}

const password = randomBytes(9).toString('base64url');
try {
  const [user] = await sql<{ id: number; name: string }[]>`
    UPDATE users SET password_hash = ${await hashPassword(password)}
     WHERE email = ${email.toLowerCase()}
    RETURNING id, name`;
  if (!user) {
    console.error(`No existe ningún usuario con el email ${email.toLowerCase()}.`);
    process.exitCode = 1;
  } else {
    await sql`DELETE FROM sessions WHERE user_id = ${user.id}`;
    console.log(`Contraseña restablecida para ${user.name} <${email.toLowerCase()}>`);
    console.log(`Contraseña temporal: ${password}`);
    console.log('Se han cerrado sus sesiones abiertas. Cámbiala al entrar.');
  }
} finally {
  await sql.end();
}
