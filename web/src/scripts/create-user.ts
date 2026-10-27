// Da de alta a un usuario con una contraseña temporal que se muestra una sola vez.
// Uso: npm run create-user -- ana@empresa.com "Ana López"
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../auth/crypto.ts';
import { sql } from '../db/index.ts';

const [email, name] = process.argv.slice(2);
if (!email || !name) {
  console.error('Uso: npm run create-user -- <email> "<nombre>"');
  process.exit(1);
}

const password = randomBytes(9).toString('base64url');
try {
  await sql`
    INSERT INTO users (email, name, password_hash)
    VALUES (${email.toLowerCase()}, ${name}, ${await hashPassword(password)})`;
  console.log(`Usuario creado: ${name} <${email.toLowerCase()}>`);
  console.log(`Contraseña temporal: ${password}`);
  console.log('Pásasela por un canal privado y pídele que la cambie al entrar.');
} catch (err) {
  console.error((err as { code?: string }).code === '23505' ? 'Ya existe un usuario con ese email.' : err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
