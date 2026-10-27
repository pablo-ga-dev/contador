import type { ActivityKind, Assignment } from '../core/types.ts';
import type { ReviewStore } from '../storage/review-store.ts';

const TIMEOUT_MS = 10_000;

export interface WebClientInfo {
  id: number;
  name: string;
}

export interface Rule {
  kind: ActivityKind;
  key: string;
  clientId: number;
}

export interface Credentials {
  webUrl: string;
  agentCode: string;
}

/** Por qué falló una llamada a la web, para decidir si reintentar y qué decir al usuario. */
export type WebErrorKind = 'not-configured' | 'unauthorized' | 'offline' | 'rejected';

export class WebError extends Error {
  kind: WebErrorKind;

  constructor(kind: WebErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

/** Habla con la web compartida usando el código del agente guardado en Ajustes. */
export class WebClient {
  private store: ReviewStore;

  constructor(store: ReviewStore) {
    this.store = store;
  }

  /** Comprueba unas credenciales (antes de guardarlas) y devuelve el usuario al que pertenecen. */
  me(credentials?: Credentials): Promise<{ name: string; email: string }> {
    return this.request('GET', '/api/auth/me', undefined, credentials);
  }

  clients(): Promise<WebClientInfo[]> {
    return this.request('GET', '/api/clients');
  }

  createClient(name: string): Promise<WebClientInfo> {
    return this.request('POST', '/api/clients', { name });
  }

  rules(): Promise<Rule[]> {
    return this.request('GET', '/api/rules');
  }

  /** Envía un día. Lo marcado como "Personal" se queda fuera. */
  putDay(date: string, items: Assignment[]): Promise<unknown> {
    const sent = items
      .filter((i) => i.bucket !== 'personal')
      .map((i) => ({
        kind: i.kind,
        key: i.key,
        seconds: i.seconds,
        bucket: i.bucket,
        clientId: i.bucket === 'client' ? i.clientId : null,
        remember: i.bucket === 'client' && i.remember,
      }));
    return this.request('PUT', `/api/days/${date}`, { items: sent });
  }

  private async request<T>(method: string, path: string, body?: unknown, credentials?: Credentials): Promise<T> {
    const creds = credentials ?? this.savedCredentials();
    if (!creds) throw new WebError('not-configured', 'Conecta el agente con la web en Ajustes.');

    let res: Response;
    try {
      res = await fetch(`${creds.webUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${creds.agentCode}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new WebError('offline', `No se puede conectar con ${creds.webUrl}.`);
    }
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (res.status === 401) {
      throw new WebError('unauthorized', 'El código del agente no es válido. Genera otro en la web y pégalo en Ajustes.');
    }
    if (!res.ok) throw new WebError('rejected', data?.error ?? `La web respondió con un error ${res.status}.`);
    return data as T;
  }

  private savedCredentials(): Credentials | null {
    const webUrl = this.store.getSetting('webUrl');
    const agentCode = this.store.getSetting('agentCode');
    return webUrl && agentCode ? { webUrl, agentCode } : null;
  }
}
