import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands';
import { CAR_OVERHEAD, METRO_TUNNEL_COST, METRO_TUNNEL_UPKEEP, TRAIN_DEMAND, TRANSIT_FARE, TRANSIT_MAX_SHARE } from '../src/sim/config';
import { getTopic } from '../src/sim/data/agora';
import { ACHIEVEMENTS } from '../src/sim/data/achievements';
import { getBuildingDef } from '../src/sim/data/buildings';
import { ZONE_CODE } from '../src/sim/data/zones';
import { SAVE_VERSION, deserialize, serialize } from '../src/sim/save';
import { refreshDerived, tick } from '../src/sim/simulation';
import { type GameState, TRANSIT_MODE_CODE, createGame, tileIndex } from '../src/sim/state';
import { estimateBudget } from '../src/sim/systems/economy';
import { regionalDemand, stopProblem, transitShareFor } from '../src/sim/systems/transit';
import { UndoHistory } from '../src/sim/undo';

const roundTrip = (s: GameState) => deserialize(JSON.parse(JSON.stringify(serialize(s))));
const idx = (s: GameState, x: number, y: number) => tileIndex(s.map, x, y);
/** Tráfico de la calle a mitad del corredor. */
const midRoad = (s: GameState) => s.layers.traffic[idx(s, 30, 10)];
const buildingAt = (s: GameState, x: number, y: number) => s.buildings.get(s.map.building[idx(s, x, y)])!;

/**
 * Corredor de prueba: una calle de oeste a este por y = 10, viviendas llenas en el oeste (x 2-8)
 * y comercio e industria en el este (x 50-58). Todos los vecinos trabajan a ~45 casillas por una
 * sola calle, que se satura. La central de carbón está detrás de la zona del este (las zonas y las calles
 * conducen la electricidad) y fuera del alcance de la calle, así que sus empleos no cuentan como destino.
 */
function corridor(residents = 40): GameState {
  const s = createGame({ width: 64, height: 64, flat: true, money: 1_000_000, seed: 5 });
  s.progress.peakPopulation = 100_000; // todo desbloqueado
  applyCommand(s, { type: 'buildRoad', from: { x: 0, y: 10 }, to: { x: 60, y: 10 } });
  const fill = (x0: number, x1: number, zone: 'R' | 'C' | 'I', occupants: number) => {
    for (const [y0, y1] of [[7, 9], [11, 13]]) {
      applyCommand(s, { type: 'zone', rect: { x0, y0, x1, y1 }, zone, density: 'low' });
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = idx(s, x, y);
          s.map.lotLevel[i] = 1;
          s.map.lotOccupants[i] = occupants;
        }
      }
    }
  };
  fill(2, 8, 'R', residents);
  fill(50, 53, 'C', 10);
  fill(54, 58, 'I', 10);
  applyCommand(s, { type: 'placeBuilding', defId: 'coal_plant', at: { x: 50, y: 14 } });
  refreshDerived(s);
  return s;
}

const bus = (s: GameState) => {
  applyCommand(s, { type: 'placeBuilding', defId: 'bus_stop', at: { x: 9, y: 9 } });
  applyCommand(s, { type: 'placeBuilding', defId: 'bus_stop', at: { x: 49, y: 9 } });
};
const metro = (s: GameState, tunnel = true) => {
  applyCommand(s, { type: 'placeBuilding', defId: 'metro_station', at: { x: 9, y: 11 } });
  applyCommand(s, { type: 'placeBuilding', defId: 'metro_station', at: { x: 48, y: 11 } });
  if (tunnel) applyCommand(s, { type: 'buildMetro', from: { x: 11, y: 12 }, to: { x: 47, y: 12 } });
};

