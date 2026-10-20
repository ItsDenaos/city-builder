import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands';
import { POWER_LINE_COST, POWER_PER_CAPACITY } from '../src/sim/config';
import { tick } from '../src/sim/simulation';
import { type GameState, createGame, tileIndex } from '../src/sim/state';
import { computePower, computeWater } from '../src/sim/systems/utilities';
import { TERRAIN_WATER } from '../src/sim/types';
import { addServices, addWater, smallTown } from './helpers';

const newGame = () => createGame({ width: 32, height: 32, flat: true, money: 1_000_000, seed: 7 });
const idx = (s: GameState, x: number, y: number) => tileIndex(s.map, x, y);
const powered = (s: GameState, x: number, y: number) => s.layers.powered[idx(s, x, y)];
const watered = (s: GameState, x: number, y: number) => s.layers.watered[idx(s, x, y)];
const run = (s: GameState, days: number) => {
  for (let d = 0; d < days; d++) tick(s);
};
const maxLevel = (s: GameState) => s.map.lotLevel.reduce((m, v) => Math.max(m, v), 0);

describe('electricidad', () => {
  it('llega por carreteras y zonas desde la central', () => {
    const s = newGame();
    applyCommand(s, { type: 'buildRoad', from: { x: 2, y: 5 }, to: { x: 20, y: 5 } });
    applyCommand(s, { type: 'placeBuilding', defId: 'wind_turbine', at: { x: 1, y: 5 } });
    applyCommand(s, { type: 'zone', rect: { x0: 15, y0: 6, x1: 15, y1: 8 }, zone: 'R', density: 'low' });
    computePower(s);
    expect(powered(s, 15, 8)).toBe(1);
    expect(powered(s, 15, 10)).toBe(0);
    expect(s.utilities.power.production).toBe(8);
  });

  it('el terreno vacío corta la red y el tendido eléctrico la une', () => {
    const s = newGame();
    applyCommand(s, { type: 'placeBuilding', defId: 'wind_turbine', at: { x: 1, y: 1 } });
    applyCommand(s, { type: 'zone', rect: { x0: 5, y0: 1, x1: 6, y1: 1 }, zone: 'R', density: 'low' });
    computePower(s);
    expect(powered(s, 5, 1)).toBe(0);
    const r = applyCommand(s, { type: 'buildPowerLine', from: { x: 2, y: 1 }, to: { x: 4, y: 1 } });
    expect(r).toMatchObject({ ok: true, cost: 3 * POWER_LINE_COST });
    computePower(s);
    expect(powered(s, 6, 1)).toBe(1);
  });

  it('el tendido cruza el agua y no se cobra donde ya hay conducción', () => {
    const s = newGame();
    s.map.terrain[idx(s, 3, 3)] = TERRAIN_WATER;
    applyCommand(s, { type: 'buildRoad', from: { x: 5, y: 3 }, to: { x: 8, y: 3 } });
    const r = applyCommand(s, { type: 'buildPowerLine', from: { x: 0, y: 3 }, to: { x: 8, y: 3 } });
    expect(r).toMatchObject({ ok: true, affected: 5 }); // x = 0..4, incluida el agua
    expect(s.map.powerLine[idx(s, 6, 3)]).toBe(0);
  });

  it('construir encima del tendido lo sustituye', () => {
    const s = newGame();
    applyCommand(s, { type: 'buildPowerLine', from: { x: 0, y: 3 }, to: { x: 5, y: 3 } });
    applyCommand(s, { type: 'buildRoad', from: { x: 2, y: 0 }, to: { x: 2, y: 6 } });
    applyCommand(s, { type: 'zone', rect: { x0: 4, y0: 3, x1: 4, y1: 3 }, zone: 'C', density: 'low' });
    expect(s.map.powerLine[idx(s, 2, 3)]).toBe(0);
    expect(s.map.powerLine[idx(s, 4, 3)]).toBe(0);
    expect(s.map.powerLine[idx(s, 3, 3)]).toBe(1);
  });

  it('si la producción no alcanza, se quedan sin luz los más lejanos', () => {
    const s = newGame();
    applyCommand(s, { type: 'buildRoad', from: { x: 1, y: 10 }, to: { x: 31, y: 10 } });
    applyCommand(s, { type: 'placeBuilding', defId: 'wind_turbine', at: { x: 0, y: 10 } }); // 8 MW
    s.progress.peakPopulation = 5_000;
    applyCommand(s, { type: 'zone', rect: { x0: 1, y0: 11, x1: 5, y1: 11 }, zone: 'R', density: 'high' });
    for (let x = 1; x <= 5; x++) s.map.lotLevel[idx(s, x, 11)] = 3; // 120 habitantes → 2,4 MW cada uno
    computePower(s);
    expect(s.utilities.power).toEqual({ production: 8, demand: expect.closeTo(5 * 120 * POWER_PER_CAPACITY, 5) });
    expect(powered(s, 1, 11)).toBe(1);
    expect(powered(s, 3, 11)).toBe(1);
    expect(powered(s, 4, 11)).toBe(0);
    expect(powered(s, 5, 11)).toBe(0);
  });
});

