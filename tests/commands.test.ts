import { describe, expect, it } from 'vitest';
import { applyCommand, previewCommand } from '../src/sim/commands';
import { BRIDGE_COST_MULTIPLIER, BULLDOZE_BUILDING_COST } from '../src/sim/config';
import { ROADS } from '../src/sim/data/roads';
import { ZONE_CODE } from '../src/sim/data/zones';
import { NO_BUILDING, createGame, tileIndex } from '../src/sim/state';
import { TERRAIN_WATER } from '../src/sim/types';

const ROAD_COST = ROADS.street.cost;
const newGame = (money = 100_000) => createGame({ width: 16, height: 16, flat: true, money });
const at = (s: ReturnType<typeof newGame>, x: number, y: number) => tileIndex(s.map, x, y);

describe('buildRoad', () => {
  it('construye un camino en L y cobra por casilla nueva', () => {
    const s = newGame();
    const r = applyCommand(s, { type: 'buildRoad', from: { x: 0, y: 0 }, to: { x: 4, y: 2 } });
    expect(r).toMatchObject({ ok: true, affected: 7, cost: 7 * ROAD_COST });
    expect(s.map.road[at(s, 4, 0)]).toBe(1);
    expect(s.map.road[at(s, 4, 2)]).toBe(1);
    expect(s.economy.money).toBe(100_000 - 7 * ROAD_COST);
  });

  it('no vuelve a cobrar las casillas que ya son carretera', () => {
    const s = newGame();
    applyCommand(s, { type: 'buildRoad', from: { x: 0, y: 0 }, to: { x: 3, y: 0 } });
    const r = applyCommand(s, { type: 'buildRoad', from: { x: 0, y: 0 }, to: { x: 5, y: 0 } });
    expect(r).toMatchObject({ ok: true, affected: 2 });
  });

  it('sobre agua construye un puente más caro', () => {
    const s = newGame();
    s.map.terrain[at(s, 2, 0)] = TERRAIN_WATER;
    const r = applyCommand(s, { type: 'buildRoad', from: { x: 0, y: 0 }, to: { x: 4, y: 0 } });
    expect(r).toMatchObject({ ok: true, affected: 5, cost: 4 * ROAD_COST + ROAD_COST * BRIDGE_COST_MULTIPLIER });
    expect(s.map.road[at(s, 2, 0)]).toBe(1);
  });

  it('falla sin fondos', () => {
    const s = newGame(5);
    const r = applyCommand(s, { type: 'buildRoad', from: { x: 0, y: 0 }, to: { x: 0, y: 0 } });
    expect(r).toMatchObject({ ok: false, reason: 'Fondos insuficientes', cost: ROAD_COST });
    expect(s.map.road[at(s, 0, 0)]).toBe(0);
  });

  it('elimina la zona bajo la carretera', () => {
    const s = newGame();
    applyCommand(s, { type: 'zone', rect: { x0: 0, y0: 0, x1: 3, y1: 3 }, zone: 'R', density: 'low' });
    applyCommand(s, { type: 'buildRoad', from: { x: 0, y: 1 }, to: { x: 3, y: 1 } });
    expect(s.map.zoneType[at(s, 1, 1)]).toBe(0);
    expect(s.map.zoneType[at(s, 1, 0)]).toBe(ZONE_CODE.R);
  });
});

describe('zone', () => {
  it('zonifica el rectángulo saltando carreteras', () => {
    const s = newGame();
    applyCommand(s, { type: 'buildRoad', from: { x: 0, y: 0 }, to: { x: 3, y: 0 } });
    const r = applyCommand(s, { type: 'zone', rect: { x0: 0, y0: 0, x1: 3, y1: 2 }, zone: 'C', density: 'low' });
    expect(r).toMatchObject({ ok: true, affected: 8 });
  });

  it('recorta el rectángulo a los límites del mapa', () => {
    const s = newGame();
    const r = applyCommand(s, { type: 'zone', rect: { x0: 14, y0: 14, x1: 20, y1: 20 }, zone: 'I', density: 'low' });
    expect(r).toMatchObject({ ok: true, affected: 4 });
  });

  it('respeta los desbloqueos por población', () => {
    const s = newGame();
    const r = applyCommand(s, { type: 'zone', rect: { x0: 0, y0: 0, x1: 1, y1: 1 }, zone: 'R', density: 'high' });
    expect(r.ok).toBe(false);
    s.progress.peakPopulation = 10_000;
    expect(applyCommand(s, { type: 'zone', rect: { x0: 0, y0: 0, x1: 1, y1: 1 }, zone: 'R', density: 'high' }).ok).toBe(true);
  });
});

describe('placeBuilding', () => {
  it('ocupa toda la huella y no permite solapes', () => {
    const s = newGame();
    const r = applyCommand(s, { type: 'placeBuilding', defId: 'police_station', at: { x: 2, y: 2 } });
    expect(r.ok).toBe(true);
    const id = s.map.building[at(s, 3, 3)];
    expect(id).not.toBe(NO_BUILDING);
    expect(s.buildings.get(id)).toMatchObject({ defId: 'police_station', w: 2, h: 2 });
    expect(applyCommand(s, { type: 'placeBuilding', defId: 'clinic', at: { x: 3, y: 3 } }).ok).toBe(false);
  });

  it('la bomba de agua necesita agua al lado', () => {
    const s = newGame();
    expect(applyCommand(s, { type: 'placeBuilding', defId: 'water_pump', at: { x: 5, y: 5 } }).ok).toBe(false);
    s.map.terrain[at(s, 7, 5)] = TERRAIN_WATER;
    expect(applyCommand(s, { type: 'placeBuilding', defId: 'water_pump', at: { x: 5, y: 5 } }).ok).toBe(true);
  });

  it('no se sale del mapa', () => {
    const s = newGame();
    expect(applyCommand(s, { type: 'placeBuilding', defId: 'coal_plant', at: { x: 14, y: 14 } }).ok).toBe(false);
  });
});

describe('bulldoze', () => {
  it('demoler una casilla de un edificio lo quita entero', () => {
    const s = newGame();
    applyCommand(s, { type: 'placeBuilding', defId: 'coal_plant', at: { x: 0, y: 0 } });
    const r = applyCommand(s, { type: 'bulldoze', rect: { x0: 3, y0: 3, x1: 3, y1: 3 } });
    expect(r).toMatchObject({ ok: true, cost: BULLDOZE_BUILDING_COST });
    expect(s.buildings.size).toBe(0);
    expect(s.map.building[at(s, 0, 0)]).toBe(NO_BUILDING);
  });

  it('quita carreteras y zonas', () => {
    const s = newGame();
    applyCommand(s, { type: 'zone', rect: { x0: 0, y0: 1, x1: 3, y1: 1 }, zone: 'R', density: 'low' });
    applyCommand(s, { type: 'buildRoad', from: { x: 0, y: 0 }, to: { x: 3, y: 0 } });
    applyCommand(s, { type: 'bulldoze', rect: { x0: 0, y0: 0, x1: 3, y1: 1 } });
    expect(s.map.road.some((v) => v)).toBe(false);
    expect(s.map.zoneType.some((v) => v)).toBe(false);
  });
});

describe('previewCommand', () => {
  it('no modifica el estado', () => {
    const s = newGame();
    const r = previewCommand(s, { type: 'buildRoad', from: { x: 0, y: 0 }, to: { x: 5, y: 0 } });
    expect(r).toMatchObject({ ok: true, cost: 6 * ROAD_COST });
    expect(s.map.road.some((v) => v)).toBe(false);
    expect(s.economy.money).toBe(100_000);
  });
});
