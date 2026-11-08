import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands';
import { DISTRICT_NAME_MAX, MAX_DISTRICTS, MAX_ORDINANCES } from '../src/sim/config';
import { districtAt, neighborhoodName } from '../src/sim/data/agora';
import { getBuildingDef } from '../src/sim/data/buildings';
import { ORDINANCES } from '../src/sim/data/ordinances';
import { effectCrime, effectDemand, effectHappiness, effectIndustryPollution, effectWaterDemand } from '../src/sim/effects';
import { SAVE_VERSION, deserialize, serialize } from '../src/sim/save';
import { refreshDerived, tick } from '../src/sim/simulation';
import { type GameState, createGame, tileIndex } from '../src/sim/state';
import { districtStats } from '../src/sim/systems/districts';
import { estimateBudget } from '../src/sim/systems/economy';
import { computeInfluence } from '../src/sim/systems/influence';
import { addServices, addWater, smallTown } from './helpers';

const newGame = () => createGame({ width: 32, height: 32, flat: true, money: 1_000_000, seed: 7 });
const roundTrip = (s: GameState) => deserialize(JSON.parse(JSON.stringify(serialize(s))));
/** Ciudad con servicios y suficiente población como para desbloquear todas las ordenanzas. */
const city = () => {
  const s = newGame();
  smallTown(s);
  addWater(s);
  addServices(s);
  return s;
};

describe('presupuesto por departamento', () => {
  it('empieza al 100 % en todos los departamentos', () => {
    const s = newGame();
    expect(Object.values(s.economy.funding)).toEqual([100, 100, 100, 100, 100]);
  });

  it('valida el comando: rango, paso y departamento', () => {
    const s = newGame();
    expect(applyCommand(s, { type: 'setFunding', dept: 'police', value: 120 }).ok).toBe(true);
    expect(s.economy.funding.police).toBe(120);
    for (const value of [40, 160, 105, 99.5]) expect(applyCommand(s, { type: 'setFunding', dept: 'police', value }).ok).toBe(false);
    // @ts-expect-error departamento que no existe
    expect(applyCommand(s, { type: 'setFunding', dept: 'basura', value: 100 }).ok).toBe(false);
    expect(s.economy.funding.police).toBe(120);
  });

  it('escala el mantenimiento de los edificios del departamento y solo el suyo', () => {
    const s = city();
    const base = estimateBudget(s);
    const police = getBuildingDef('police_station')!.upkeep;
    applyCommand(s, { type: 'setFunding', dept: 'police', value: 150 });
    const high = estimateBudget(s);
    expect(high.departments.police).toBeCloseTo(police * 1.5);
    expect(high.expenses.services - base.expenses.services).toBeCloseTo(police * 0.5);
    expect(high.departments.fire).toBeCloseTo(base.departments.fire);
    applyCommand(s, { type: 'setFunding', dept: 'police', value: 50 });
    expect(estimateBudget(s).departments.police).toBeCloseTo(police * 0.5);
  });

  it('con menos financiación la cobertura es más débil y con más llega más lejos', () => {
    const s = city();
    refreshDerived(s);
    const at = (x: number, y: number) => s.layers.coverage.police[tileIndex(s.map, x, y)];
    const normal = at(6, 1);
    expect(normal).toBe(100);
    const edge = at(6, 16); // a unos 15 casillas de la comisaría: justo fuera de su radio de 14
    applyCommand(s, { type: 'setFunding', dept: 'police', value: 50 });
    computeInfluence(s);
    expect(at(6, 1)).toBe(50);
    applyCommand(s, { type: 'setFunding', dept: 'police', value: 150 });
    computeInfluence(s);
    expect(at(6, 16)).toBeGreaterThan(edge);
  });
});