describe('agua', () => {
  function tower(s: GameState, withPower = true) {
    if (withPower) applyCommand(s, { type: 'placeBuilding', defId: 'wind_turbine', at: { x: 4, y: 5 } });
    applyCommand(s, { type: 'placeBuilding', defId: 'water_tower', at: { x: 5, y: 5 } });
    applyCommand(s, { type: 'buildPipe', from: { x: 6, y: 5 }, to: { x: 15, y: 5 } });
    applyCommand(s, { type: 'zone', rect: { x0: 12, y0: 7, x1: 12, y1: 8 }, zone: 'R', density: 'low' });
    s.map.lotLevel[idx(s, 12, 7)] = 1;
    s.map.lotLevel[idx(s, 12, 8)] = 1;
  }

  it('las tuberías cubren 2 casillas alrededor', () => {
    const s = newGame();
    tower(s);
    computePower(s);
    computeWater(s);
    expect(watered(s, 12, 7)).toBe(1);
    expect(watered(s, 12, 8)).toBe(0);
    expect(s.utilities.water.production).toBe(20);
  });

  it('una torre sin electricidad no da agua', () => {
    const s = newGame();
    tower(s, false);
    computePower(s);
    computeWater(s);
    expect(watered(s, 12, 7)).toBe(0);
    expect(s.utilities.water.production).toBe(0);
  });

  it('quitar tubería corta el suministro', () => {
    const s = newGame();
    tower(s);
    expect(applyCommand(s, { type: 'removePipe', rect: { x0: 6, y0: 5, x1: 6, y1: 5 } }).ok).toBe(true);
    computePower(s);
    computeWater(s);
    expect(watered(s, 12, 7)).toBe(0);
  });
});

describe('crecimiento con servicios', () => {
  it('sin electricidad las zonas no crecen', () => {
    const s = newGame();
    smallTown(s);
    applyCommand(s, { type: 'bulldoze', rect: { x0: 14, y0: 26, x1: 14, y1: 26 } }); // quita la central
    run(s, 200);
    expect(s.stats.population).toBe(0);
  });

  it('sin agua ningún edificio pasa del nivel 1', () => {
    const s = newGame();
    smallTown(s);
    run(s, 360 * 3);
    expect(s.stats.population).toBeGreaterThan(100);
    expect(maxLevel(s)).toBe(1);
  });

  it('con agua y servicios los edificios suben de nivel', () => {
    const s = newGame();
    smallTown(s);
    addWater(s);
    addServices(s);
    run(s, 360 * 3);
    expect(s.utilities.water.production).toBe(100);
    expect(maxLevel(s)).toBeGreaterThanOrEqual(2);
  });
});
