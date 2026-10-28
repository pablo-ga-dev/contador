/** Lo que el sistema dice que estás haciendo en un instante. */
export interface WindowSample {
  at: Date;
  /** Nombre del proceso, p. ej. "Code" o "chrome". Vacío si no hay ventana activa. */
  app: string;
  title: string;
  /** Chat abierto si la ventana es WhatsApp; null si no aplica o no se pudo leer. */
  chat: string | null;
  /** Segundos desde la última pulsación de teclado o movimiento de ratón. */
  idleSeconds: number;
}

/** Último dominio que nos ha comunicado la extensión del navegador. */
export interface BrowserSample {
  at: Date;
  /** null si la pestaña activa no es una web (p. ej. chrome://newtab). */
  domain: string | null;
}

/**
 * Fuente de "ventana activa + inactividad". Es la única pieza que depende del
 * sistema operativo: para migrar a Tauri/Rust o a macOS basta con otra implementación.
 */
export interface WindowSource {
  start(onSample: (sample: WindowSample) => void): void;
  stop(): void;
}

export interface BrowserSource {
  latest(): BrowserSample | null;
}

/** Cómo se agrupa el tiempo al revisarlo: por web, por chat de WhatsApp o por aplicación. */
export type ActivityKind = 'domain' | 'chat' | 'app';

/** A qué se asigna una actividad al revisar el día. "personal" nunca sale del PC. */
export type Bucket = 'client' | 'internal' | 'unassigned' | 'personal';

export interface Activity {
  kind: ActivityKind;
  key: string;
  seconds: number;
}

export interface Assignment extends Activity {
  bucket: Bucket;
  /** Solo cuando bucket es "client". */
  clientId: number | null;
  /** Guardar "esta actividad → este cliente" como regla del equipo. */
  remember: boolean;
}

/** Comentario que se escribe al confirmar el día: general (clientId null) o de un cliente. */
export interface DayNote {
  clientId: number | null;
  text: string;
}

/** Tramo continuo haciendo lo mismo, tal como se guarda en la base de datos. */
export interface Segment {
  id?: number;
  start: Date;
  end: Date;
  app: string;
  title: string;
  domain: string | null;
  chat: string | null;
}
