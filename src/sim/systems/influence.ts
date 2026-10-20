import { effectHappiness } from '../effects';
import {
  CRIME_LAND_VALUE,
  CRIME_PER_OCCUPANT,
  COMMUTE_HAPPINESS,
  COMMUTE_MAX_PENALTY,
  COMMUTE_OK,
  CRIME_RADIUS,
  HAPPINESS_BASE,
  INDUSTRY_POLLUTION,
  INDUSTRY_POLLUTION_RADIUS,
  LAND_VALUE_BASE,
  NO_JOB_ACCESS_PENALTY,
  POLICE_CRIME_REDUCTION,
  POLLUTION_LAND_VALUE,
  SERVICE_LAND_VALUE,
  TAX_NEUTRAL,
  TRAFFIC_POLLUTION,
  UNEMPLOYMENT_HAPPINESS,
  TRAFFIC_POLLUTION_MAX,
  TRAFFIC_POLLUTION_RADIUS,
  WATERFRONT_BONUS,
  WATERFRONT_RADIUS,
} from '../config';
import { type ServiceType, getBuildingDef } from '../data/buildings';
import { ZONE_CODE } from '../data/zones';
import { type GameMap, type GameState, tileIndex } from '../state';
import { TERRAIN_WATER } from '../types';
import { roadCapacity } from './traffic';

export const SERVICES: readonly ServiceType[] = ['police', 'fire', 'health', 'education', 'park'];

const clamp100 = (v: number) => Math.max(0, Math.min(100, v));

/**
 * Suma (o máximo, para coberturas) de un efecto circular centrado en (cx, cy).
 * - 'add': decrece linealmente desde `peak` en el centro.
 * - 'max': meseta de `peak` hasta medio radio y luego baja hasta un 20 % en el borde.
 */
function stamp(map: GameMap, layer: Float32Array, cx: number, cy: number, radius: number, peak: number, mode: 'add' | 'max'): void {
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(map.width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(map.height - 1, Math.ceil(cy + radius));
  const half = radius / 2;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > radius) continue;
      const i = y * map.width + x;
      if (mode === 'add') layer[i] += peak * (1 - d / (radius + 1));
      else layer[i] = Math.max(layer[i], d <= half ? peak : peak * (1 - (0.8 * (d - half)) / half));
    }
  }
}

/** Distancia (en casillas, 4 vecinos) al agua más cercana, hasta `max`. */
function waterDistance(map: GameMap, max: number): Uint8Array {
  const size = map.width * map.height;
  const dist = new Uint8Array(size).fill(255);
  const queue = new Int32Array(size);
  let tail = 0;
  for (let i = 0; i < size; i++) {
    if (map.terrain[i] === TERRAIN_WATER) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }
  for (let head = 0; head < tail; head++) {
    const i = queue[head];
    if (dist[i] >= max) continue;
    const x = i % map.width;
    for (const n of [x > 0 ? i - 1 : -1, x < map.width - 1 ? i + 1 : -1, i - map.width, i + map.width]) {
      if (n >= 0 && n < size && dist[n] === 255) {
        dist[n] = dist[i] + 1;
        queue[tail++] = n;
      }
    }
  }
  return dist;
}

/**
 * Recalcula las capas de influencia:
 * 1. Cobertura de servicios (solo edificios con electricidad).
 * 2. Contaminación: industria, tráfico y efectos de edificios (central de carbón...).
 * 3. Crimen: crece con la densidad de habitantes y trabajadores, lo reduce la policía y los parques.
 * 4. Valor del suelo: base + agua cercana + servicios + parques − contaminación − crimen.
 * 5. Felicidad de cada lote residencial y media de la ciudad.
 */
