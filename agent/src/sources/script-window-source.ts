import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import type { WindowSample, WindowSource } from '../core/types.ts';

const RESTART_DELAY_MS = 5000;

/**
 * Ventana activa e inactividad sin dependencias nativas: un script del sistema
 * (PowerShell en Windows, JavaScript para macOS en Mac) consulta el sistema y nos
 * manda una línea JSON por muestra: { app, title, chat, idleSeconds }.
 */
export class ScriptWindowSource implements WindowSource {
  private child: ChildProcess | null = null;
  private stopped = false;
  private command: string;
  private args: string[];

  constructor(command: string, args: string[]) {
    this.command = command;
    this.args = args;
  }

  start(onSample: (sample: WindowSample) => void): void {
    this.stopped = false;
    const child = spawn(this.command, this.args, { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
    this.child = child;

    readline.createInterface({ input: child.stdout! }).on('line', (line) => {
      try {
        const raw = JSON.parse(line.replace(/^﻿/, '')) as { app: string; title: string; chat: string; idleSeconds: number };
        onSample({ at: new Date(), app: raw.app, title: raw.title, chat: raw.chat || null, idleSeconds: raw.idleSeconds });
      } catch {
        // Línea que no es JSON (p. ej. un aviso del sistema): se ignora.
      }
    });

    child.on('error', (err) => console.error(`[ventanas] no se pudo lanzar ${this.command}: ${err.message}`));
    child.on('exit', (code) => {
      if (this.stopped || this.child !== child) return;
      console.error(`[ventanas] ${this.command} terminó (código ${code}); reintento en ${RESTART_DELAY_MS / 1000}s`);
      setTimeout(() => !this.stopped && this.start(onSample), RESTART_DELAY_MS);
    });
  }

  stop(): void {
    this.stopped = true;
    this.child?.kill();
    this.child = null;
  }
}
