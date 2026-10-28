// Cambia el rol de un usuario (por si nadie puede entrar como administrador).
// Uso: npm run set-role -- ana@empresa.com admin     (o user)
import { db, sql } from '../db/index.ts';
import { parseRole, setRole } from '../users.ts';

const [email, role] = process.argv.slice(2);
if (!email || !role) {
  console.error('Uso: npm run set-role -- <email> admin|user');
  process.exit(1);
}

try {
  const user = await db.one<{ id: number; name: string }>(sql`SELECT id, name FROM users WHERE email = ${email.toLowerCase()}`);
  if (!user) throw new Error(`No existe ningún usuario con el email ${email.toLowerCase()}.`);
  await setRole(user.id, parseRole(role));
  console.log(`${user.name} ahora es ${role === 'admin' ? 'administrador' : 'usuario'}.`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await db.end();
}
