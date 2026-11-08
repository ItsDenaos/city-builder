import { describe, expect, it } from 'vitest';
import { daylight, hourLabel, lightning, litShare } from '../src/render/ambient';
import { applyCommand } from '../src/sim/commands';
import { SEASON_WEATHER, WEATHER, type WeatherKind, seasonOf } from '../src/sim/data/weather';
import { SAVE_VERSION, deserialize, serialize } from '../src/sim/save';
import { refreshDerived, tick } from '../src/sim/simulation';
import { type GameState, createGame, tileIndex } from '../src/sim/state';
import { roadRoute } from '../src/sim/systems/paths';
import { currentWeather, updateWeather } from '../src/sim/systems/weather';
import type { SimEvent } from '../src/sim/types';
import { citizenPosition, pickCitizen } from '../src/ui/follow';

const roundTrip = (s: GameState) => deserialize(JSON.parse(JSON.stringify(serialize(s))));
const idx = (s: GameState, x: number, y: number) => tileIndex(s.map, x, y);

describe('clima', () => {
  it('cada estación tiene su tiempo: nieve solo en invierno y veranos casi sin lluvia', () => {
    expect(seasonOf(1)).toBe('winter');
    expect(seasonOf(12)).toBe('winter');
    expect(seasonOf(4)).toBe('spring');
    expect(seasonOf(7)).toBe('summer');
    expect(seasonOf(10)).toBe('autumn');
    expect(SEASON_WEATHER.summer.snow).toBeUndefined();
    expect(SEASON_WEATHER.spring.snow).toBeUndefined();
    expect(SEASON_WEATHER.winter.snow).toBeGreaterThan(0);
  });

  it('cambia cuando se acaba el tiempo actual y respeta la estación y las duraciones', () => {
    const s = createGame({ width: 16, height: 16, flat: true, seed: 3 });
    const seen = new Map<WeatherKind, number>();
    s.time.month = 7; // verano
    let changes = 0;
    for (let d = 0; d < 2_000; d++) {
      const before = s.weather.daysLeft;
      updateWeather(s, []);
      if (before <= 1) {
        changes++;
        const [min, max] = WEATHER[s.weather.kind].days;
        expect(s.weather.daysLeft).toBeGreaterThanOrEqual(min);
        expect(s.weather.daysLeft).toBeLessThanOrEqual(max);
      }
      seen.set(s.weather.kind, (seen.get(s.weather.kind) ?? 0) + 1);
    }
    expect(changes).toBeGreaterThan(200);
    expect(seen.get('snow') ?? 0).toBe(0);
    expect(seen.get('clear')!).toBeGreaterThan((seen.get('rain') ?? 0) * 5);
  });

  it('avisa al empezar una tormenta o una nevada', () => {
    const s = createGame({ width: 16, height: 16, flat: true, seed: 5 });
    s.time.month = 1;
    const events: SimEvent[] = [];
    for (let d = 0; d < 3_000; d++) updateWeather(s, events);
    const kinds = new Set(events.map((e) => (e.type === 'weather' ? e.kind : '')));
    expect(kinds.has('snow')).toBe(true);
    expect(kinds.has('storm')).toBe(true);
  });

  it('tiene su propio generador: no cambia nada del resto de la simulación', () => {
    const a = createGame({ width: 32, height: 32, flat: true, seed: 9 });
    const b = createGame({ width: 32, height: 32, flat: true, seed: 9 });
    b.weather.rng = 12345; // otro clima
    for (const s of [a, b]) {
      applyCommand(s, { type: 'buildRoad', from: { x: 0, y: 5 }, to: { x: 20, y: 5 } });
      applyCommand(s, { type: 'zone', rect: { x0: 2, y0: 2, x1: 18, y1: 4 }, zone: 'R', density: 'low' });
      applyCommand(s, { type: 'placeBuilding', defId: 'coal_plant', at: { x: 22, y: 6 } });
    }
    for (let d = 0; d < 200; d++) {
      tick(a);
      tick(b);
    }
    expect(a.weather.kind === b.weather.kind && a.weather.daysLeft === b.weather.daysLeft).toBe(false);
    expect(b.stats).toEqual(a.stats);
    expect(b.rng).toBe(a.rng);
  });

  it('la lluvia y la nieve frenan los incendios; las tormentas los prenden más', () => {
    expect(WEATHER.rain.fireRisk).toBeLessThan(1);
    expect(WEATHER.rain.fireSpread).toBeLessThan(1);
    expect(WEATHER.rain.extinguish).toBeGreaterThan(1);
    expect(WEATHER.snow.fireRisk).toBeLessThan(1);
    expect(WEATHER.storm.fireRisk).toBeGreaterThan(1);
    const s = createGame({ width: 16, height: 16, flat: true });
    s.weather.kind = 'rain';
    expect(currentWeather(s)).toBe(WEATHER.rain);
  });

  it('se guarda, y las partidas anteriores empiezan despejadas', () => {
    const s = createGame({ width: 16, height: 16, flat: true, seed: 4 });
    for (let d = 0; d < 40; d++) tick(s);
    expect(roundTrip(s).weather).toEqual(s.weather);
    const data = JSON.parse(JSON.stringify(serialize(s)));
    data.version = 8;
    delete data.state.weather;
    const old = deserialize(data);
    expect(old.weather.kind).toBe('clear');
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(9);
  });
});

