import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands';
import { PLOT_SIZE, RANKS, plotCost } from '../src/sim/data/progression';
import { landCenter, ownedPlots, ownsTile, plotAt } from '../src/sim/land';
import { deserialize, serialize } from '../src/sim/save';
import { createScenario, scenarioGoals } from '../src/sim/scenarios';
import { tick } from '../src/sim/simulation';
import { type GameState, createGame, tileIndex } from '../src/sim/state';
import { computeRoadAccess } from '../src/sim/systems/access';
import { estimateBudget } from '../src/sim/systems/economy';
import { updateProgress } from '../src/sim/systems/progress';
import type { SimEvent } from '../src/sim/types';

const month = (): SimEvent[] => [{ type: 'newMonth', month: 2, year: 2000 }];
const progressWith = (s: GameState, population: number, events: SimEvent[] = []) => {
  s.stats.population = population;
  updateProgress(s, events);
  return events;
};

describe('rangos', () => {
  it('subir de rango da la subvención y avisa de lo desbloqueado', () => {
    const s = createGame({ width: 32, height: 32, flat: true, money: 0 });
    const events = progressWith(s, 1_200);
    expect(s.progress.rank).toBe(2); // Villa
    expect(s.economy.money).toBe(RANKS[1].grant + RANKS[2].grant);
    const ups = events.filter((e) => e.type === 'rankUp');
    expect(ups).toHaveLength(2);
    expect(ups[1]).toMatchObject({ rank: 2, unlocks: expect.arrayContaining(['Residencial media']) });
  });

  it('no se pierde el rango si baja la población', () => {
    const s = createGame({ width: 32, height: 32, flat: true });
    progressWith(s, 2_500);
    progressWith(s, 100);
    expect(s.progress.rank).toBe(3);
  });
});

describe('terreno', () => {
  const landGame = (seed = 5) => createGame({ width: 128, height: 128, seed, landPlots: true, money: 1_000_000 });

  it('se empieza con 2 × 2 parcelas unidas al exterior por una autopista', () => {
    const s = landGame();
    expect(ownedPlots(s.land!)).toBe(4);
    computeRoadAccess(s);
    // Alguna casilla de carretera dentro del terreno propio está conectada con el borde
    let connected = false;
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) if (ownsTile(s, x, y) && s.layers.roadAccess[tileIndex(s.map, x, y)] === 0) connected = true;
    expect(connected).toBe(true);
  });

  it('en un mapa con un lago en el centro elige un inicio con mucha tierra', () => {
    const s = landGame(42);
    let land = 0;
    let tiles = 0;
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) if (ownsTile(s, x, y)) { tiles++; if (!s.map.terrain[tileIndex(s.map, x, y)]) land++; }
    expect(land / tiles).toBeGreaterThan(0.6);
  });

  it('no se puede construir fuera del terreno propio', () => {
    const s = landGame();
    const outside = [...Array(16).keys()].find((p) => !s.land!.owned[p])!;
    const x = (outside % 4) * PLOT_SIZE + 5;
    const y = Math.floor(outside / 4) * PLOT_SIZE + 5;
    const r = applyCommand(s, { type: 'placeBuilding', defId: 'park_small', at: { x, y } });
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('no es tuyo') });
  });

  it('se compran parcelas vecinas, cada una más cara, hasta el límite del rango', () => {
    const s = landGame();
    const owned = () => s.land!.owned.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    const neighborOf = (p: number) => [p - 1, p + 1, p - 4, p + 4].find((q) => q >= 0 && q < 16 && !s.land!.owned[q] && Math.abs((q % 4) - (p % 4)) <= 1)!;
    // Con el rango inicial (Aldea) no se puede pasar de 4 parcelas
    const target = neighborOf(owned()[0]);
    const at = { x: (target % 4) * PLOT_SIZE + 1, y: Math.floor(target / 4) * PLOT_SIZE + 1 };
    expect(applyCommand(s, { type: 'buyPlot', at }).reason).toContain('rango');
    s.progress.rank = 2; // Villa: 6 parcelas
    const money = s.economy.money;
    expect(applyCommand(s, { type: 'buyPlot', at })).toMatchObject({ ok: true, cost: plotCost(0) });
    expect(s.economy.money).toBe(money - plotCost(0));
    expect(ownsTile(s, at.x, at.y)).toBe(true);
    const next = neighborOf(target);
    const r = applyCommand(s, { type: 'buyPlot', at: { x: (next % 4) * PLOT_SIZE + 1, y: Math.floor(next / 4) * PLOT_SIZE + 1 } });
    expect(r).toMatchObject({ ok: true, cost: plotCost(1) });
    expect(s.progress.plotsBought).toBe(2);
  });

  it('una parcela que no toca las tuyas no se puede comprar', () => {
    const s = landGame();
    s.progress.rank = 6;
    const far = [...Array(16).keys()].find((p) => {
      if (s.land!.owned[p]) return false;
      const px = p % 4;
      const py = Math.floor(p / 4);
      return ![[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]].some(([x, y]) => x >= 0 && y >= 0 && x < 4 && y < 4 && s.land!.owned[y * 4 + x]);
    })!;
    const r = applyCommand(s, { type: 'buyPlot', at: { x: (far % 4) * PLOT_SIZE, y: Math.floor(far / 4) * PLOT_SIZE } });
    expect(r.reason).toContain('junto a las tuyas');
  });
});

