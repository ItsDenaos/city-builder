import { describe, expect, it } from 'vitest';
import { type Command, applyCommand } from '../src/sim/commands';
import { type FromHost, SimHost, type ToHost, stateBuffers } from '../src/sim/host';
import { tick } from '../src/sim/simulation';
import { type GameState, createGame, tileIndex } from '../src/sim/state';
import { UndoHistory } from '../src/sim/undo';
import { type HostPort, SimClient, type StateUpdate } from '../src/simClient';

const newGame = () => createGame({ width: 48, height: 48, flat: true, money: 1_000_000, seed: 8 });
const town: Command[] = [
  { type: 'buildRoad', from: { x: 0, y: 10 }, to: { x: 30, y: 10 } },
  { type: 'zone', rect: { x0: 2, y0: 7, x1: 12, y1: 9 }, zone: 'R', density: 'low' },
  { type: 'zone', rect: { x0: 14, y0: 11, x1: 24, y1: 13 }, zone: 'I', density: 'low' },
  { type: 'placeBuilding', defId: 'coal_plant', at: { x: 26, y: 11 } },
];

/**
 * Worker falso: guarda los mensajes y los entrega cuando se le pide, copiándolos como haría el navegador.
 * Así se puede probar el orden de llegada (un lote de días en camino mientras el jugador da órdenes).
 */
class FakeWorker implements HostPort {
  onmessage: ((e: MessageEvent<FromHost>) => void) | null = null;
  readonly host = new SimHost();
  private inbox: ToHost[] = [];
  postMessage(msg: ToHost): void {
    this.inbox.push(structuredClone(msg));
  }
  /** Entrega los mensajes pendientes al anfitrión y sus respuestas al cliente. */
  flush(): void {
    while (this.inbox.length) {
      const out = this.host.handle(this.inbox.shift()!);
      if (out) this.onmessage?.({ data: structuredClone(out) } as MessageEvent<FromHost>);
    }
  }
}

describe('simulación en segundo plano: anfitrión', () => {
  it('la partida que corre el anfitrión acaba igual que la que corre directamente', () => {
    const direct = newGame();
    const history = new UndoHistory();
    for (const c of town) history.run(direct, c);
    for (let d = 0; d < 120; d++) tick(direct);

    const host = new SimHost();
    host.handle({ type: 'load', state: newGame(), seq: 0 });
    town.forEach((cmd, k) => host.handle({ type: 'command', seq: k + 1, cmd }));
    let events = 0;
    for (let k = 0; k < 24; k++) {
      const out = host.handle({ type: 'tick', days: 5 });
      if (out?.type === 'state') events += out.events.filter((e) => e.type === 'newMonth').length;
    }
    expect(host.state!.stats).toEqual(direct.stats);
    expect(host.state!.economy.money).toBe(direct.economy.money);
    expect(host.state!.map.lotOccupants).toEqual(direct.map.lotOccupants);
    expect(events).toBe(4); // 120 días: cuatro cierres de mes
  });

  it('deshace y rehace, y avisa de si se puede', () => {
    const host = new SimHost();
    host.handle({ type: 'load', state: newGame(), seq: 0 });
    const ack = host.handle({ type: 'command', seq: 1, cmd: town[0] });
    expect(ack).toMatchObject({ type: 'ack', ack: 1, canUndo: true });
    const undone = host.handle({ type: 'undo' });
    expect(undone).toMatchObject({ type: 'state', canUndo: false, canRedo: true, undo: { ok: true } });
    expect(host.state!.map.road.every((v) => v === 0)).toBe(true);
    const redone = host.handle({ type: 'redo' });
    expect(redone).toMatchObject({ type: 'state', redo: { ok: true } });
    expect(host.state!.map.road[tileIndex(host.state!.map, 5, 10)]).toBe(1);
  });

  it('para enviar una partida sin copiarla se transfieren los búferes de todas sus capas', () => {
    const s = newGame();
    const buffers = stateBuffers(s);
    expect(buffers).toContain(s.map.road.buffer);
    expect(buffers).toContain(s.layers.traffic.buffer);
    expect(buffers).toContain(s.layers.coverage.police.buffer);
    expect(new Set(buffers).size).toBe(buffers.length);
  });
});

describe('simulación en segundo plano: cliente', () => {
  it('una orden dada mientras viaja un lote de días no se pierde ni parpadea', () => {
    const port = new FakeWorker();
    let mirror: GameState = newGame();
    const updates: StateUpdate[] = [];
    const client = new SimClient(port, (u) => ((mirror = u.state), updates.push(u)), () => {});
    client.load(mirror);
    port.flush();

    // Se piden días y, antes de que lleguen, el jugador construye una calle (se aplica aquí al momento)
    client.tick(3);
    expect(client.inFlight).toBe(true);
    const road: Command = { type: 'buildRoad', from: { x: 0, y: 20 }, to: { x: 10, y: 20 } };
    expect(applyCommand(mirror, road).ok).toBe(true);
    client.command(road);
    const at = tileIndex(mirror.map, 5, 20);

    // Llega el lote de días, preparado antes de recibir la orden: la calle se vuelve a aplicar encima
    port.flush();
    expect(updates).toHaveLength(1);
    expect(client.inFlight).toBe(false);
    expect(mirror.map.road[at]).toBe(1);
    expect(mirror.time.tick).toBe(3);

    // El siguiente lote ya trae la calle de verdad, y la copia coincide con la partida del worker
    client.tick(2);
    port.flush();
    expect(mirror.map.road[at]).toBe(1);
    expect(mirror.map.road).toEqual(port.host.state!.map.road);
    expect(mirror.economy.money).toBe(port.host.state!.economy.money);
    expect(client.canUndo).toBe(true);
  });

  it('deshacer va al worker y su resultado llega con el estado', () => {
    const port = new FakeWorker();
    let mirror: GameState = newGame();
    const updates: StateUpdate[] = [];
    const client = new SimClient(port, (u) => ((mirror = u.state), updates.push(u)), () => {});
    client.load(mirror);
    applyCommand(mirror, town[0]);
    client.command(town[0]);
    client.undo();
    port.flush();
    expect(updates.at(-1)?.undo?.ok).toBe(true);
    expect(mirror.map.road.every((v) => v === 0)).toBe(true);
    expect(client.canRedo).toBe(true);
  });
});
