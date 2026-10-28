import { randomBytes } from 'node:crypto';
import { hashPassword } from './auth/crypto.ts';
import type { Role } from './auth/middleware.ts';
import { DUPLICATE, db, errorCode, sql, type Db } from './db/index.ts';
import { HttpError } from './http.ts';

/** Contraseña temporal: se muestra una sola vez y la persona la cambia al entrar. */
export function temporaryPassword(): string {
  return randomBytes(9).toString('base64url');
}

/** Da de alta a un usuario con una contraseña temporal. Devuelve su id y la contraseña. */
export async function createUser(email: string, name: string, role: Role): Promise<{ id: number; password: string }> {
  const password = temporaryPassword();
  try {
    const result = await db.exec(sql`
      INSERT INTO users (email, name, password_hash, role)
      VALUES (${email.toLowerCase()}, ${name}, ${await hashPassword(password)}, ${role})`);
    return { id: result.insertId, password };
  } catch (err) {
    if (errorCode(err) === DUPLICATE) throw new HttpError(409, 'Ya existe un usuario con ese email.');
    throw err;
  }
}

/** Nueva contraseña temporal; cierra sus sesiones abiertas. Devuelve la contraseña. */
export async function resetPassword(userId: number): Promise<string> {
  const password = temporaryPassword();
  const result = await db.exec(sql`UPDATE users SET password_hash = ${await hashPassword(password)} WHERE id = ${userId}`);
  if (result.affectedRows === 0) throw new HttpError(404, 'Ese usuario no existe.');
  await db.exec(sql`DELETE FROM sessions WHERE user_id = ${userId}`);
  return password;
}

/** Cambia el rol de un usuario. Siempre tiene que quedar al menos un administrador. */
export async function setRole(userId: number, role: Role): Promise<void> {
  await db.transaction(async (tx: Db) => {
    const user = await tx.one<{ role: Role }>(sql`SELECT role FROM users WHERE id = ${userId} FOR UPDATE`);
    if (!user) throw new HttpError(404, 'Ese usuario no existe.');
    if (user.role === 'admin' && role !== 'admin') {
      const admins = await tx.one<{ n: number }>(sql`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' FOR UPDATE`);
      if (Number(admins?.n) <= 1) throw new HttpError(409, 'Tiene que quedar al menos un administrador.');
    }
    await tx.exec(sql`UPDATE users SET role = ${role} WHERE id = ${userId}`);
  });
}

export function parseRole(value: unknown): Role {
  if (value !== 'admin' && value !== 'user') throw new HttpError(400, 'El rol debe ser "admin" o "user".');
  return value;
}