describe('reparto entre coche y transporte', () => {
  it('nadie deja el coche sin transporte; sin coche, todos lo usan', () => {
    expect(transitShareFor(20, Infinity)).toBe(0);
    expect(transitShareFor(Infinity, 30)).toBe(1);
  });

  it('cuanto mejor es el transporte frente al coche, más lo usan, sin pasar del máximo', () => {
    const shares = [60, 40, 26, 10, 0].map((t) => transitShareFor(20, t));
    for (let k = 1; k < shares.length; k++) expect(shares[k]).toBeGreaterThan(shares[k - 1]);
    expect(Math.max(...shares)).toBeLessThan(TRANSIT_MAX_SHARE);
    // Con el mismo coste que el coche (más lo que cuesta tenerlo), la mitad del máximo
    expect(transitShareFor(20, 20 + CAR_OVERHEAD)).toBeCloseTo(TRANSIT_MAX_SHARE / 2);
  });
});

describe('autobús', () => {
  it('sin paradas no cambia nada: ni viajeros ni cobertura', () => {
    const s = corridor();
    expect(s.stats.transit).toMatchObject({ riders: 0, share: 0, trainStations: 0 });
    expect(s.layers.transitShare.every((v) => v === 0)).toBe(true);
    expect(s.layers.transitCoverage.every((v) => v === 0)).toBe(true);
  });

  it('saca coches de la calle, acorta el trayecto y cuenta viajeros por parada', () => {
    const car = corridor();
    const s = corridor();
    bus(s);
    refreshDerived(s);
    expect(s.stats.transit.bus).toBeGreaterThan(0);
    expect(s.stats.transit.share).toBeGreaterThan(0.1);
    expect(midRoad(s)).toBeLessThan(midRoad(car));
    expect(s.stats.traffic.avgCommute).toBeLessThan(car.stats.traffic.avgCommute);
    // La parada del oeste es la que tiene viajeros: en la del este se baja
    expect(s.layers.ridership.get(buildingAt(s, 9, 9).id)).toBeGreaterThan(0);
    expect(s.layers.ridership.get(buildingAt(s, 49, 9).id) ?? 0).toBe(0);
    expect(s.layers.transitMode[idx(s, 8, 9)]).toBe(TRANSIT_MODE_CODE.bus);
    // Las viviendas fuera del radio a pie siguen en coche
    expect(s.layers.transitShare[idx(s, 2, 13)]).toBe(0);
  });

  it('bajarse en la misma parada no es un viaje: con el empleo a pie, nadie coge el autobús', () => {
    const s = corridor();
    // Viviendas junto al comercio del este y una sola parada, que tiene empleos a pie
    applyCommand(s, { type: 'zone', rect: { x0: 46, y0: 7, x1: 47, y1: 9 }, zone: 'R', density: 'low' });
    for (let y = 7; y <= 9; y++) for (const x of [46, 47]) [s.map.lotLevel[idx(s, x, y)], s.map.lotOccupants[idx(s, x, y)]] = [1, 20];
    applyCommand(s, { type: 'placeBuilding', defId: 'bus_stop', at: { x: 49, y: 9 } });
    refreshDerived(s);
    expect(s.layers.transitCoverage[idx(s, 47, 8)]).toBeGreaterThan(0);
    expect(s.stats.transit.riders).toBe(0);
  });

  it('una parada sin calle conectada no da servicio', () => {
    const s = corridor();
    applyCommand(s, { type: 'placeBuilding', defId: 'bus_stop', at: { x: 30, y: 40 } });
    refreshDerived(s);
    expect(stopProblem(s, buildingAt(s, 30, 40))).toMatch(/calle/);
    expect(s.stats.transit.riders).toBe(0);
  });

  it('más financiación del transporte, más frecuencia y más viajeros; y cuesta más', () => {
    // Con pocos vecinos la calle no se satura: el coche compite y la espera decide
    const low = corridor(4);
    const high = corridor(4);
    bus(low);
    bus(high);
    applyCommand(low, { type: 'setFunding', dept: 'transit', value: 50 });
    applyCommand(high, { type: 'setFunding', dept: 'transit', value: 150 });
    refreshDerived(low);
    refreshDerived(high);
    expect(high.stats.transit.riders).toBeGreaterThan(low.stats.transit.riders);
    const upkeep = getBuildingDef('bus_stop')!.upkeep * 2;
    expect(estimateBudget(low).departments.transit).toBeCloseTo(upkeep * 0.5);
    expect(estimateBudget(high).departments.transit).toBeCloseTo(upkeep * 1.5);
  });
});

