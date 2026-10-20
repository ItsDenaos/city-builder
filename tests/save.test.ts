import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands';
import { SAVE_VERSION, deserialize, serialize } from '../src/sim/save';
import { tick } from '../src/sim/simulation';
import { type GameState, createGame } from '../src/sim/state';
import { addServices, addWater, smallTown } from './helpers';

const run = (s: GameState, days: number) => {
  for (let d = 0; d < days; d++) tick(s);
};
/** Ida y vuelta por JSON, como al guardar en el navegador o en un archivo. */
const roundTrip = (s: GameState) => deserialize(JSON.parse(JSON.stringify(serialize(s))));

function town() {
  const s = createGame({ width: 32, height: 32, flat: true, money: 1_000_000, seed: 7, name: 'Villa Prueba' });
  smallTown(s);
  addWater(s);
  addServices(s);
  applyCommand(s, { type: 'takeLoan', amount: 10_000 });
  applyCommand(s, { type: 'setTaxRate', zone: 'C', rate: 11 });
  run(s, 400);
  return s;
}

describe('guardar y cargar', () => {
  it('conserva el mapa, los edificios, la economía y el tiempo', () => {
    const s = town();
    const loaded = roundTrip(s);
    expect(loaded.name).toBe('Villa Prueba');
    for (const k of ['terrain', 'road', 'zoneType', 'zoneDensity', 'lotLevel', 'lotOccupants', 'building', 'powerLine', 'waterPipe'] as const) {
      expect(loaded.map[k]).toEqual(s.map[k]);
    }
    expect([...loaded.buildings.values()]).toEqual([...s.buildings.values()]);
    expect(loaded.economy).toEqual(s.economy);
    expect(loaded.time).toEqual(s.time);
    expect(loaded.history).toEqual(s.history);
    expect(loaded.stats.population).toBe(s.stats.population);
    // Las capas derivadas se recalculan al cargar
    expect(loaded.layers.powered).toEqual(s.layers.powered);
    expect(loaded.layers.landValue).toEqual(s.layers.landValue);
  });

  it('la partida cargada sigue exactamente igual que la original', () => {
    const s = town();
    const loaded = roundTrip(s);
    run(s, 200);
    run(loaded, 200);
    expect(loaded.map.lotOccupants).toEqual(s.map.lotOccupants);
    expect(loaded.economy.money).toBe(s.economy.money);
  });

  it('no comparte objetos con la partida en juego', () => {
    const s = town();
    const data = serialize(s);
    s.economy.taxes.R = 20;
    expect(data.state.economy.taxes.R).not.toBe(20);
  });

  it('incluye un resumen para la lista de partidas', () => {
    const s = town();
    const { meta, version } = serialize(s);
    expect(version).toBe(SAVE_VERSION);
    expect(meta).toMatchObject({ name: 'Villa Prueba', population: s.stats.population, date: { year: s.time.year } });
  });

  it('rechaza archivos que no son partidas o de versiones futuras', () => {
    expect(() => deserialize({ hola: 1 })).toThrow('no es una partida');
    const data = serialize(createGame({ width: 8, height: 8, flat: true }));
    expect(() => deserialize({ ...data, version: SAVE_VERSION + 1 })).toThrow('versión más nueva');
    data.state.map.layers.road = btoa('xx');
    expect(() => deserialize(data)).toThrow('dañada');
  });
});

describe('historial', () => {
  it('guarda una muestra de estadísticas por mes', () => {
    const s = town();
    const months = Math.floor(400 / 30);
    expect(s.history).toHaveLength(months);
    const last = s.history[s.history.length - 1];
    const lastBudget = s.economy.history[s.economy.history.length - 1];
    expect(last).toMatchObject({ month: lastBudget.month, year: lastBudget.year, money: lastBudget.money });
    expect(last.population).toBeGreaterThan(0);
    expect(last.demand).toHaveProperty('R');
  });
});
