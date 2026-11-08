import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands';
import { ARRIVAL_AGES, PARTICIPATION, WORKFORCE_RATIO } from '../src/sim/config';
import { getTopic } from '../src/sim/data/agora';
import { ACHIEVEMENTS } from '../src/sim/data/achievements';
import { getBuildingDef } from '../src/sim/data/buildings';
import { getZoneDef } from '../src/sim/data/zones';
import { SAVE_VERSION, deserialize, serialize } from '../src/sim/save';
import { createScenario } from '../src/sim/scenarios';
import { refreshDerived, tick } from '../src/sim/simulation';
import { type GameState, adultsOf, createGame, newDemography, tileIndex } from '../src/sim/state';
import {
  arrivalEducation,
  incomeIndex,
  qualifiedSurplus,
  schoolShortagePenalty,
  updateDemography,
  workforceRatio,
} from '../src/sim/systems/demography';
import { estimateBudget } from '../src/sim/systems/economy';
import { growLots } from '../src/sim/systems/growth';
import type { SimEvent } from '../src/sim/types';

const roundTrip = (s: GameState) => deserialize(JSON.parse(JSON.stringify(serialize(s))));
const idx = (s: GameState, x: number, y: number) => tileIndex(s.map, x, y);
const NEW_MONTH: SimEvent[] = [{ type: 'newMonth', month: 2, year: 2000 }];
/** Cierra `n` meses sin que cambie la población (la ciudad ya está llena). */
const months = (s: GameState, n: number) => {
  for (let k = 0; k < n; k++) updateDemography(s, NEW_MONTH);
};
const sum = (s: GameState) => s.demography.children + adultsOf(s.demography) + s.demography.elderly;
const higherShare = (s: GameState) => s.demography.higher / adultsOf(s.demography);

/** Pueblo con viviendas llenas a los dos lados de una calle (x 2-8) y una central que da luz a todo. */
function town(opts: { demographics?: boolean } = {}): GameState {
  const s = createGame({ width: 64, height: 64, flat: true, money: 1_000_000, seed: 4, demographics: opts.demographics ?? true });
  s.progress.peakPopulation = 100_000;
  applyCommand(s, { type: 'buildRoad', from: { x: 0, y: 10 }, to: { x: 60, y: 10 } });
  for (const [y0, y1] of [[7, 9], [11, 13]]) {
    applyCommand(s, { type: 'zone', rect: { x0: 2, y0, x1: 8, y1 }, zone: 'R', density: 'low' });
    for (let y = y0; y <= y1; y++) for (let x = 2; x <= 8; x++) [s.map.lotLevel[idx(s, x, y)], s.map.lotOccupants[idx(s, x, y)]] = [1, 10];
  }
  applyCommand(s, { type: 'placeBuilding', defId: 'coal_plant', at: { x: 50, y: 11 } });
  refreshDerived(s);
  s.demography.lastPopulation = s.stats.population; // ya viven aquí: nadie es recién llegado
  return s;
}
const school = (s: GameState, defId = 'elementary_school', x = 12) => applyCommand(s, { type: 'placeBuilding', defId, at: { x, y: 11 } });

describe('sin educación y edades', () => {
  it('todo queda como antes: la mitad trabaja, sueldos neutros y no cambia la población', () => {
    const s = town({ demographics: false });
    expect(workforceRatio(s)).toBe(WORKFORCE_RATIO);
    expect(incomeIndex(s)).toBe(1);
    expect(schoolShortagePenalty(s)).toBe(0);
    const before = { ...s.demography };
    months(s, 24);
    expect({ ...s.demography, lastPopulation: 0 }).toEqual({ ...before, lastPopulation: 0 });
    // Sin la fase, nadie se queda sin subir de nivel por falta de estudios
    expect(qualifiedSurplus(s, 3)).toBeGreaterThan(0);
  });
});

