import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands';
import { MONUMENT_PRIDE, TOURIST_SPENDING, TRAIN_TOURIST_SHARE, VISITORS_PER_ATTRACTION } from '../src/sim/config';
import { getTopic } from '../src/sim/data/agora';
import { ACHIEVEMENTS } from '../src/sim/data/achievements';
import { MONUMENTS, getBuildingDef } from '../src/sim/data/buildings';
import { SAVE_VERSION, deserialize, serialize } from '../src/sim/save';
import { refreshDerived, tick } from '../src/sim/simulation';
import { type GameState, createGame, tileIndex } from '../src/sim/state';
import { targetDemand } from '../src/sim/systems/demand';
import { estimateBudget } from '../src/sim/systems/economy';
import { computeTourism, monumentProblem, monumentVisitors } from '../src/sim/systems/tourism';
import { computeTraffic } from '../src/sim/systems/traffic';

const roundTrip = (s: GameState) => deserialize(JSON.parse(JSON.stringify(serialize(s))));
const idx = (s: GameState, x: number, y: number) => tileIndex(s.map, x, y);
const buildingAt = (s: GameState, x: number, y: number) => s.buildings.get(s.map.building[idx(s, x, y)])!;
/** Un día de turismo sobre el estado actual (con la felicidad fijada para que la calidad no dependa del pueblo). */
const day = (s: GameState, happiness = 70) => {
  refreshDerived(s);
  s.stats.happiness = happiness;
  computeTourism(s);
};

/** Pueblo con una calle desde el borde oeste (y = 10), viviendas a los dos lados y una central que da luz. */
function town(): GameState {
  const s = createGame({ width: 64, height: 64, flat: true, money: 1_000_000, seed: 6 });
  s.progress.peakPopulation = 100_000;
  applyCommand(s, { type: 'buildRoad', from: { x: 0, y: 10 }, to: { x: 60, y: 10 } });
  for (const [y0, y1] of [[7, 9], [11, 13]]) {
    applyCommand(s, { type: 'zone', rect: { x0: 2, y0, x1: 8, y1 }, zone: 'R', density: 'low' });
    for (let y = y0; y <= y1; y++) for (let x = 2; x <= 8; x++) [s.map.lotLevel[idx(s, x, y)], s.map.lotOccupants[idx(s, x, y)]] = [1, 10];
  }
  applyCommand(s, { type: 'placeBuilding', defId: 'coal_plant', at: { x: 50, y: 11 } });
  refreshDerived(s);
  return s;
}
const museum = (s: GameState, x = 30) => applyCommand(s, { type: 'placeBuilding', defId: 'museum', at: { x, y: 11 } });

describe('monumentos', () => {
  it('son únicos: no se puede construir el mismo dos veces', () => {
    const s = town();
    expect(museum(s).ok).toBe(true);
    const again = museum(s, 36);
    expect(again.ok).toBe(false);
    expect(again.reason).toMatch(/ya tiene/);
    expect(applyCommand(s, { type: 'placeBuilding', defId: 'theater', at: { x: 36, y: 11 } }).ok).toBe(true);
  });

  it('se desbloquean con la población', () => {
    const s = createGame({ width: 64, height: 64, flat: true, money: 1_000_000 });
    expect(applyCommand(s, { type: 'placeBuilding', defId: 'museum', at: { x: 5, y: 5 } }).ok).toBe(false);
    expect(MONUMENTS.every((m) => m.unlockAtPopulation > 0)).toBe(true);
  });

  it('necesitan calle conectada y, si la consumen, electricidad', () => {
    const s = town();
    applyCommand(s, { type: 'placeBuilding', defId: 'theater', at: { x: 30, y: 40 } });
    museum(s);
    refreshDerived(s);
    expect(monumentProblem(s, buildingAt(s, 30, 40))).toMatch(/calle/);
    expect(monumentProblem(s, buildingAt(s, 30, 11))).toBeNull();
    applyCommand(s, { type: 'bulldoze', rect: { x0: 50, y0: 11, x1: 53, y1: 14 } });
    refreshDerived(s);
    expect(monumentProblem(s, buildingAt(s, 30, 11))).toMatch(/electricidad/);
  });

  it('dan orgullo de ciudad: más felicidad en todas las viviendas', () => {
    const s = town();
    const before = s.layers.happiness[idx(s, 5, 8)];
    museum(s);
    day(s);
    refreshDerived(s); // la felicidad usa los monumentos del día anterior
    expect(s.stats.tourism.monuments).toBe(1);
    expect(s.layers.happiness[idx(s, 2, 7)]).toBeGreaterThan(before);
    expect(s.layers.happiness[idx(s, 2, 7)] - before).toBeGreaterThanOrEqual(MONUMENT_PRIDE - 0.01);
  });
});

