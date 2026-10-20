import {
  BASE_INDUSTRIAL_DEMAND,
  BASE_RESIDENTIAL_JOBS,
  COMMERCE_PER_RESIDENT,
  DEMAND_SCALE,
  DEMAND_SMOOTHING,
  HAPPINESS_BASE,
  HAPPINESS_DEMAND_EFFECT,
  INDUSTRY_PER_RESIDENT,
  TAX_DEMAND_EFFECT,
  TAX_HIGH,
  TAX_HIGH_EFFECT,
  TAX_NEUTRAL,
  WORKFORCE_RATIO,
} from '../config';
import { getBuildingDef } from '../data/buildings';
import { ZONE_BY_CODE, getZoneDefByCode } from '../data/zones';
import { effectDemand } from '../effects';
import type { CityStats, GameState } from '../state';
import type { ZoneType } from '../types';

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

/** Recuenta población, empleos y trabajadores a partir del mapa. */
export function computeStats(state: GameState): void {
  const { map, stats } = state;
  let population = 0;
  const jobs = { C: 0, I: 0, services: 0 };
  const workers = { C: 0, I: 0, services: 0 };

  for (let i = 0; i < map.lotLevel.length; i++) {
    const level = map.lotLevel[i];
    if (!level) continue;
    const type = ZONE_BY_CODE[map.zoneType[i]];
    const occupants = map.lotOccupants[i];
    if (type === 'R') population += occupants;
    else if (type) {
      jobs[type] += getZoneDefByCode(map.zoneType[i], map.zoneDensity[i]).capacity[level - 1];
      workers[type] += occupants;
    }
  }
  for (const b of state.buildings.values()) jobs.services += getBuildingDef(b.defId)?.capacity?.jobs ?? 0;

  const workforce = Math.floor(population * WORKFORCE_RATIO);
  // Los servicios públicos se cubren con quien quede libre tras comercio e industria
  workers.services = Math.min(jobs.services, Math.max(0, workforce - workers.C - workers.I));

  // stats.happiness lo calcula el sistema de influencia
  stats.population = population;
  stats.workforce = workforce;
  stats.jobs = jobs;
  stats.workers = workers;
  stats.employed = workers.C + workers.I + workers.services;
}

/**
 * Demanda objetivo (sin suavizar):
 * - R: hay más empleos (más una base) que trabajadores → llega gente.
 * - C: los habitantes piden comercio en proporción a la población.
 * - I: un mercado exterior fijo más lo que pide la población.
 * Como C + I por habitante (0,55) supera la fracción que trabaja (0,5), la ciudad no se estanca sola:
 * la limitan el espacio, la electricidad, el agua y los impuestos.
 * Cada punto de impuesto por encima de TAX_NEUTRAL resta TAX_DEMAND_EFFECT (y por debajo suma);
 * por encima de TAX_HIGH, además, un castigo que crece con el cuadrado.
 * Una ciudad feliz atrae habitantes y una infeliz los espanta.
 */
export function targetDemand(s: CityStats, taxes: Record<ZoneType, number>): Record<ZoneType, number> {
  const jobCapacity = s.jobs.C + s.jobs.I + s.jobs.services;
  const tax = (z: ZoneType) => taxDemandPenalty(taxes[z]);
  const mood = (s.happiness - HAPPINESS_BASE) * HAPPINESS_DEMAND_EFFECT;
  return {
    R: clamp1((jobCapacity + BASE_RESIDENTIAL_JOBS - s.workforce) / Math.max(s.workforce, DEMAND_SCALE) - tax('R') + mood),
    C: clamp1((s.population * COMMERCE_PER_RESIDENT - s.jobs.C) / Math.max(s.jobs.C, DEMAND_SCALE) - tax('C')),
    I: clamp1(
      (BASE_INDUSTRIAL_DEMAND + s.population * INDUSTRY_PER_RESIDENT - s.jobs.I) / Math.max(s.jobs.I, DEMAND_SCALE) - tax('I'),
    ),
  };
}

export function taxDemandPenalty(rate: number): number {
  const over = Math.max(0, rate - TAX_HIGH);
  return (rate - TAX_NEUTRAL) * TAX_DEMAND_EFFECT + over * over * TAX_HIGH_EFFECT;
}

export function updateDemand(state: GameState): void {
  const target = targetDemand(state.stats, state.economy.taxes);
  const d = state.stats.demand;
  for (const k of ['R', 'C', 'I'] as const) d[k] += (clamp1(target[k] + effectDemand(state, k)) - d[k]) * DEMAND_SMOOTHING;
}