describe('edades', () => {
  it('una ciudad nueva tiene la mezcla de llegada y trabaja la misma fracción que antes', () => {
    const s = town();
    expect(s.demography.children).toBeCloseTo(ARRIVAL_AGES.children);
    expect(adultsOf(s.demography)).toBeCloseTo(ARRIVAL_AGES.adults);
    expect(workforceRatio(s)).toBeCloseTo(ARRIVAL_AGES.adults * PARTICIPATION);
    expect(Math.abs(workforceRatio(s) - WORKFORCE_RATIO)).toBeLessThan(0.01);
    expect(incomeIndex(s)).toBeCloseTo(1);
  });

  it('una ciudad que no crece envejece, y las fracciones siguen sumando 1', () => {
    const s = town();
    months(s, 12 * 30);
    expect(sum(s)).toBeCloseTo(1, 6);
    expect(s.demography.elderly).toBeGreaterThan(ARRIVAL_AGES.elderly);
    expect(adultsOf(s.demography)).toBeLessThan(ARRIVAL_AGES.adults);
    // Menos adultos: trabaja menos gente y se recauda menos
    expect(workforceRatio(s)).toBeLessThan(WORKFORCE_RATIO);
    expect(incomeIndex(s)).toBeLessThan(1);
  });

  it('con buena sanidad los mayores viven más', () => {
    const plain = town();
    const cared = town();
    applyCommand(cared, { type: 'placeBuilding', defId: 'clinic', at: { x: 12, y: 11 } });
    refreshDerived(cared);
    months(plain, 12 * 20);
    months(cared, 12 * 20);
    expect(cared.demography.elderly).toBeGreaterThan(plain.demography.elderly);
  });

  it('si la ciudad crece, los recién llegados traen la mezcla de llegada', () => {
    const s = town();
    months(s, 12 * 30); // envejecida
    const old = s.demography.elderly;
    s.demography.lastPopulation = s.stats.population / 2; // la población se ha doblado este mes
    months(s, 1);
    expect(s.demography.elderly).toBeCloseTo((old + ARRIVAL_AGES.elderly) / 2, 1);
  });
});

describe('estudios', () => {
  it('las escuelas dan plazas; sin plazas, las familias están descontentas', () => {
    const s = town();
    expect(s.stats.education.basicRate).toBe(0);
    expect(schoolShortagePenalty(s)).toBeGreaterThan(0);
    const unhappy = s.layers.happiness[idx(s, 5, 8)];
    school(s);
    refreshDerived(s);
    expect(s.stats.education.seatsBasic).toBe(getBuildingDef('elementary_school')!.seats!.count);
    expect(s.stats.education.basicRate).toBe(1);
    expect(schoolShortagePenalty(s)).toBe(0);
    expect(s.layers.happiness[idx(s, 5, 8)]).toBeGreaterThan(unhappy);
  });

  it('la financiación de educación cambia las plazas', () => {
    const s = town();
    school(s);
    applyCommand(s, { type: 'setFunding', dept: 'education', value: 50 });
    refreshDerived(s);
    expect(s.stats.education.seatsBasic).toBe(getBuildingDef('elementary_school')!.seats!.count * 0.5);
  });

  it('los niños con plaza se hacen adultos con estudios', () => {
    const none = town();
    const schooled = town();
    school(schooled);
    school(schooled, 'high_school', 16);
    refreshDerived(schooled);
    expect(schooled.stats.education.higherRate).toBe(1);
    months(none, 12 * 15);
    months(schooled, 12 * 15);
    expect(higherShare(schooled)).toBeGreaterThan(higherShare(none) + 0.1);
    expect(schooled.demography.none).toBeLessThan(none.demography.none);
  });

  it('las familias con estudios eligen ciudades con buenas escuelas', () => {
    const s = town();
    const worst = arrivalEducation(s);
    school(s);
    school(s, 'high_school', 16);
    refreshDerived(s);
    const best = arrivalEducation(s);
    expect(best.higher).toBeGreaterThan(worst.higher);
    expect(best.none).toBeLessThan(worst.none);
    expect(best.none + best.basic + best.higher).toBeCloseTo(1);
  });

  it('con más estudios se cobra más impuesto residencial', () => {
    const s = town();
    const base = estimateBudget(s).income.R;
    const adults = adultsOf(s.demography);
    Object.assign(s.demography, { none: 0, basic: 0, higher: adults });
    expect(incomeIndex(s)).toBeGreaterThan(1.2);
    expect(estimateBudget(s).income.R).toBeGreaterThan(base * 1.2);
  });
});

