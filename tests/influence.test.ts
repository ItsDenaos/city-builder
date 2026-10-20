import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands';
import { LAND_VALUE_BASE, WATERFRONT_BONUS } from '../src/sim/config';
import { tick } from '../src/sim/simulation';
import { type GameState, createGame, tileIndex } from '../src/sim/state';
import { computeInfluence } from '../src/sim/systems/influence';
import { computePower } from '../src/sim/systems/utilities';
import { TERRAIN_WATER } from '../src/sim/types';
import { addServices, addWater, smallTown } from './helpers';

const newGame = () => createGame({ width: 32, height: 32, flat: true, money: 1_000_000, seed: 7 });
const idx = (s: GameState, x: number, y: number) => tileIndex(s.map, x, y);
const update = (s: GameState) => {
  computePower(s);
  computeInfluence(s);
};
const run = (s: GameState, days: number) => {
  for (let d = 0; d < days; d++) tick(s);
};
const maxLevel = (s: GameState) => s.map.lotLevel.reduce((m, v) => Math.max(m, v), 0);

/** Lote residencial ocupado en (x, y). */
function home(s: GameState, x: number, y: number, occupants = 4) {
  applyCommand(s, { type: 'zone', rect: { x0: x, y0: y, x1: x, y1: y }, zone: 'R', density: 'low' });
  s.map.lotLevel[idx(s, x, y)] = 1;
  s.map.lotOccupants[idx(s, x, y)] = occupants;
}

describe('cobertura de servicios', () => {
  it('solo funciona con electricidad y llega hasta su radio', () => {
    const s = newGame();
    applyCommand(s, { type: 'placeBuilding', defId: 'police_station', at: { x: 10, y: 10 } }); // radio 14
    update(s);
    expect(s.layers.coverage.police[idx(s, 11, 11)]).toBe(0);

    applyCommand(s, { type: 'placeBuilding', defId: 'wind_turbine', at: { x: 9, y: 10 } });
    update(s);
    const police = s.layers.coverage.police;
    expect(police[idx(s, 11, 11)]).toBe(100);
    expect(police[idx(s, 17, 11)]).toBe(100); // dentro de medio radio
    expect(police[idx(s, 24, 11)]).toBeGreaterThan(0);
    expect(police[idx(s, 27, 11)]).toBe(0);
  });
});

describe('contaminación y valor del suelo', () => {
  it('la central de carbón contamina y abarata el suelo a su alrededor', () => {
    const s = newGame();
    applyCommand(s, { type: 'placeBuilding', defId: 'coal_plant', at: { x: 10, y: 10 } });
    update(s);
    const near = idx(s, 12, 15);
    const far = idx(s, 30, 30);
    expect(s.layers.pollution[near]).toBeGreaterThan(30);
    expect(s.layers.pollution[far]).toBe(0);
    expect(s.layers.landValue[near]).toBeLessThan(s.layers.landValue[far]);
    expect(s.layers.landValue[far]).toBe(LAND_VALUE_BASE);
  });

  it('la industria contamina más cuanto más nivel tiene', () => {
    const s = newGame();
    applyCommand(s, { type: 'zone', rect: { x0: 10, y0: 10, x1: 10, y1: 10 }, zone: 'I', density: 'low' });
    s.map.lotLevel[idx(s, 10, 10)] = 1;
    update(s);
    const low = s.layers.pollution[idx(s, 12, 10)];
    s.map.lotLevel[idx(s, 10, 10)] = 3;
    update(s);
    expect(s.layers.pollution[idx(s, 12, 10)]).toBeCloseTo(low * 3);
  });

  it('vivir junto al agua y cerca de parques sube el valor del suelo', () => {
    const s = newGame();
    for (let y = 0; y < 32; y++) s.map.terrain[idx(s, 0, y)] = TERRAIN_WATER;
    applyCommand(s, { type: 'placeBuilding', defId: 'park_small', at: { x: 20, y: 20 } });
    update(s);
    expect(s.layers.landValue[idx(s, 1, 5)]).toBeCloseTo(LAND_VALUE_BASE + WATERFRONT_BONUS);
    expect(s.layers.landValue[idx(s, 21, 20)]).toBeGreaterThan(LAND_VALUE_BASE);
  });
});

describe('crimen', () => {
  it('crece con la densidad y la policía lo reduce', () => {
    const s = newGame();
    for (let x = 8; x <= 12; x++) for (let y = 8; y <= 12; y++) home(s, x, y, 30);
    update(s);
    const center = idx(s, 10, 10);
    const before = s.layers.crime[center];
    expect(before).toBeGreaterThan(20);
    applyCommand(s, { type: 'placeBuilding', defId: 'police_station', at: { x: 14, y: 10 } });
    applyCommand(s, { type: 'buildPowerLine', from: { x: 13, y: 10 }, to: { x: 13, y: 10 } });
    applyCommand(s, { type: 'placeBuilding', defId: 'wind_turbine', at: { x: 16, y: 10 } });
    update(s);
    expect(s.layers.crime[center]).toBeLessThan(before);
  });
});

describe('felicidad', () => {
  it('la contaminación entristece a los vecinos y los servicios los alegran', () => {
    const s = newGame();
    home(s, 5, 5);
    home(s, 25, 25);
    applyCommand(s, { type: 'placeBuilding', defId: 'coal_plant', at: { x: 6, y: 6 } });
    update(s);
    const polluted = s.layers.happiness[idx(s, 5, 5)];
    const clean = s.layers.happiness[idx(s, 25, 25)];
    expect(polluted).toBeLessThan(clean);

    applyCommand(s, { type: 'placeBuilding', defId: 'clinic', at: { x: 26, y: 26 } });
    applyCommand(s, { type: 'placeBuilding', defId: 'wind_turbine', at: { x: 28, y: 26 } });
    update(s);
    expect(s.layers.happiness[idx(s, 25, 25)]).toBeGreaterThan(clean);
    expect(s.stats.happiness).toBeGreaterThan(0);
  });

  it('una ciudad infeliz pierde habitantes', () => {
    const s = newGame();
    smallTown(s);
    run(s, 360);
    const before = s.stats.population;
    applyCommand(s, { type: 'setTaxRate', zone: 'R', rate: 20 });
    // Coal plant pegada a las viviendas: contaminación + impuestos altos
    applyCommand(s, { type: 'placeBuilding', defId: 'coal_plant', at: { x: 3, y: 4 } });
    applyCommand(s, { type: 'placeBuilding', defId: 'coal_plant', at: { x: 3, y: 12 } });
    update(s);
    expect(s.stats.happiness).toBeLessThan(25);
    run(s, 60);
    expect(s.stats.population).toBeLessThan(before / 2);
  });
});

describe('subida de nivel', () => {
  it('con agua pero sin servicios el suelo vale poco y nada pasa del nivel 1', () => {
    const s = newGame();
    smallTown(s);
    addWater(s);
    run(s, 360 * 3);
    expect(maxLevel(s)).toBe(1);
  });

  it('con servicios el valor del suelo permite subir', () => {
    const s = newGame();
    smallTown(s);
    addWater(s);
    addServices(s);
    run(s, 360 * 3);
    expect(maxLevel(s)).toBeGreaterThanOrEqual(2);
  });
});