describe('día y noche', () => {
  it('de noche no hay luz, a mediodía toda, y el atardecer es cálido', () => {
    expect(daylight(0).light).toBe(0);
    expect(daylight(0.5).light).toBe(1);
    expect(daylight(0.95).light).toBe(0);
    expect(daylight(0.8).warm).toBeGreaterThan(0.9);
    expect(daylight(0.5).warm).toBe(0);
    // Amanece y anochece poco a poco
    expect(daylight(0.25).light).toBeGreaterThan(0);
    expect(daylight(0.25).light).toBeLessThan(1);
  });

  it('las ventanas se encienden al anochecer y muchas se apagan de madrugada', () => {
    expect(litShare(0.5)).toBe(0);
    expect(litShare(0.92)).toBeGreaterThan(0.5);
    expect(litShare(0.12)).toBeLessThan(litShare(0.92));
  });

  it('la hora se escribe como en un reloj', () => {
    expect(hourLabel(0)).toBe('00:00');
    expect(hourLabel(0.5)).toBe('12:00');
    expect(hourLabel(21.5 / 24)).toBe('21:30');
  });

  it('solo hay relámpagos en las tormentas y sin «Reducir animaciones»', () => {
    const storm = { hour: 0.5, weather: 'storm' as const, still: false };
    const flashes = Array.from({ length: 2_000 }, (_, k) => lightning(storm, k * 0.01)).filter((v) => v > 0.5).length;
    expect(flashes).toBeGreaterThan(0);
    expect(flashes).toBeLessThan(100);
    expect(lightning({ ...storm, weather: 'rain' }, 0)).toBe(0);
    expect(lightning({ ...storm, still: true }, 0)).toBe(0);
  });
});

describe('seguir a un vecino', () => {
  /** Calle de oeste a este con viviendas al oeste y comercio al este. */
  function town(): GameState {
    const s = createGame({ width: 40, height: 20, flat: true, money: 1_000_000, seed: 2 });
    applyCommand(s, { type: 'buildRoad', from: { x: 0, y: 10 }, to: { x: 35, y: 10 } });
    applyCommand(s, { type: 'zone', rect: { x0: 2, y0: 8, x1: 4, y1: 9 }, zone: 'R', density: 'low' });
    applyCommand(s, { type: 'zone', rect: { x0: 30, y0: 8, x1: 32, y1: 9 }, zone: 'C', density: 'low' });
    for (const [x0, x1, occ] of [[2, 4, 6], [30, 32, 2]]) for (let y = 8; y <= 9; y++) for (let x = x0; x <= x1; x++) [s.map.lotLevel[idx(s, x, y)], s.map.lotOccupants[idx(s, x, y)]] = [1, occ];
    refreshDerived(s);
    return s;
  }

  it('la ruta por las calles llega al primer destino y es la más corta', () => {
    const s = town();
    const path = roadRoute(s.map, idx(s, 0, 10), (i) => i === idx(s, 30, 10));
    expect(path).not.toBeNull();
    expect(path![0]).toBe(idx(s, 0, 10));
    expect(path![path!.length - 1]).toBe(idx(s, 30, 10));
    expect(path).toHaveLength(31);
    expect(roadRoute(s.map, idx(s, 0, 10), () => false)).toBeNull();
    expect(roadRoute(s.map, idx(s, 5, 5), () => true)).toBeNull(); // no se empieza fuera de la calle
  });

  it('elige a un vecino de la vivienda seleccionada y su trabajo', () => {
    const s = town();
    const c = pickCitizen(s, { x: 3, y: 9 })!;
    expect(c.home).toBe(idx(s, 3, 9));
    expect(c.stage).toBe('work'); // sin edades en la partida, siempre en edad de trabajar
    expect(c.goal).not.toBeNull();
    expect(s.map.zoneType[c.goal!]).toBeGreaterThan(1); // comercio
    expect(c.route.length).toBeGreaterThan(20);
  });

  it('está en casa de noche, en el trabajo a mediodía y de camino por la mañana', () => {
    const s = town();
    const c = pickCitizen(s, { x: 3, y: 9 })!;
    const home = c.route[0];
    const work = c.route[c.route.length - 1];
    expect(citizenPosition(c, 0.1)).toEqual(home);
    expect(citizenPosition(c, 0.5)).toEqual(work);
    expect(citizenPosition(c, 0.95)).toEqual(home);
    const commuting = citizenPosition(c, 7.5 / 24);
    expect(commuting.x).toBeGreaterThan(home.x);
    expect(commuting.x).toBeLessThan(work.x);
  });

  it('sin vecinos no hay a quién seguir', () => {
    expect(pickCitizen(createGame({ width: 16, height: 16, flat: true }))).toBeNull();
  });
});
