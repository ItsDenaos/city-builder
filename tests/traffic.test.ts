import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands';
import { TRAFFIC_SMOOTHING, WORKFORCE_RATIO } from '../src/sim/config';
import { ROADS } from '../src/sim/data/roads';
import { type GameState, createGame, tileIndex } from '../src/sim/state';
import { computeRoadAccess } from '../src/sim/systems/access';
import { computeStats } from '../src/sim/systems/demand';
import { estimateBudget } from '../src/sim/systems/economy';
import { computeInfluence } from '../src/sim/systems/influence';
import { computeTraffic } from '../src/sim/systems/traffic';

const newGame = () => createGame({ width: 32, height: 32, flat: true, money: 1_000_000, seed: 7 });
const idx = (s: GameState, x: number, y: number) => tileIndex(s.map, x, y);
const traffic = (s: GameState, x: number, y: number) => s.layers.traffic[idx(s, x, y)];
/** Ejecuta el tráfico varios días para que el suavizado converja. */
const settle = (s: GameState, days = 40) => {
  computeRoadAccess(s);
  for (let d = 0; d < days; d++) computeTraffic(s);
};

function lot(s: GameState, x: number, y: number, zone: 'R' | 'C' | 'I', occupants: number, density: 'low' | 'high' = 'low', level = 1) {
  s.progress.peakPopulation = 10_000;
  applyCommand(s, { type: 'zone', rect: { x0: x, y0: y, x1: x, y1: y }, zone, density });
  s.map.lotLevel[idx(s, x, y)] = level;
  s.map.lotOccupants[idx(s, x, y)] = occupants;
}

/** Calle desde el borde (0,5) hasta (20,5), una vivienda en x=2 y una industria en x=18. */
function commuteLine(s: GameState, residents = 10) {
  applyCommand(s, { type: 'buildRoad', from: { x: 0, y: 5 }, to: { x: 20, y: 5 } });
  lot(s, 2, 6, 'R', residents);
  lot(s, 18, 6, 'I', 2);
}

describe('viajes', () => {
  it('los trabajadores van de casa al empleo más cercano', () => {
    const s = newGame();
    commuteLine(s);
    settle(s);
    expect(traffic(s, 10, 5)).toBeCloseTo(10 * WORKFORCE_RATIO, 1);
    expect(traffic(s, 0, 5)).toBe(0); // el tramo detrás de la casa no se usa
    expect(traffic(s, 20, 5)).toBe(0); // ni el que queda después del empleo
  });

  it('el tráfico se suaviza día a día', () => {
    const s = newGame();
    commuteLine(s);
    settle(s, 1);
    expect(traffic(s, 10, 5)).toBeCloseTo(10 * WORKFORCE_RATIO * TRAFFIC_SMOOTHING, 3);
  });

  it('calcula el trayecto de cada vivienda', () => {
    const s = newGame();
    commuteLine(s);
    settle(s);
    expect(s.layers.commute[idx(s, 2, 6)]).toBeCloseTo(16 + 1, 0); // 16 casillas de calle + 1 a pie
    expect(s.stats.traffic.avgCommute).toBeCloseTo(17, 0);
  });

  it('sin empleos alcanzables no hay trayecto', () => {
    const s = newGame();
    applyCommand(s, { type: 'buildRoad', from: { x: 0, y: 5 }, to: { x: 20, y: 5 } });
    lot(s, 2, 6, 'R', 10);
    settle(s);
    expect(s.layers.commute[idx(s, 2, 6)]).toBe(-1);
  });
});

describe('congestión', () => {
  /** Muchas torres residenciales al principio de la calle: 40 lotes × 120 habitantes. */
  function crowd(s: GameState) {
    for (let x = 0; x < 20; x++) {
      lot(s, x, 4, 'R', 120, 'high', 3);
      lot(s, x, 3, 'R', 120, 'high', 3);
    }
  }

  it('alarga los trayectos y marca vías saturadas', () => {
    const light = newGame();
    commuteLine(light);
    settle(light);
    const heavy = newGame();
    commuteLine(heavy);
    crowd(heavy);
    settle(heavy);
    expect(heavy.layers.commute[idx(heavy, 2, 6)]).toBeGreaterThan(light.layers.commute[idx(light, 2, 6)] * 2);
    expect(heavy.stats.traffic.congestedShare).toBeGreaterThan(0);
  });

  it('reparte el tráfico por una ruta alternativa cuando la directa se satura', () => {
    const s = newGame();
    commuteLine(s);
    // Desvío por y = 8 entre x = 4 y x = 16
    applyCommand(s, { type: 'buildRoad', from: { x: 4, y: 5 }, to: { x: 4, y: 8 } });
    applyCommand(s, { type: 'buildRoad', from: { x: 4, y: 8 }, to: { x: 16, y: 8 } });
    applyCommand(s, { type: 'buildRoad', from: { x: 16, y: 8 }, to: { x: 16, y: 5 } });
    settle(s);
    expect(traffic(s, 10, 8)).toBe(0); // con poco tráfico todos van por la directa
    crowd(s);
    settle(s);
    expect(traffic(s, 10, 8)).toBeGreaterThan(0);
  });

  it('una avenida aguanta más que una calle', () => {
    const street = newGame();
    commuteLine(street);
    crowd(street);
    settle(street);
    const avenue = newGame();
    commuteLine(avenue);
    applyCommand(avenue, { type: 'buildRoad', from: { x: 0, y: 5 }, to: { x: 20, y: 5 }, road: 'avenue' });
    crowd(avenue);
    settle(avenue);
    expect(avenue.layers.commute[idx(avenue, 2, 6)]).toBeLessThan(street.layers.commute[idx(street, 2, 6)]);
  });

  it('el tráfico intenso contamina alrededor de la vía', () => {
    const s = newGame();
    commuteLine(s);
    crowd(s);
    settle(s);
    computeStats(s);
    computeInfluence(s);
    expect(s.layers.pollution[idx(s, 10, 6)]).toBeGreaterThan(5);
    expect(s.layers.pollution[idx(s, 10, 12)]).toBe(0);
  });
});

describe('avenidas', () => {
  it('mejorar una calle cuesta la diferencia y se mantiene más cara', () => {
    const s = newGame();
    applyCommand(s, { type: 'buildRoad', from: { x: 0, y: 5 }, to: { x: 9, y: 5 } });
    const r = applyCommand(s, { type: 'buildRoad', from: { x: 0, y: 5 }, to: { x: 9, y: 5 }, road: 'avenue' });
    expect(r).toMatchObject({ ok: true, affected: 10, cost: 10 * (ROADS.avenue.cost - ROADS.street.cost) });
    expect(s.map.road[idx(s, 5, 5)]).toBe(ROADS.avenue.code);
    expect(estimateBudget(s).expenses.roads).toBeCloseTo(10 * ROADS.avenue.upkeep);
  });

  it('una calle no rebaja una avenida', () => {
    const s = newGame();
    applyCommand(s, { type: 'buildRoad', from: { x: 0, y: 5 }, to: { x: 9, y: 5 }, road: 'avenue' });
    expect(applyCommand(s, { type: 'buildRoad', from: { x: 0, y: 5 }, to: { x: 9, y: 5 } }).ok).toBe(false);
    expect(s.map.road[idx(s, 5, 5)]).toBe(ROADS.avenue.code);
  });
});
