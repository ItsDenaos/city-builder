import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands';
import { SAVE_VERSION, deserialize, packBits, serialize, unpackBits } from '../src/sim/save';
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

  it('comprime las capas sin perder nada (PackBits)', () => {
    const cases: number[][] = [[], [5], [1, 2], [0, 0, 0], new Array(300).fill(0), new Array(129).fill(7), new Array(130).fill(7)];
    // Bytes al azar (sin rachas) y mezclas de rachas y sueltos
    let seed = 1;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % 256;
    cases.push(Array.from({ length: 1000 }, rnd));
    cases.push(Array.from({ length: 2000 }, (_, i) => (i % 97 < 60 ? 0 : rnd() % 3)));
    for (const c of cases) {
      const bytes = Uint8Array.from(c);
      const back = new Uint8Array(bytes.length);
      unpackBits(packBits(bytes), back);
      expect([...back]).toEqual(c);
    }
    expect(() => unpackBits(packBits(Uint8Array.from([1, 2, 3])), new Uint8Array(2))).toThrow('dañada');
  });

  it('las partidas guardadas ocupan mucho menos y las de antes (sin comprimir) se siguen cargando', () => {
    const s = town();
    const big = createGame({ width: 128, height: 128, flat: true, seed: 3 });
    expect(JSON.stringify(serialize(big)).length).toBeLessThan(40_000);
    // Formato v9: base64 de los bytes tal cual
    const data = serialize(s);
    const plain = (arr: ArrayBufferView) => btoa(String.fromCharCode(...new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)));
    for (const k of Object.keys(data.state.map.layers) as (keyof typeof data.state.map.layers)[]) data.state.map.layers[k] = plain(s.map[k]);
    data.state.map.traffic = plain(s.layers.traffic);
    data.version = 9;
    const loaded = deserialize(JSON.parse(JSON.stringify(data)));
    expect(loaded.map.lotOccupants).toEqual(s.map.lotOccupants);
    expect(loaded.layers.traffic).toEqual(s.layers.traffic);
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