describe('logros', () => {
  it('se consiguen al cerrar el mes y solo una vez', () => {
    const s = createGame({ width: 32, height: 32, flat: true });
    s.stats.population = 150;
    const first = progressWith(s, 150, month()).filter((e) => e.type === 'achievement');
    expect(first).toContainEqual({ type: 'achievement', id: 'primeros', name: 'Primeros vecinos' });
    const again = progressWith(s, 150, month()).filter((e) => e.type === 'achievement');
    expect(again).toEqual([]);
  });

  it('cuentan los balances positivos seguidos', () => {
    const s = createGame({ width: 32, height: 32, flat: true });
    s.economy.lastMonth = { income: { R: 0, C: 0, I: 0 }, expenses: { roads: 0, networks: 0, power: 0, water: 0, services: 0, parks: 0, loans: 0 }, totalIncome: 10, totalExpenses: 0, net: 10 };
    for (let k = 0; k < 3; k++) updateProgress(s, month());
    expect(s.progress.monthsPositive).toBe(3);
    s.economy.lastMonth.net = -1;
    updateProgress(s, month());
    expect(s.progress.monthsPositive).toBe(0);
  });
});

describe('escenarios', () => {
  it('se gana al cumplir todos los objetivos', () => {
    const s = createScenario('contrarreloj');
    expect(s.scenario).toMatchObject({ status: 'active', endYear: s.time.year + 10 });
    expect(s.land).not.toBeNull();
    expect(scenarioGoals(s)[0].progress).toBe(0);
    const events = progressWith(s, 9_000, month());
    expect(events).toContainEqual({ type: 'scenarioEnd', id: 'contrarreloj', won: true });
  });

  it('se pierde si se acaba el plazo', () => {
    const s = createScenario('tierra-de-lagos');
    s.time.year = s.scenario!.endYear;
    const events = progressWith(s, 100, month());
    expect(events).toContainEqual({ type: 'scenarioEnd', id: 'tierra-de-lagos', won: false });
  });

  it('la herencia empieza en números rojos pero tiene arreglo subiendo impuestos', () => {
    const s = createScenario('herencia');
    expect(s.economy.money).toBeLessThan(0);
    expect(s.economy.loans).toHaveLength(3);
    expect(s.stats.population).toBeGreaterThan(1_000);
    expect(estimateBudget(s).net).toBeLessThan(0);
    for (const z of ['R', 'C', 'I'] as const) applyCommand(s, { type: 'setTaxRate', zone: z, rate: 11 });
    expect(estimateBudget(s).net).toBeGreaterThan(0);
    for (let d = 0; d < 30; d++) tick(s); // la partida avanza sin errores
  }, 30_000);
});

describe('partidas guardadas', () => {
  it('se cargan partidas v1 sin rango ni logros', () => {
    const s = createGame({ width: 16, height: 16, flat: true });
    const data = serialize(s);
    data.version = 1;
    (data.state as { progress: unknown }).progress = { peakPopulation: 2_500 };
    delete (data.state as unknown as Partial<GameState>).land;
    delete (data.state as unknown as Partial<GameState>).scenario;
    const loaded = deserialize(JSON.parse(JSON.stringify(data)));
    expect(loaded.progress).toMatchObject({ peakPopulation: 2_500, rank: 3, achievements: [], plotsBought: 0 });
    expect(loaded.land).toBeNull();
  });

  it('el terreno comprado viaja en la partida guardada', () => {
    const s = createGame({ width: 64, height: 64, seed: 3, landPlots: true });
    const loaded = deserialize(JSON.parse(JSON.stringify(serialize(s))));
    expect(loaded.land).toEqual(s.land);
  });
});

describe('cámara inicial', () => {
  it('con parcelas empieza en el centro del terreno propio', () => {
    const s = createGame({ width: 128, height: 128, seed: 9, landPlots: true });
    const c = landCenter(s);
    expect(ownsTile(s, Math.floor(c.x), Math.floor(c.y))).toBe(true);
    expect(s.land!.owned[plotAt(s.land!, Math.floor(c.x), Math.floor(c.y))]).toBe(1);
    expect(landCenter(createGame({ width: 64, height: 64, flat: true }))).toEqual({ x: 32, y: 32 });
  });
});
