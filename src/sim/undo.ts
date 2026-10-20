import { type Command, type CommandResult, applyCommand } from './commands';
import { UNDO_MAX_DAYS, UNDO_MAX_ENTRIES } from './config';
import { refreshDerived } from './simulation';
import type { BuildingInstance, GameState } from './state';

// Capas que cambian los comandos (el relieve no lo cambia ninguno)
const LAYERS = ['road', 'zoneType', 'zoneDensity', 'lotLevel', 'lotOccupants', 'building', 'powerLine', 'waterPipe', 'fire'] as const;

/** Lo que cambia la ciudad; impuestos, préstamos y velocidad no se deshacen. */
const UNDOABLE: ReadonlySet<Command['type']> = new Set([
  'buildRoad', 'zone', 'dezone', 'placeBuilding', 'buildPowerLine', 'buildPipe', 'removePipe', 'bulldoze', 'buyPlot',
]);

interface Snapshot {
  layers: ArrayLike<number>[];
  buildings: Map<number, BuildingInstance>;
  owned: number[] | null;
  plotsBought: number;
}

interface Entry {
  cmd: Command;
  cost: number;
  /** Día de juego (time.tick) en que se hizo. */
  tick: number;
  tiles: number[];
  /** Valores por capa (en el orden de LAYERS) y casilla, antes y después. */
  before: number[][];
  after: number[][];
  added: BuildingInstance[];
  removed: BuildingInstance[];
  plots: { plot: number; before: number; after: number }[];
  plotsBought: number;
}

export type UndoOutcome =
  | { ok: true; cmd: Command; refund: number; restored: number; total: number }
  | { ok: false; reason: string };

export type RedoOutcome = { ok: true; cmd: Command; result: CommandResult } | { ok: false; reason: string };

function snapshot(state: GameState): Snapshot {
  return {
    layers: LAYERS.map((k) => state.map[k].slice()),
    buildings: new Map(state.buildings),
    owned: state.land ? state.land.owned.slice() : null,
    plotsBought: state.progress.plotsBought,
  };
}

function diff(state: GameState, snap: Snapshot, cmd: Command, cost: number): Entry {
  const now = LAYERS.map((k) => state.map[k]);
  const tiles: number[] = [];
  for (let i = 0; i < state.map.width * state.map.height; i++) {
    if (now.some((layer, l) => layer[i] !== snap.layers[l][i])) tiles.push(i);
  }
  const plots: Entry['plots'] = [];
  if (state.land && snap.owned) {
    state.land.owned.forEach((v, plot) => v !== snap.owned![plot] && plots.push({ plot, before: snap.owned![plot], after: v }));
  }
  return {
    cmd,
    cost,
    tick: state.time.tick,
    tiles,
    before: snap.layers.map((layer) => tiles.map((i) => layer[i])),
    after: now.map((layer) => tiles.map((i) => layer[i])),
    added: [...state.buildings.values()].filter((b) => snap.buildings.get(b.id) !== b),
    removed: [...snap.buildings.values()].filter((b) => state.buildings.get(b.id) !== b),
    plots,
    plotsBought: state.progress.plotsBought - snap.plotsBought,
  };
}

/**
 * Deshacer y rehacer las acciones del jugador.
 * Cada acción guarda el antes y el después de las casillas que tocó. Al deshacer, cada casilla vuelve
 * a como estaba si nadie la ha cambiado desde entonces; las que la ciudad ya ha cambiado (un edificio
 * que creció en la zona recién trazada, por ejemplo) se quedan como están y se devuelve la parte
 * proporcional del coste. Solo se puede deshacer lo hecho en los últimos UNDO_MAX_DAYS días de juego:
 * así deshacer no sirve para usar un edificio gratis.
 */
export class UndoHistory {
  private undoStack: Entry[] = [];
  private redoStack: Command[] = [];

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /** Ejecuta un comando y, si cambia la ciudad, lo apunta para poder deshacerlo. */
  run(state: GameState, cmd: Command, redoing = false): CommandResult {
    if (!UNDOABLE.has(cmd.type)) return applyCommand(state, cmd);
    const snap = snapshot(state);
    const result = applyCommand(state, cmd);
    if (!result.ok) return result;
    this.undoStack.push(diff(state, snap, cmd, state.sandbox ? 0 : result.cost));
    if (this.undoStack.length > UNDO_MAX_ENTRIES) this.undoStack.shift();
    if (!redoing) this.redoStack = [];
    return result;
  }

  /** Olvida lo que ya es demasiado antiguo para deshacerse. */
  expire(state: GameState): void {
    this.undoStack = this.undoStack.filter((e) => state.time.tick - e.tick <= UNDO_MAX_DAYS);
  }

  undo(state: GameState): UndoOutcome {
    this.expire(state);
    const e = this.undoStack.pop();
    if (!e) return { ok: false, reason: `Nada que deshacer (solo se deshace lo de los últimos ${UNDO_MAX_DAYS} días)` };
    const outcome = this.revert(state, e);
    if (outcome.ok) this.redoStack.push(e.cmd);
    // Si una acción no se puede deshacer, las anteriores pueden depender de ella: se olvidan todas
    else this.clear();
    return outcome;
  }

  redo(state: GameState): RedoOutcome {
    const cmd = this.redoStack.pop();
    if (!cmd) return { ok: false, reason: 'Nada que rehacer' };
    const result = this.run(state, cmd, true);
    if (!result.ok) {
      this.redoStack = [];
      return { ok: false, reason: result.reason ?? 'No se puede rehacer' };
    }
    return { ok: true, cmd, result };
  }

  private revert(state: GameState, e: Entry): UndoOutcome {
    const { map } = state;
    const layers = LAYERS.map((k) => map[k]);
    const unchanged = e.tiles.map((i, k) => layers.every((layer, l) => layer[i] === e.after[l][k]));
    // Los edificios colocados o derribados vuelven enteros o no vuelven
    const footprintOk = (b: BuildingInstance) => {
      for (let y = b.y; y < b.y + b.h; y++) {
        for (let x = b.x; x < b.x + b.w; x++) {
          const k = e.tiles.indexOf(y * map.width + x);
          if (k >= 0 && !unchanged[k]) return false;
        }
      }
      return true;
    };
    const changed = 'La ciudad ya ha cambiado ahí: no se puede deshacer';
    if (e.added.some((b) => state.buildings.get(b.id) !== b || !footprintOk(b))) return { ok: false, reason: changed };
    if (e.removed.some((b) => state.buildings.has(b.id) || !footprintOk(b))) return { ok: false, reason: changed };
    if (state.land && e.plots.some((p) => state.land!.owned[p.plot] !== p.after)) return { ok: false, reason: changed };
    const restored = unchanged.filter(Boolean).length;
    if (e.tiles.length && !restored) return { ok: false, reason: changed };

    e.tiles.forEach((i, k) => {
      if (unchanged[k]) layers.forEach((layer, l) => (layer[i] = e.before[l][k]));
    });
    for (const b of e.added) state.buildings.delete(b.id);
    for (const b of e.removed) state.buildings.set(b.id, b);
    if (state.land) for (const p of e.plots) state.land.owned[p.plot] = p.before;
    state.progress.plotsBought -= e.plotsBought;
    const total = e.tiles.length;
    const refund = total ? Math.round((e.cost * restored) / total) : e.cost;
    if (!state.sandbox) state.economy.money += refund;
    refreshDerived(state, state.layers.traffic.slice());
    return { ok: true, cmd: e.cmd, refund, restored, total };
  }
}