export function computeInfluence(state: GameState): void {
  const { map, layers, stats, economy } = state;
  const size = map.width * map.height;
  const { coverage, pollution, crime, landValue, happiness } = layers;
  for (const s of SERVICES) coverage[s].fill(0);
  pollution.fill(0);
  crime.fill(0);
  landValue.fill(0); // aquí se acumulan primero los efectos de edificios
  const crimeEffects = new Float32Array(size);

  // 1-2. Edificios colocados
  for (const b of state.buildings.values()) {
    const def = getBuildingDef(b.defId);
    if (!def) continue;
    const cx = b.x + (b.w - 1) / 2;
    const cy = b.y + (b.h - 1) / 2;
    if (def.coverage && layers.powered[tileIndex(map, b.x, b.y)]) {
      stamp(map, coverage[def.coverage.service], cx, cy, def.coverage.radius, 100, 'max');
    }
    const fx = def.effects;
    if (fx?.pollution) stamp(map, pollution, cx, cy, fx.radius, fx.pollution, 'add');
    if (fx?.landValue) stamp(map, landValue, cx, cy, fx.radius, fx.landValue, 'add');
    if (fx?.crime) stamp(map, crimeEffects, cx, cy, fx.radius, fx.crime, 'add');
  }

  // 2-3. Lotes: la industria contamina; viviendas y comercios generan crimen
  for (let i = 0; i < size; i++) {
    const level = map.lotLevel[i];
    if (!level) continue;
    const x = i % map.width;
    const y = (i - x) / map.width;
    const type = map.zoneType[i];
    if (type === ZONE_CODE.I) {
      stamp(map, pollution, x, y, INDUSTRY_POLLUTION_RADIUS, INDUSTRY_POLLUTION[map.zoneDensity[i]] * level, 'add');
    } else if (map.lotOccupants[i]) {
      stamp(map, crime, x, y, CRIME_RADIUS, map.lotOccupants[i] * CRIME_PER_OCCUPANT, 'add');
    }
  }

  // 2. Tráfico: cada vía contamina según su carga
  for (let i = 0; i < size; i++) {
    const t = layers.traffic[i];
    if (!t || !map.road[i]) continue;
    const peak = Math.min(TRAFFIC_POLLUTION_MAX, (t / roadCapacity(map, i)) * TRAFFIC_POLLUTION);
    if (peak < 1) continue;
    const x = i % map.width;
    stamp(map, pollution, x, (i - x) / map.width, TRAFFIC_POLLUTION_RADIUS, peak, 'add');
  }

  // 3-4. Combinar
  const water = waterDistance(map, WATERFRONT_RADIUS);
  for (let i = 0; i < size; i++) {
    pollution[i] = clamp100(pollution[i]);
    crime[i] = clamp100(crime[i] + crimeEffects[i] - coverage.police[i] * POLICE_CRIME_REDUCTION);
    const waterfront = water[i] <= WATERFRONT_RADIUS ? WATERFRONT_BONUS * (1 - (water[i] - 1) / WATERFRONT_RADIUS) : 0;
    const services = (coverage.police[i] + coverage.fire[i] + coverage.health[i] + coverage.education[i]) * SERVICE_LAND_VALUE;
    landValue[i] = clamp100(
      LAND_VALUE_BASE + Math.min(waterfront, WATERFRONT_BONUS) + services + landValue[i] -
        pollution[i] * POLLUTION_LAND_VALUE - crime[i] * CRIME_LAND_VALUE,
    );
  }

  // 5. Felicidad
  const jobCapacity = stats.jobs.C + stats.jobs.I + stats.jobs.services;
  const missingJobs = stats.workforce ? Math.max(0, stats.workforce - jobCapacity) / stats.workforce : 0;
  const taxPenalty = (economy.taxes.R - TAX_NEUTRAL) * 1.5;
  const cityHasJobs = jobCapacity > 0;
  // Trayectos largos molestan; no poder llegar a ningún empleo, más (si los hay en la ciudad)
  const commutePenalty = (i: number) => {
    const c = layers.commute[i];
    if (c < 0) return cityHasJobs ? NO_JOB_ACCESS_PENALTY : 0;
    return Math.min(COMMUTE_MAX_PENALTY, Math.max(0, c - COMMUTE_OK) * COMMUTE_HAPPINESS);
  };
  const events = effectHappiness(state);
  let weighted = 0;
  let residents = 0;
  happiness.fill(0);
  for (let i = 0; i < size; i++) {
    if (map.zoneType[i] !== ZONE_CODE.R || !map.lotLevel[i]) continue;
    const h = clamp100(
      HAPPINESS_BASE +
        coverage.health[i] * 0.15 +
        coverage.education[i] * 0.15 +
        coverage.fire[i] * 0.1 +
        coverage.park[i] * 0.1 +
        (landValue[i] - 50) * 0.1 -
        pollution[i] * 0.5 -
        crime[i] * 0.4 -
        missingJobs * UNEMPLOYMENT_HAPPINESS -
        taxPenalty -
        commutePenalty(i) +
        events,
    );
    happiness[i] = h;
    weighted += h * map.lotOccupants[i];
    residents += map.lotOccupants[i];
  }
  stats.happiness = residents ? weighted / residents : HAPPINESS_BASE;
}
