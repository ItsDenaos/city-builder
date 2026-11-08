import { type Command, applyCommand } from './sim/commands';
import type { FromHost, ToHost } from './sim/host';
import type { GameState } from './sim/state';
import type { SimEvent } from './sim/types';
import type { RedoOutcome, UndoOutcome } from './sim/undo';

/** Lo que el cliente necesita de un worker (en los tests, un falso que habla con un SimHost). */
export interface HostPort {
  postMessage(msg: ToHost): void;
  onmessage: ((e: MessageEvent<FromHost>) => void) | null;
  onerror?: ((e: unknown) => void) | null;
  terminate?(): void;
}

export interface StateUpdate {
  state: GameState;
  events: SimEvent[];
  undo?: UndoOutcome;
  redo?: RedoOutcome;
}

/**
 * Cliente de la simulación en segundo plano (fase 21), en el hilo principal. Guarda una copia de la partida
 * para dibujar y para la interfaz, y la sustituye por cada estado que llega del worker.
 * Las órdenes del jugador se aplican también aquí al momento (para que la calle aparezca al soltar el ratón)
 * y se numeran: si llega un estado que aún no las tenía, se vuelven a aplicar encima, y nada parpadea.
 */
export class SimClient {
  /** Hay un lote de días en camino: no se piden más hasta que llegue. */
  inFlight = false;
  canUndo = false;
  canRedo = false;
  private seq = 0;
  private pending: { seq: number; cmd: Command }[] = [];

  constructor(
    private port: HostPort,
    private onUpdate: (update: StateUpdate) => void,
    onFail: () => void,
  ) {
    port.onmessage = (e) => this.receive(e.data);
    port.onerror = () => onFail();
  }

  /** Partida nueva o cargada: el worker se queda con una copia. */
  load(state: GameState): void {
    this.pending = [];
    this.inFlight = false;
    this.canUndo = this.canRedo = false;
    this.port.postMessage({ type: 'load', state, seq: this.seq });
  }

  /** Orden ya aplicada aquí por la interfaz: se envía para que la aplique la partida de verdad. */
  command(cmd: Command): void {
    this.seq++;
    this.pending.push({ seq: this.seq, cmd });
    this.port.postMessage({ type: 'command', seq: this.seq, cmd });
  }

  tick(days: number): void {
    this.inFlight = true;
    this.port.postMessage({ type: 'tick', days });
  }

  undo(): void {
    this.port.postMessage({ type: 'undo' });
  }

  redo(): void {
    this.port.postMessage({ type: 'redo' });
  }

  private receive(msg: FromHost): void {
    this.canUndo = msg.canUndo;
    this.canRedo = msg.canRedo;
    this.pending = this.pending.filter((p) => p.seq > msg.ack);
    if (msg.type === 'ack') return;
    this.inFlight = false;
    // Órdenes enviadas después de que el worker preparase este estado: se vuelven a aplicar encima
    for (const p of this.pending) applyCommand(msg.state, p.cmd);
    this.onUpdate({ state: msg.state, events: msg.events, undo: msg.undo, redo: msg.redo });
  }
}

/** Crea el worker de la simulación; null si el navegador no puede (entonces todo corre en el hilo principal). */
export function createSimWorker(): HostPort | null {
  try {
    if (typeof Worker === 'undefined') return null;
    return new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' }) as unknown as HostPort;
  } catch {
    return null;
  }
}
