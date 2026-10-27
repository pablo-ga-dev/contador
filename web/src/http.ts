import type { Context } from 'hono';

/** Error con un mensaje apto para mostrar al usuario y su código HTTP. */
export class HttpError extends Error {
  status: 400 | 401 | 404 | 409 | 429;

  constructor(status: HttpError['status'], message: string) {
    super(message);
    this.status = status;
  }
}

/** Cuerpo JSON de la petición, o 400 si no lo es. */
export async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await c.req.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // Se trata abajo.
  }
  throw new HttpError(400, 'El cuerpo de la petición debe ser un objeto JSON.');
}

export function text(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `Falta ${field}.`);
  if (value.length > maxLength) throw new HttpError(400, `${field} es demasiado largo.`);
  return value.trim();
}
