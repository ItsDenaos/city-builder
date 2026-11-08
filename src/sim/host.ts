import type { Command } from './commands';
import { tick } from './simulation';
import type { GameState } from './state';
import type { SimEvent } from './types';
import { type RedoOutcome, UndoHistory, type UndoOutcome } from './undo';

/**
 * Anfitrión de la simulación en segundo plano (fase 21). Tiene la partida de verdad: aplica las órdenes de la
 * interfaz (con su historial de deshacer), corre los días que le piden y devuelve el estado. No sabe nada de
 * workers ni de mensajes: el worker (worker.ts) solo le pasa lo que llega y envía lo que devuelve, y así los
 * tests lo prueban directamente.
 */
export type ToHost =
  /** Partida nueva o cargada; `seq` es la última orden que la interfaz ya ha enviado antes. */
  | { type: 'load'; state: GameState; seq: number }
  /** Una orden del jugador, numerada para que la interfaz sepa cuáles ya se han aplicado. */
  | { type: 'command'; seq: number; cmd: Command }
  | { type: 'tick'; days: number }
  | { type: 'undo' }
  | { type: 'redo' };

export type FromHost =
  /** Estado tras correr días o deshacer/rehacer, con los eventos y la última orden aplicada. */
  | {
      type: 'state';
      state: GameState;
      events: SimEvent[];
      ack: number;
      canUndo: boolean;
      canRedo: boolean;
      undo?: UndoOutcome;
      redo?: RedoOutcome;
    }
  /** Orden aplicada (sin estado: la interfaz ya la aplicó por su cuenta). */
  | { type: 'ack'; ack: number; canUndo: boolean; canRedo: boolean };

export class SimHost {
  state: GameState | null = null;
  private history = new UndoHistory();
  private ack = 0;

  handle(msg: ToHost): FromHost | null {
    if (msg.type === 'load') {
      this.state = msg.state;
      this.history.clear();
      this.ack = msg.seq;
      return null;
    }
    const state = this.state;
    if (!state) return null;
    switch (msg.type) {
      case 'command':
        this.history.run(state, msg.cmd);
        this.ack = msg.seq;
        return { type: 'ack', ack: this.ack, ...this.flags() };
      case 'tick': {
        const events: SimEvent[] = [];
        for (let d = 0; d < msg.days && !state.economy.bankrupt; d++) events.push(...tick(state));
        return this.snapshot(events);
      }
      // Primero se deshace o rehace y después se toma el estado (con los botones ya al día)
      case 'undo': {
        const undo = this.history.undo(state);
        return { ...this.snapshot([]), undo };
      }
      case 'redo': {
        const redo = this.history.redo(state);
        return { ...this.snapshot([]), redo };
      }
    }
  }

  private flags() {
    return { canUndo: this.history.canUndo, canRedo: this.history.canRedo };
  }

  private snapshot(events: SimEvent[]): Extract<FromHost, { type: 'state' }> {
    return { type: 'state', state: this.state!, events, ack: this.ack, ...this.flags() };
  }
}

/** Búferes de las capas de una partida, para enviarla a otro hilo sin copiarla (se transfieren). */
export function stateBuffers(state: GameState): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  const add = (v: unknown) => {
    if (ArrayBuffer.isView(v) && v.buffer instanceof ArrayBuffer) out.add(v.buffer);
  };
  for (const v of Object.values(state.map)) add(v);
  for (const v of Object.values(state.layers)) add(v);
  for (const v of Object.values(state.layers.coverage)) add(v);
  return [...out];
}
