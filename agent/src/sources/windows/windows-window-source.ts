import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { WindowSample, WindowSource } from '../../core/types.ts';

const SCRIPT = fileURLToPath(new URL('./foreground.ps1', import.meta.url));
const RESTART_DELAY_MS = 5000;

/**
 * Ventana activa e inactividad en Windows, sin dependencias nativas: un proceso
 * de PowerShell consulta la API de Windows y nos manda una línea JSON por muestra.
 */
export class WindowsWindowSource implements WindowSource {
  private child: ChildProcess | null = null;
  private stopped = false;
  private intervalSeconds: number;

  constructor(intervalSeconds: number) {
    this.intervalSeconds = intervalSeconds;
  }

  start(onSample: (sample: WindowSample) => void): void {
    this.stopped = false;
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', SCRIPT,
        '-IntervalSeconds', String(this.intervalSeconds),
        '-ParentPid', String(process.pid),
      ],
      { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true },
    );
    this.child = child;

    readline.createInterface({ input: child.stdout! }).on('line', (line) => {
      try {
        const raw = JSON.parse(line.replace(/^﻿/, '')) as { app: string; title: string; chat: string; idleSeconds: number };
        onSample({ at: new Date(), app: raw.app, title: raw.title, chat: raw.chat || null, idleSeconds: raw.idleSeconds });
      } catch {
        // Línea que no es JSON (p. ej. un aviso de PowerShell): se ignora.
      }
    });

    child.on('exit', (code) => {
      if (this.stopped || this.child !== child) return;
      console.error(`[ventanas] PowerShell terminó (código ${code}); reintento en ${RESTART_DELAY_MS / 1000}s`);
      setTimeout(() => !this.stopped && this.start(onSample), RESTART_DELAY_MS);
    });
  }

  stop(): void {
    this.stopped = true;
    this.child?.kill();
    this.child = null;
  }
}
