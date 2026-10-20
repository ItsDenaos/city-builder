import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands';
import { ZONE_CODE } from '../src/sim/data/zones';
import { tick } from '../src/sim/simulation';
import { createGame, tileIndex, type GameState } from '../src/sim/state';
import { computeRoadAccess, hasRoadAccess } from '../src/sim/systems/access';
import { computeStats, targetDemand } from '../src/sim/systems/demand';
import { updateProgress } from '../src/sim/systems/progress';
import type { SimEvent } from '../src/sim/types';
import { smallTown } from './helpers';
import { TERRAIN_WATER } from '../src/sim/types';

const newGame = (size = 32) => createGame({ width: size, height: size, flat: true, money: 1_000_000, seed: 7 });
const idx = (s: GameState, x: number, y: number) => tileIndex(s.map, x, y);
const run = (s: GameState, days: number) => {
  const events: SimEvent[] = [];
  for (let d = 0; d < days; d++) events.push(...tick(s));
  return events;
};


describe('acceso vial', () => {
  it('llega a 3 casillas de una carretera conectada con el borde', () => {
    const s = newGame();
    applyCommand(s, { type: 'buildRoad', from: { x: 0, y: 5 }, to: { x: 10, y: 5 } });
    computeRoadAccess(s);
    expect(hasRoadAccess(s, idx(s, 3, 8))).toBe(true);
    expect(hasRoadAccess(s, idx(s, 3, 9))).toBe(false);
  });

  it('una carretera aislada no da acceso', () => {
    const s = newGame();
    applyCommand(s, { type: 'buildRoad', from: { x: 5, y: 5 }, to: { x: 10, y: 5 } });
    computeRoadAccess(s);
    expect(hasRoadAccess(s, idx(s, 7, 6))).toBe(false);
  });

  it('un puente lleva el acceso al otro lado del agua', () => {
    const s = newGame();
    for (let y = 0; y < 32; y++) s.map.terrain[idx(s, 5, y)] = TERRAIN_WATER;
    applyCommand(s, { type: 'buildRoad', from: { x: 0, y: 3 }, to: { x: 9, y: 3 } });
    computeRoadAccess(s);
    expect(hasRoadAccess(s, idx(s, 8, 4))).toBe(true);
  });

  it('no cruza el agua', () => {
    const s = newGame();
    applyCommand(s, { type: 'buildRoad', from: { x: 0, y: 5 }, to: { x: 10, y: 5 } });
    for (let x = 0; x < 32; x++) s.map.terrain[idx(s, x, 6)] = TERRAIN_WATER;
    computeRoadAccess(s);
    expect(hasRoadAccess(s, idx(s, 3, 7))).toBe(false);
  });
});

describe('demanda', () => {
  it('una ciudad vacía pide viviendas e industria, pero no comercio', () => {
    const s = newGame();
    const d = targetDemand(s.stats, s.economy.taxes);
    expect(d.R).toBeGreaterThan(0);
    expect(d.I).toBeGreaterThan(0);
    expect(d.C).toBe(0);
  });

  it('el desempleo baja la demanda residencial', () => {
    const s = newGame();
    s.stats.population = 1000;
    s.stats.workforce = 500;
    s.stats.jobs = { C: 100, I: 100, services: 0 };
    expect(targetDemand(s.stats, s.economy.taxes).R).toBeLessThan(0);
  });
});

describe('crecimiento', () => {
  it('sin acceso vial no crece nada', () => {
    const s = newGame();
    applyCommand(s, { type: 'zone', rect: { x0: 5, y0: 5, x1: 10, y1: 10 }, zone: 'R', density: 'low' });
    run(s, 200);
    expect(s.map.lotLevel.some((v) => v)).toBe(false);
    expect(s.stats.population).toBe(0);
  });

  it('una ciudad pequeña crece y da empleo a sus habitantes', () => {
    const s = newGame();
    smallTown(s);
    run(s, 360 * 3);
    expect(s.stats.population).toBeGreaterThan(100);
    expect(s.stats.workers.I).toBeGreaterThan(0);
    expect(s.stats.workers.C).toBeGreaterThan(0);
    expect(s.stats.employed).toBeLessThanOrEqual(s.stats.workforce);
  });

  it('las viviendas no huyen mientras las empresas aún están contratando', () => {
    // Regresión: el paro del día castigaba la felicidad y la población oscilaba entre 0 y unas decenas
    const s = newGame(64);
    applyCommand(s, { type: 'buildRoad', from: { x: 14, y: 0 }, to: { x: 14, y: 20 } });
    applyCommand(s, { type: 'zone', rect: { x0: 11, y0: 0, x1: 13, y1: 20 }, zone: 'R', density: 'low' });
    applyCommand(s, { type: 'zone', rect: { x0: 15, y0: 0, x1: 17, y1: 8 }, zone: 'C', density: 'low' });
    applyCommand(s, { type: 'zone', rect: { x0: 15, y0: 9, x1: 17, y1: 20 }, zone: 'I', density: 'low' });
    for (let k = 0; k < 3; k++) applyCommand(s, { type: 'placeBuilding', defId: 'wind_turbine', at: { x: 18, y: 12 + k } });
    let drops = 0;
    let prev = 0;
    for (let d = 0; d < 360; d++) {
      tick(s);
      if (s.stats.population < prev / 2) drops++;
      prev = s.stats.population;
    }
    expect(drops).toBe(0);
    expect(s.stats.population).toBeGreaterThan(200);
    expect(s.stats.employed).toBe(s.stats.workforce);
  });

  it('es determinista con la misma semilla', () => {
    const a = newGame();
    const b = newGame();
    smallTown(a);
    smallTown(b);
    run(a, 400);
    run(b, 400);
    expect(a.map.lotOccupants).toEqual(b.map.lotOccupants);
  });

  it('al cortar la carretera los edificios se vacían y desaparecen', () => {
    const s = newGame();
    smallTown(s);
    run(s, 360);
    expect(s.stats.population).toBeGreaterThan(0);
    applyCommand(s, { type: 'bulldoze', rect: { x0: 10, y0: 0, x1: 10, y1: 0 } });
    run(s, 60);
    expect(s.stats.population).toBe(0);
    expect(s.map.lotLevel.some((v) => v)).toBe(false);
  });
});