describe('ordenanzas', () => {
  it('se activan y se derogan, respetando el máximo', () => {
    const s = newGame();
    s.progress.peakPopulation = 100_000;
    const ids = ORDINANCES.map((o) => o.id);
    for (const id of ids.slice(0, MAX_ORDINANCES)) expect(applyCommand(s, { type: 'toggleOrdinance', id }).ok).toBe(true);
    const over = applyCommand(s, { type: 'toggleOrdinance', id: ids[MAX_ORDINANCES] });
    expect(over.ok).toBe(false);
    expect(s.economy.ordinances).toHaveLength(MAX_ORDINANCES);
    expect(applyCommand(s, { type: 'toggleOrdinance', id: ids[0] }).ok).toBe(true);
    expect(s.economy.ordinances).not.toContain(ids[0]);
    expect(applyCommand(s, { type: 'toggleOrdinance', id: ids[MAX_ORDINANCES] }).ok).toBe(true);
  });

  it('exigen población y el id debe existir', () => {
    const s = newGame();
    expect(applyCommand(s, { type: 'toggleOrdinance', id: 'city_festivals' }).ok).toBe(false);
    expect(applyCommand(s, { type: 'toggleOrdinance', id: 'no_existe' }).ok).toBe(false);
    s.sandbox = true;
    expect(applyCommand(s, { type: 'toggleOrdinance', id: 'city_festivals' }).ok).toBe(true);
  });

  it('cuestan cada mes y no cuestan al aprobarlas', () => {
    const s = city();
    s.progress.peakPopulation = 100_000;
    const money = s.economy.money;
    const base = estimateBudget(s).totalExpenses;
    expect(applyCommand(s, { type: 'toggleOrdinance', id: 'water_saving' })).toMatchObject({ ok: true, cost: 0 });
    expect(s.economy.money).toBe(money);
    const b = estimateBudget(s);
    expect(b.expenses.ordinances).toBe(80);
    expect(b.totalExpenses - base).toBe(80);
  });

  it('aplican sus efectos a los sistemas', () => {
    const s = newGame();
    s.progress.peakPopulation = 100_000;
    expect([effectCrime(s), effectIndustryPollution(s), effectWaterDemand(s), effectHappiness(s), effectDemand(s, 'C')]).toEqual([1, 1, 1, 0, 0]);
    for (const id of ['neighborhood_watch', 'industrial_filters', 'water_saving', 'shop_incentives']) applyCommand(s, { type: 'toggleOrdinance', id });
    expect(effectCrime(s)).toBeCloseTo(0.8);
    expect(effectIndustryPollution(s)).toBeCloseTo(0.6);
    expect(effectWaterDemand(s)).toBeCloseTo(0.8);
    expect(effectHappiness(s)).toBe(-1);
    expect(effectDemand(s, 'C')).toBeCloseTo(0.05);
  });

  it('los filtros industriales bajan la contaminación y las fiestas suben la felicidad', () => {
    const s = city();
    s.progress.peakPopulation = 100_000;
    for (let d = 0; d < 300; d++) tick(s);
    const sum = (a: Float32Array) => a.reduce((x, y) => x + y, 0);
    const pollution = sum(s.layers.pollution);
    const happiness = s.stats.happiness;
    applyCommand(s, { type: 'toggleOrdinance', id: 'industrial_filters' });
    applyCommand(s, { type: 'toggleOrdinance', id: 'city_festivals' });
    computeInfluence(s);
    expect(sum(s.layers.pollution)).toBeLessThan(pollution);
    expect(s.stats.happiness).toBeGreaterThan(happiness);
  });
});