describe('metro', () => {
  it('sin túnel las estaciones no dan servicio', () => {
    const s = corridor();
    metro(s, false);
    refreshDerived(s);
    expect(stopProblem(s, buildingAt(s, 9, 11))).toMatch(/túnel/);
    expect(s.stats.transit.metro).toBe(0);
  });

  it('con túnel gana al autobús en un trayecto largo y no usa la calle', () => {
    const b = corridor();
    bus(b);
    refreshDerived(b);
    const m = corridor();
    metro(m);
    refreshDerived(m);
    expect(m.stats.transit.metro).toBeGreaterThan(b.stats.transit.bus);
    expect(midRoad(m)).toBeLessThan(midRoad(b));
    expect(m.layers.transitMode[idx(m, 8, 11)]).toBe(TRANSIT_MODE_CODE.metro);
  });

  it('las estaciones necesitan electricidad', () => {
    const s = corridor();
    metro(s);
    // Sin la central no hay luz en ninguna parte
    applyCommand(s, { type: 'bulldoze', rect: { x0: 50, y0: 14, x1: 53, y1: 17 } });
    refreshDerived(s);
    expect(stopProblem(s, buildingAt(s, 9, 11))).toMatch(/electricidad/);
    expect(s.stats.transit.metro).toBe(0);
  });

  it('los túneles se pagan al construirlos y cada mes, y se desbloquean con el metro', () => {
    const s = corridor();
    const money = s.economy.money;
    const r = applyCommand(s, { type: 'buildMetro', from: { x: 11, y: 20 }, to: { x: 20, y: 20 } });
    expect(r).toMatchObject({ ok: true, cost: 10 * METRO_TUNNEL_COST });
    expect(s.economy.money).toBe(money - 10 * METRO_TUNNEL_COST);
    expect(estimateBudget(s).expenses.transport).toBeCloseTo(10 * METRO_TUNNEL_UPKEEP);
    expect(applyCommand(s, { type: 'buildMetro', from: { x: 11, y: 20 }, to: { x: 20, y: 20 } }).ok).toBe(false);
    const fresh = createGame({ width: 32, height: 32, flat: true });
    expect(applyCommand(fresh, { type: 'buildMetro', from: { x: 1, y: 1 }, to: { x: 5, y: 1 } }).ok).toBe(false);
  });

  it('quitar túneles se puede deshacer', () => {
    const s = corridor();
    const h = new UndoHistory();
    h.run(s, { type: 'buildMetro', from: { x: 11, y: 20 }, to: { x: 20, y: 20 } });
    expect(h.run(s, { type: 'removeMetro', rect: { x0: 11, y0: 20, x1: 15, y1: 20 } }).ok).toBe(true);
    expect(s.map.metro.reduce((a, v) => a + v, 0)).toBe(5);
    expect(h.undo(s).ok).toBe(true);
    expect(s.map.metro.reduce((a, v) => a + v, 0)).toBe(10);
    expect(h.undo(s).ok).toBe(true);
    expect(s.map.metro.every((v) => v === 0)).toBe(true);
  });
});