describe('empleo cualificado', () => {
  /** Industria de nivel 1 llena y lista para subir: con acceso, luz, agua, educación y demanda. */
  function readyIndustry() {
    const s = town();
    applyCommand(s, { type: 'zone', rect: { x0: 30, y0: 11, x1: 30, y1: 11 }, zone: 'I', density: 'low' });
    const i = idx(s, 30, 11);
    s.map.lotLevel[i] = 1;
    s.map.lotOccupants[i] = getZoneDef('I', 'low').capacity[0];
    refreshDerived(s);
    s.layers.watered[i] = 1;
    s.layers.coverage.education[i] = 100;
    s.stats.demand.I = 1;
    s.stats.workforce = s.stats.employed; // ni contratar ni despedir
    return { s, i };
  }
  const tryLevelUp = (s: GameState, i: number) => {
    for (let d = 0; d < 1_500 && s.map.lotLevel[i] === 1; d++) growLots(s);
    return s.map.lotLevel[i];
  };

  it('sin trabajadores con estudios, la industria no sube de nivel', () => {
    const { s, i } = readyIndustry();
    Object.assign(s.stats.education, { workersBasic: 0, workersHigher: 0, jobsBasic: 0, jobsHigher: 0 });
    expect(qualifiedSurplus(s, 2)).toBe(0);
    expect(tryLevelUp(s, i)).toBe(1);
  });

  it('con trabajadores con estudios libres, sí sube', () => {
    const { s, i } = readyIndustry();
    Object.assign(s.stats.education, { workersBasic: 100, workersHigher: 0, jobsBasic: 0, jobsHigher: 0 });
    expect(tryLevelUp(s, i)).toBe(2);
  });

  it('los de estudios superiores valen para cualquier puesto', () => {
    const s = town();
    Object.assign(s.stats.education, { workersBasic: 10, workersHigher: 50, jobsBasic: 30, jobsHigher: 20 });
    expect(qualifiedSurplus(s, 3)).toBe(30);
    expect(qualifiedSurplus(s, 2)).toBe(10);
  });
});

describe('vecinos, logros y escenarios', () => {
  it('sin plazas escolares los vecinos las piden', () => {
    const s = town();
    s.stats.population = 1_000;
    const topic = getTopic('sin-plaza')!;
    expect(topic.detect(s, idx(s, 5, 8))).toBe(true);
    expect(topic.petition!.goal(s, idx(s, 5, 8)).done).toBe(false);
    school(s);
    refreshDerived(s);
    s.stats.population = 1_000;
    expect(topic.detect(s, idx(s, 5, 8))).toBe(false);
    expect(topic.petition!.goal(s, idx(s, 5, 8)).done).toBe(true);
  });

  it('el logro «Ciudad universitaria» pide un 30 % de adultos con estudios superiores', () => {
    const s = town();
    const def = ACHIEVEMENTS.find((a) => a.id === 'ciudad-universitaria')!;
    s.stats.population = 5_000;
    expect(def.check(s)).toBe(false);
    const adults = adultsOf(s.demography);
    Object.assign(s.demography, { none: adults * 0.3, basic: adults * 0.4, higher: adults * 0.3 });
    expect(def.check(s)).toBe(true);
  });

  it('los escenarios tienen educación y edades', () => {
    expect(createScenario('contrarreloj').demographics).toBe(true);
  });
});

describe('guardado de la fase 15', () => {
  it('conserva edades y estudios, y la partida cargada sigue igual', () => {
    const s = town();
    school(s);
    for (let d = 0; d < 100; d++) tick(s);
    const loaded = roundTrip(s);
    expect(loaded.demography).toEqual(s.demography);
    for (let d = 0; d < 90; d++) {
      tick(s);
      tick(loaded);
    }
    expect(loaded.demography).toEqual(s.demography);
    expect(loaded.stats).toEqual(s.stats);
  });

  it('migra una partida v6: con educación y edades y la mezcla de una ciudad nueva', () => {
    const s = town({ demographics: false });
    const data = JSON.parse(JSON.stringify(serialize(s)));
    data.version = 6;
    delete data.state.demographics;
    delete data.state.demography;
    delete data.state.stats.education;
    const loaded = deserialize(data);
    expect(loaded.demographics).toBe(true);
    expect({ ...loaded.demography, lastPopulation: 0 }).toEqual(newDemography());
    expect(Number.isFinite(loaded.stats.education.basicRate)).toBe(true);
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(7);
  });
});