describe('distritos', () => {
  const rect = { x0: 2, y0: 2, x1: 9, y1: 9 };

  it('se crean con el nombre del barrio si no se da otro, sin repetirlo', () => {
    const s = newGame();
    const barrio = neighborhoodName(s, 5, 5);
    expect(applyCommand(s, { type: 'createDistrict', rect }).ok).toBe(true);
    expect(s.districts[0].name).toBe(barrio);
    expect(applyCommand(s, { type: 'createDistrict', rect: { x0: 10, y0: 2, x1: 12, y1: 4 } }).ok).toBe(true);
    const names = s.districts.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    expect(s.districts.map((d) => d.id)).toEqual([1, 2]);
  });

  it('valida nombre, tamaño, repetidos y máximo', () => {
    const s = newGame();
    expect(applyCommand(s, { type: 'createDistrict', rect, name: '   ' }).ok).toBe(false);
    expect(applyCommand(s, { type: 'createDistrict', rect, name: 'x'.repeat(DISTRICT_NAME_MAX + 1) }).ok).toBe(false);
    expect(applyCommand(s, { type: 'createDistrict', rect: { x0: 0, y0: 0, x1: 1, y1: 0 }, name: 'Pequeño' }).ok).toBe(false);
    expect(applyCommand(s, { type: 'createDistrict', rect: { x0: 40, y0: 40, x1: 50, y1: 50 }, name: 'Fuera' }).ok).toBe(false);
    expect(applyCommand(s, { type: 'createDistrict', rect, name: '  Centro   Viejo ' }).ok).toBe(true);
    expect(s.districts[0].name).toBe('Centro Viejo');
    expect(applyCommand(s, { type: 'createDistrict', rect, name: 'centro viejo' }).ok).toBe(false);
    for (let k = 1; k < MAX_DISTRICTS; k++) expect(applyCommand(s, { type: 'createDistrict', rect, name: `D${k}` }).ok).toBe(true);
    expect(applyCommand(s, { type: 'createDistrict', rect, name: 'Uno más' }).ok).toBe(false);
  });

  it('se renombran y se quitan', () => {
    const s = newGame();
    applyCommand(s, { type: 'createDistrict', rect, name: 'Norte' });
    applyCommand(s, { type: 'createDistrict', rect: { x0: 12, y0: 12, x1: 20, y1: 20 }, name: 'Sur' });
    expect(applyCommand(s, { type: 'renameDistrict', id: 1, name: 'Sur' }).ok).toBe(false);
    expect(applyCommand(s, { type: 'renameDistrict', id: 1, name: 'Norte' }).ok).toBe(true);
    expect(applyCommand(s, { type: 'renameDistrict', id: 1, name: 'Puerto' }).ok).toBe(true);
    expect(applyCommand(s, { type: 'renameDistrict', id: 9, name: 'Nada' }).ok).toBe(false);
    expect(applyCommand(s, { type: 'removeDistrict', id: 1 }).ok).toBe(true);
    expect(s.districts.map((d) => d.name)).toEqual(['Sur']);
    expect(applyCommand(s, { type: 'removeDistrict', id: 1 }).ok).toBe(false);
  });

  it('mandan sobre el barrio automático (el último creado si se solapan)', () => {
    const s = newGame();
    const auto = neighborhoodName(s, 5, 5);
    applyCommand(s, { type: 'createDistrict', rect, name: 'Viejo' });
    applyCommand(s, { type: 'createDistrict', rect: { x0: 4, y0: 4, x1: 6, y1: 6 }, name: 'Nuevo' });
    expect(neighborhoodName(s, 3, 3)).toBe('Viejo');
    expect(neighborhoodName(s, 5, 5)).toBe('Nuevo');
    expect(districtAt(s, 20, 20)).toBeUndefined();
    applyCommand(s, { type: 'removeDistrict', id: 1 });
    applyCommand(s, { type: 'removeDistrict', id: 2 });
    expect(neighborhoodName(s, 5, 5)).toBe(auto);
  });

  it('cuentan habitantes, empleos y felicidad de su rectángulo', () => {
    const s = city();
    for (let d = 0; d < 300; d++) tick(s);
    applyCommand(s, { type: 'createDistrict', rect: { x0: 7, y0: 0, x1: 9, y1: 20 }, name: 'Residencial' });
    applyCommand(s, { type: 'createDistrict', rect: { x0: 11, y0: 0, x1: 13, y1: 30 }, name: 'Trabajo' });
    const [res, work] = s.districts.map((d) => districtStats(s, d));
    expect(res.tiles).toBe(3 * 21);
    expect(res.population).toBeGreaterThan(0);
    expect(res.happiness).toBeGreaterThan(0);
    expect(work.workers).toBeGreaterThan(0);
    expect(work.population).toBe(0);
  });
});

describe('guardado de la fase 13', () => {
  it('conserva financiación, ordenanzas y distritos', () => {
    const s = city();
    s.progress.peakPopulation = 100_000;
    applyCommand(s, { type: 'setFunding', dept: 'fire', value: 70 });
    applyCommand(s, { type: 'toggleOrdinance', id: 'city_festivals' });
    applyCommand(s, { type: 'createDistrict', rect: { x0: 2, y0: 2, x1: 9, y1: 9 }, name: 'Centro' });
    for (let d = 0; d < 60; d++) tick(s);
    const loaded = roundTrip(s);
    expect(loaded.economy.funding).toEqual(s.economy.funding);
    expect(loaded.economy.ordinances).toEqual(['city_festivals']);
    expect(loaded.districts).toEqual(s.districts);
    expect(loaded.nextDistrictId).toBe(s.nextDistrictId);
    expect(loaded.layers.coverage.fire).toEqual(s.layers.coverage.fire);
  });

  it('una partida cargada sigue igual que la original', () => {
    const s = city();
    s.progress.peakPopulation = 100_000;
    applyCommand(s, { type: 'setFunding', dept: 'police', value: 130 });
    applyCommand(s, { type: 'toggleOrdinance', id: 'shop_incentives' });
    for (let d = 0; d < 120; d++) tick(s);
    const loaded = roundTrip(s);
    for (let d = 0; d < 120; d++) {
      tick(s);
      tick(loaded);
    }
    expect(loaded.stats).toEqual(s.stats);
    expect(loaded.economy.money).toBe(s.economy.money);
  });

  it('migra una partida v3 sin los campos nuevos', () => {
    const s = city();
    const data = JSON.parse(JSON.stringify(serialize(s)));
    data.version = 3;
    delete data.state.economy.funding;
    delete data.state.economy.ordinances;
    delete data.state.districts;
    delete data.state.nextDistrictId;
    const loaded = deserialize(data);
    expect(Object.values(loaded.economy.funding)).toEqual([100, 100, 100, 100, 100]);
    expect(loaded.economy.ordinances).toEqual([]);
    expect(loaded.districts).toEqual([]);
    expect(loaded.nextDistrictId).toBe(1);
    expect(SAVE_VERSION).toBe(4);
  });
});