describe('tren', () => {
  it('une estaciones lejanas y trae demanda regional', () => {
    const s = corridor();
    expect(regionalDemand(s, 'I')).toBe(0);
    applyCommand(s, { type: 'placeBuilding', defId: 'train_station', at: { x: 9, y: 4 } });
    applyCommand(s, { type: 'placeBuilding', defId: 'train_station', at: { x: 47, y: 4 } });
    // Las estaciones tocan la zona (que conduce la electricidad) a través de una calle corta
    applyCommand(s, { type: 'buildRoad', from: { x: 9, y: 7 }, to: { x: 9, y: 9 } });
    applyCommand(s, { type: 'buildRoad', from: { x: 49, y: 7 }, to: { x: 49, y: 9 } });
    refreshDerived(s);
    expect(s.stats.transit.trainStations).toBe(2);
    expect(s.stats.transit.train).toBeGreaterThan(0);
    expect(regionalDemand(s, 'I')).toBe(TRAIN_DEMAND.I);
    expect(regionalDemand(s, 'R')).toBe(0);
  });
});

describe('economía, vecinos y logros', () => {
  it('los billetes son ingresos y el mantenimiento va al transporte', () => {
    const s = corridor();
    bus(s);
    refreshDerived(s);
    const b = estimateBudget(s);
    expect(b.fares).toBeCloseTo(s.stats.transit.riders * TRANSIT_FARE);
    expect(b.totalIncome).toBeCloseTo(b.income.R + b.income.C + b.income.I + b.fares);
    expect(b.expenses.transport).toBeCloseTo(getBuildingDef('bus_stop')!.upkeep * 2);
  });

  it('los vecinos sin parada piden transporte público y la petición se cumple con una parada a pie', () => {
    const s = corridor();
    for (let k = 0; k < 10; k++) refreshDerived(s); // que el atasco se asiente
    const topic = getTopic('sin-transporte')!;
    const i = idx(s, 5, 9);
    expect(s.stats.population).toBeGreaterThanOrEqual(1_500);
    expect(topic.detect(s, i)).toBe(true);
    expect(topic.petition!.goal(s, i).done).toBe(false);
    bus(s);
    refreshDerived(s);
    expect(topic.petition!.goal(s, i).done).toBe(true);
    expect(topic.detect(s, i)).toBe(false);
  });

  it('el logro «Sin coche» pide un 30 % de trayectos en transporte', () => {
    const s = corridor();
    const def = ACHIEVEMENTS.find((a) => a.id === 'sin-coche')!;
    s.stats.population = 3_000;
    s.stats.transit.share = 0.29;
    expect(def.check(s)).toBe(false);
    s.stats.transit.share = 0.3;
    expect(def.check(s)).toBe(true);
  });
});

describe('guardado de la fase 16', () => {
  it('conserva los túneles y la partida cargada sigue igual que la original', () => {
    const s = corridor();
    bus(s);
    metro(s);
    applyCommand(s, { type: 'setFunding', dept: 'transit', value: 120 });
    for (let d = 0; d < 60; d++) tick(s);
    const loaded = roundTrip(s);
    expect(loaded.map.metro).toEqual(s.map.metro);
    expect(loaded.stats.transit).toEqual(s.stats.transit);
    for (let d = 0; d < 60; d++) {
      tick(s);
      tick(loaded);
    }
    expect(loaded.stats).toEqual(s.stats);
    expect(loaded.economy.money).toBe(s.economy.money);
    expect(loaded.layers.traffic).toEqual(s.layers.traffic);
  });

  it('migra una partida v4: sin túneles y con el transporte al 100 %', () => {
    const s = corridor();
    const data = JSON.parse(JSON.stringify(serialize(s)));
    data.version = 4;
    delete data.state.map.layers.metro;
    delete data.state.economy.funding.transit;
    delete data.state.stats.transit;
    const loaded = deserialize(data);
    expect(loaded.map.metro.every((v) => v === 0)).toBe(true);
    expect(loaded.economy.funding.transit).toBe(100);
    expect(loaded.stats.transit.riders).toBe(0);
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(5);
  });

  it('el historial de partidas antiguas no tiene reparto modal y no rompe nada', () => {
    const s = corridor();
    for (let d = 0; d < 31; d++) tick(s);
    expect(s.history.at(-1)?.transitShare).toBe(0);
    expect(s.map.zoneType[idx(s, 2, 7)]).toBe(ZONE_CODE.R);
  });
});