describe('turismo', () => {
  it('sin monumentos no hay turistas ni ingresos', () => {
    const s = town();
    day(s);
    expect(s.stats.tourism.visitors).toBe(0);
    expect(estimateBudget(s).tourism).toBe(0);
  });

  it('los visitantes siguen al atractivo y a la calidad de la ciudad', () => {
    const s = town();
    museum(s);
    day(s, 70);
    const t = s.stats.tourism;
    expect(t.attraction).toBe(getBuildingDef('museum')!.monument!.attraction);
    expect(t.visitors).toBeCloseTo(t.attraction * VISITORS_PER_ATTRACTION * t.quality);
    const happy = t.visitors;
    day(s, 30);
    expect(s.stats.tourism.visitors).toBeLessThan(happy);
    expect(monumentVisitors(s, buildingAt(s, 30, 11))).toBeCloseTo(s.stats.tourism.visitors);
  });

  it('gastan dinero (más con el impuesto comercial alto) y piden comercio', () => {
    const s = town();
    museum(s);
    day(s);
    const t = s.stats.tourism;
    expect(estimateBudget(s).tourism).toBeCloseTo(t.visitors * TOURIST_SPENDING);
    // Con comercios ya construidos, para que la demanda no esté en su máximo
    const stats = { ...s.stats, jobs: { ...s.stats.jobs, C: 400 } };
    const withTourists = targetDemand(stats, s.economy.taxes).C;
    const without = targetDemand({ ...stats, tourism: { ...t, visitors: 0 } }, s.economy.taxes).C;
    expect(withTourists).toBeGreaterThan(without);
    applyCommand(s, { type: 'setTaxRate', zone: 'C', rate: 12 });
    day(s);
    expect(s.stats.tourism.revenue).toBeGreaterThan(t.revenue);
  });

  it('llegan en coche por el borde del mapa y cargan la calle hasta el monumento', () => {
    const s = town();
    computeTraffic(s);
    const empty = s.layers.traffic[idx(s, 20, 10)];
    museum(s);
    day(s);
    for (let k = 0; k < 10; k++) computeTraffic(s);
    expect(s.layers.traffic[idx(s, 20, 10)]).toBeGreaterThan(empty + 1);
    // Más allá del monumento no van
    expect(s.layers.traffic[idx(s, 45, 10)]).toBeLessThan(1);
  });

  it('con estación de tren vienen más y una parte llega en tren', () => {
    const s = town();
    museum(s);
    day(s);
    const byRoad = s.stats.tourism.visitors;
    applyCommand(s, { type: 'placeBuilding', defId: 'train_station', at: { x: 40, y: 11 } });
    day(s);
    expect(s.stats.transit.trainStations).toBe(1);
    expect(s.stats.tourism.visitors).toBeGreaterThan(byRoad);
    expect(s.stats.tourism.byTrain).toBeCloseTo(s.stats.tourism.visitors * TRAIN_TOURIST_SHARE);
  });
});

describe('vecinos y logros', () => {
  it('los vecinos cerca de un monumento presumen de él', () => {
    const s = town();
    museum(s, 12);
    day(s);
    const topic = getTopic('monumento')!;
    s.layers.happiness[idx(s, 8, 9)] = 70;
    s.layers.happiness[idx(s, 2, 7)] = 70;
    expect(topic.detect(s, idx(s, 8, 9))).toBe(true);
    s.buildings.clear();
    expect(topic.detect(s, idx(s, 8, 9))).toBe(false);
  });

  it('«Destino turístico» pide 1.000 visitantes y «Patrimonio», todos los monumentos', () => {
    const s = town();
    const tourist = ACHIEVEMENTS.find((a) => a.id === 'destino-turistico')!;
    const heritage = ACHIEVEMENTS.find((a) => a.id === 'patrimonio')!;
    s.stats.tourism = { ...s.stats.tourism, visitors: 999 };
    expect(tourist.check(s)).toBe(false);
    s.stats.tourism = { ...s.stats.tourism, visitors: 1_000 };
    expect(tourist.check(s)).toBe(true);
    expect(heritage.check(s)).toBe(false);
    MONUMENTS.forEach((m, k) => applyCommand(s, { type: 'placeBuilding', defId: m.id, at: { x: 12 + k * 6, y: 20 } }));
    expect(heritage.check(s)).toBe(true);
  });
});

describe('guardado de la fase 19', () => {
  it('la partida cargada sigue igual que la original', () => {
    const s = town();
    museum(s);
    for (let d = 0; d < 60; d++) tick(s);
    const loaded = roundTrip(s);
    expect(loaded.stats.tourism).toEqual(s.stats.tourism);
    for (let d = 0; d < 60; d++) {
      tick(s);
      tick(loaded);
    }
    expect(loaded.stats).toEqual(s.stats);
    expect(loaded.economy.money).toBe(s.economy.money);
  });

  it('migra una partida v7 sin estadísticas de turismo', () => {
    const s = town();
    const data = JSON.parse(JSON.stringify(serialize(s)));
    data.version = 7;
    delete data.state.stats.tourism;
    const loaded = deserialize(data);
    expect(loaded.stats.tourism.visitors).toBe(0);
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(8);
  });
});
