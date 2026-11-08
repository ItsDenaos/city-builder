import {
  ADULT_YEARS,
  ARRIVAL_AGES,
  ARRIVAL_EDUCATION_MAX,
  ARRIVAL_EDUCATION_MIN,
  BIRTH_RATE,
  CHILD_YEARS,
  ELDERLY_MORTALITY,
  HIGHER_AGE_SHARE,
  MORTALITY_HEALTH_EFFECT,
  PARTICIPATION,
  SCHOOL_SHORTAGE_HAPPINESS,
  WAGE,
  WORKFORCE_RATIO,
} from '../config';
import { getBuildingDef } from '../data/buildings';
import { ZONE_BY_CODE, getZoneDefByCode } from '../data/zones';
import { type Demography, type GameState, adultsOf, newDemography, tileIndex } from '../state';
import type { SimEvent } from '../types';
import { residentAverages } from './metrics';

/**
 * Educación y edades (fase 15), en la simulación agregada: la ciudad entera se reparte en niños, adultos
 * y mayores, y los adultos según sus estudios (ninguno, básicos o superiores). Cada mes nacen niños, los
 * niños se hacen adultos (con los estudios que les permitieron las plazas escolares), los adultos se jubilan,
 * los mayores mueren (menos con buena sanidad) y llegan vecinos nuevos con la mezcla de llegada (con más
 * estudios cuanto mejores son las escuelas: las familias con estudios eligen ciudad).
 * Efectos: solo trabajan los adultos; los sueldos (y el impuesto residencial) dependen de los estudios;
 * comercio e industria necesitan trabajadores con estudios para subir de nivel; y faltar plazas escolares
 * disgusta a las familias. Sin `demographics` todo queda como antes de la fase.
 */

/** Fracción de la población (sin enfermos) que trabaja. */
export function workforceRatio(state: GameState): number {
  return state.demographics ? adultsOf(state.demography) * PARTICIPATION : WORKFORCE_RATIO;
}

const wageIndexOf = (d: Demography) => d.none * WAGE.none + d.basic * WAGE.basic + d.higher * WAGE.higher + d.elderly * WAGE.elderly;
const BASE_WAGE = wageIndexOf(newDemography());

/** Sueldos y pensiones: multiplica la recaudación residencial (1 con la mezcla de una ciudad nueva). */
export function incomeIndex(state: GameState): number {
  return state.demographics ? wageIndexOf(state.demography) / BASE_WAGE : 1;
}

/** Plazas escolares en servicio (centros con electricidad); la financiación de educación las escala. */
function schoolSeats(state: GameState): { basic: number; higher: number } {
  const seats = { basic: 0, higher: 0 };
  const funding = state.economy.funding.education / 100;
  for (const b of state.buildings.values()) {
    const def = getBuildingDef(b.defId);
    if (def?.seats && state.layers.powered[tileIndex(state.map, b.x, b.y)]) seats[def.seats.level] += def.seats.count * funding;
  }
  return seats;
}

/** Plazas, niños y empleo cualificado del día (lo llama computeStats con la población activa ya calculada). */
export function computeEducation(state: GameState, population: number, workforce: number): void {
  const { map, demography: d } = state;
  const seats = schoolSeats(state);
  const children = state.demographics ? population * d.children : 0;
  const rate = (n: number, need: number) => (need > 0 ? Math.min(1, n / need) : n > 0 ? 1 : 0);
  const basicRate = rate(seats.basic, children);
  const higherRate = Math.min(basicRate, rate(seats.higher, children * HIGHER_AGE_SHARE));

  // Puestos que piden estudios: los de los lotes de nivel 2 (básicos) y 3 (superiores), y los de los servicios
  let jobsBasic = 0;
  let jobsHigher = 0;
  for (let i = 0; i < map.lotLevel.length; i++) {
    const level = map.lotLevel[i];
    const type = ZONE_BY_CODE[map.zoneType[i]];
    if (level < 2 || !type || type === 'R') continue;
    const cap = getZoneDefByCode(map.zoneType[i], map.zoneDensity[i]).capacity[level - 1];
    if (level === 2) jobsBasic += cap;
    else jobsHigher += cap;
  }
  for (const b of state.buildings.values()) jobsBasic += getBuildingDef(b.defId)?.capacity?.jobs ?? 0;

  const adults = adultsOf(d);
  state.stats.education = {
    children,
    seatsBasic: seats.basic,
    seatsHigher: seats.higher,
    basicRate,
    higherRate,
    jobsBasic,
    jobsHigher,
    // Sin la fase activa todos cuentan como cualificados: no limita nada
    workersBasic: state.demographics && adults ? (workforce * d.basic) / adults : 0,
    workersHigher: state.demographics && adults ? (workforce * d.higher) / adults : workforce,
  };
}