describe('comandos sobre lotes construidos', () => {
  function builtLot() {
    const s = newGame();
    applyCommand(s, { type: 'zone', rect: { x0: 2, y0: 2, x1: 2, y1: 2 }, zone: 'R', density: 'low' });
    s.map.lotLevel[idx(s, 2, 2)] = 1;
    s.map.lotOccupants[idx(s, 2, 2)] = 3;
    return s;
  }

  it('demoler quita el edificio pero deja la zona', () => {
    const s = builtLot();
    expect(applyCommand(s, { type: 'bulldoze', rect: { x0: 2, y0: 2, x1: 2, y1: 2 } }).ok).toBe(true);
    expect(s.map.lotLevel[idx(s, 2, 2)]).toBe(0);
    expect(s.map.zoneType[idx(s, 2, 2)]).toBe(ZONE_CODE.R);
  });

  it('no se puede cambiar el tipo de zona ni construir carretera encima', () => {
    const s = builtLot();
    expect(applyCommand(s, { type: 'zone', rect: { x0: 2, y0: 2, x1: 2, y1: 2 }, zone: 'I', density: 'low' }).ok).toBe(false);
    expect(applyCommand(s, { type: 'buildRoad', from: { x: 0, y: 2 }, to: { x: 4, y: 2 } }).ok).toBe(false);
    expect(applyCommand(s, { type: 'dezone', rect: { x0: 2, y0: 2, x1: 2, y1: 2 } }).ok).toBe(false);
  });

  it('sí se puede subir la densidad del mismo tipo', () => {
    const s = builtLot();
    s.progress.peakPopulation = 1_000;
    expect(applyCommand(s, { type: 'zone', rect: { x0: 2, y0: 2, x1: 2, y1: 2 }, zone: 'R', density: 'medium' }).ok).toBe(true);
    expect(s.map.lotLevel[idx(s, 2, 2)]).toBe(1);
  });
});

describe('desbloqueos y consejos', () => {
  it('emite un evento al cruzar un umbral de población', () => {
    const s = newGame();
    s.stats.population = 1_200;
    const events: SimEvent[] = [];
    updateProgress(s, events);
    expect(events.map((e) => e.type === 'unlock' && e.name)).toEqual(
      expect.arrayContaining(['Residencial media', 'Comercial media', 'Industrial media']),
    );
    s.stats.population = 900; // bajar de población no vuelve a bloquear
    updateProgress(s, (events.length = 0, events));
    expect(events).toEqual([]);
    expect(s.progress.peakPopulation).toBe(1_200);
  });

  it('avisa si las zonas no tienen conexión con el exterior', () => {
    const s = newGame();
    applyCommand(s, { type: 'buildRoad', from: { x: 5, y: 5 }, to: { x: 10, y: 5 } });
    applyCommand(s, { type: 'zone', rect: { x0: 5, y0: 6, x1: 10, y1: 7 }, zone: 'R', density: 'low' });
    const advice = run(s, 30).filter((e) => e.type === 'advice');
    expect(advice).toEqual([{ type: 'advice', text: expect.stringContaining('borde del mapa') }]);
  });

  it('computeStats cuenta los empleos de los edificios de servicio', () => {
    const s = newGame();
    applyCommand(s, { type: 'placeBuilding', defId: 'police_station', at: { x: 2, y: 2 } });
    computeStats(s);
    expect(s.stats.jobs.services).toBe(15);
  });
});