/**
 * Trabajadores cualificados que quedan libres para los puestos de un nivel:
 * nivel 3, con estudios superiores; nivel 2, con básicos o superiores (los superiores sirven para todo).
 */
export function qualifiedSurplus(state: GameState, level: number): number {
  const e = state.stats.education;
  if (level >= 3) return e.workersHigher - e.jobsHigher;
  return e.workersBasic + e.workersHigher - e.jobsBasic - e.jobsHigher;
}

/** Felicidad que quita a todas las viviendas la falta de plazas escolares. */
export function schoolShortagePenalty(state: GameState): number {
  return state.demographics ? (1 - state.stats.education.basicRate) * SCHOOL_SHORTAGE_HAPPINESS : 0;
}

/** Estudios con los que llegan los adultos nuevos, según las plazas escolares de la ciudad. */
export function arrivalEducation(state: GameState): { none: number; basic: number; higher: number } {
  const e = state.stats.education;
  const basic = ARRIVAL_EDUCATION_MIN.basic + (ARRIVAL_EDUCATION_MAX.basic - ARRIVAL_EDUCATION_MIN.basic) * e.basicRate;
  const higher = ARRIVAL_EDUCATION_MIN.higher + (ARRIVAL_EDUCATION_MAX.higher - ARRIVAL_EDUCATION_MIN.higher) * e.higherRate;
  return { none: 1 - basic - higher, basic, higher };
}

/** Cierre de mes: nacimientos, envejecimiento, muertes, recién llegados y estudios de quien se hace adulto. */
export function updateDemography(state: GameState, events: SimEvent[]): void {
  if (!events.some((e) => e.type === 'newMonth')) return;
  const d = state.demography;
  const population = state.stats.population;
  if (!state.demographics) {
    d.lastPopulation = population;
    return;
  }
  const e = state.stats.education;
  const month = 1 / 12;
  const adults = adultsOf(d);

  // 1. Flujos del mes, en fracciones de la población
  const born = adults * BIRTH_RATE * month;
  const grownUp = (d.children / CHILD_YEARS) * month;
  const retiredShare = adults ? month / ADULT_YEARS : 0; // fracción de cada grupo de adultos que se jubila
  const retired = adults * retiredShare;
  const health = residentAverages(state).health / 100;
  const died = d.elderly * ELDERLY_MORTALITY * (1.5 - MORTALITY_HEALTH_EFFECT * health) * month;
  // Quien se hace adulto sale con los estudios que le dieron las plazas escolares
  const higher = e.higherRate;
  const basic = Math.max(0, e.basicRate - higher);
  const next: Demography = {
    children: d.children + born - grownUp,
    elderly: d.elderly + retired - died,
    none: d.none * (1 - retiredShare) + grownUp * (1 - basic - higher),
    basic: d.basic * (1 - retiredShare) + grownUp * basic,
    higher: d.higher * (1 - retiredShare) + grownUp * higher,
    lastPopulation: population,
  };

  // 2. Las viviendas siguen llenas: los huecos los ocupan recién llegados y, si sobra gente, se va en proporción
  const arrivals = arrivalEducation(state);
  const keys = ['children', 'elderly', 'none', 'basic', 'higher'] as const;
  const arrival: Record<(typeof keys)[number], number> = {
    children: ARRIVAL_AGES.children,
    elderly: ARRIVAL_AGES.elderly,
    none: ARRIVAL_AGES.adults * arrivals.none,
    basic: ARRIVAL_AGES.adults * arrivals.basic,
    higher: ARRIVAL_AGES.adults * arrivals.higher,
  };
  const total = keys.reduce((sum, k) => sum + next[k], 0);
  const gap = Math.max(0, 1 - total);
  const scale = total > 1 ? 1 / total : 1;
  // 3. Si la ciudad ha crecido, los nuevos vecinos llegan con la mezcla de llegada
  const growth = population > d.lastPopulation && population > 0 ? (population - d.lastPopulation) / population : 0;
  for (const k of keys) {
    const settled = next[k] * scale + arrival[k] * gap;
    next[k] = settled * (1 - growth) + arrival[k] * growth;
  }
  state.demography = next;
}
