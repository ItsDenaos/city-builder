import {
  BUS_CONGESTION,
  BUS_TRAVEL_FACTOR,
  CAR_OVERHEAD,
  CONGESTION_COST,
  METRO_TILE_COST,
  MODE_SPLIT_SCALE,
  TRAIN_DEMAND,
  TRAIN_TILE_COST,
  TRANSIT_MAX_SHARE,
  TRANSIT_WAIT,
  WALK_COST,
} from '../config';
import { type BuildingDef, type TransitMode, getBuildingDef } from '../data/buildings';
import { ROAD_BY_CODE } from '../data/roads';
import { ZONE_CODE } from '../data/zones';
import { type BuildingInstance, type GameState, NO_ACCESS, tileIndex } from '../state';
import type { ZoneType } from '../types';
import { type PathTree, shortestTree, treeRoots } from './paths';

/**
 * Transporte público (fase 16), en la misma simulación agregada que el tráfico.
 * Un viaje en transporte es: andar hasta una parada, esperar, viajar y andar desde la parada de destino
 * hasta el empleo. Cada red se resuelve con un solo Dijkstra desde las paradas que tienen empleos cerca:
 * - autobús: por las calles, con parte de la congestión del día anterior;
 * - metro: por los túneles que traza el jugador, sin atascos;
 * - tren: entre estaciones, en línea recta (la línea regional).
 * Después cada lote residencial se queda con la parada a pie que le sale más barata.
 * Bajarse en la misma parada no es un viaje: si el mejor destino de una parada es ella misma (hay empleo
 * a pie desde ella), no sirve de origen; sus vecinos tienen el trabajo cerca y van en coche o andando.
 */

/** Bit de cada modo en layers.transitCoverage. */
export const COVERAGE_BIT: Record<TransitMode, number> = { bus: 1, metro: 2, train: 4 };

/** Parada o estación en servicio. */
export interface ActiveStop {
  b: BuildingInstance;
  def: BuildingDef;
  mode: TransitMode;
  /** Centro del edificio, en casillas: desde ahí se mide la distancia a pie. */
  cx: number;
  cy: number;
  radius: number;
  /** Calle conectada por la que sale (la usa el autobús). */
  entry: number;
  /** Coste a pie desde la parada hasta el empleo más cercano de su radio (Infinity si no hay ninguno). */
  egress: number;
  /** Coste desde que se llega a la parada hasta el empleo: espera, viaje y a pie (Infinity si no lleva a ninguno). */
  cost: number;
}

export interface TransitPlan {
  stops: ActiveStop[];
  /** Mejor coste en transporte desde cada lote residencial (Infinity si no hay ninguna parada útil a pie). */
  cost: Float32Array;
  /** Índice en `stops` de la parada que usarían los vecinos de cada lote (-1 = ninguna). */
  origin: Int32Array;
  /** Caminos del autobús por las calles (para la carga que los autobuses ponen en la vía). */
  busTree: PathTree | null;
}

/** Por qué una parada no da servicio, o null si lo da. */
export function stopProblem(state: GameState, b: BuildingInstance): string | null {
  const def = getBuildingDef(b.defId);
  if (!def?.transit) return null;
  if (bestEntry(state, b) < 0) return 'Sin acceso a una calle conectada';
  if (def.transit.mode !== 'bus' && !state.layers.powered[tileIndex(state.map, b.x, b.y)]) return 'Sin electricidad';
  if (def.transit.mode === 'metro' && !tunnelAccess(state, b).length) return 'Sin túnel de metro';
  return null;
}

/** Calle conectada más cercana a cualquier casilla del edificio (-1 si no hay). */
function bestEntry(state: GameState, b: BuildingInstance): number {
  const { map, layers } = state;
  let best = -1;
  let bestAccess = NO_ACCESS;
  for (let y = b.y; y < b.y + b.h; y++) {
    for (let x = b.x; x < b.x + b.w; x++) {
      const i = tileIndex(map, x, y);
      if (layers.roadEntry[i] >= 0 && layers.roadAccess[i] < bestAccess) {
        bestAccess = layers.roadAccess[i];
        best = layers.roadEntry[i];
      }
    }
  }
  return best;
}

/** Casillas de túnel bajo la estación o pegadas a ella (también en diagonal). */
function tunnelAccess(state: GameState, b: BuildingInstance): number[] {
  const { map } = state;
  const tiles: number[] = [];
  for (let y = b.y - 1; y <= b.y + b.h; y++) {
    for (let x = b.x - 1; x <= b.x + b.w; x++) {
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      const i = tileIndex(map, x, y);
      if (map.metro[i]) tiles.push(i);
    }
  }
  return tiles;
}

/** Recorre las casillas a distancia a pie (círculo) del centro de una parada. */
function forWalk(state: GameState, s: ActiveStop, fn: (i: number, d: number) => void): void {
  const { map } = state;
  const x0 = Math.max(0, Math.floor(s.cx - s.radius));
  const x1 = Math.min(map.width - 1, Math.ceil(s.cx + s.radius));
  const y0 = Math.max(0, Math.floor(s.cy - s.radius));
  const y1 = Math.min(map.height - 1, Math.ceil(s.cy + s.radius));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - s.cx, y - s.cy);
      if (d <= s.radius) fn(y * map.width + x, d);
    }
  }
}

/** Casillas con empleo: comercios e industrias construidos y edificios con plantilla. */
function jobTiles(state: GameState): Uint8Array {
  const { map } = state;
  const jobs = new Uint8Array(map.width * map.height);
  for (let i = 0; i < jobs.length; i++) {
    if (map.lotLevel[i] && (map.zoneType[i] === ZONE_CODE.C || map.zoneType[i] === ZONE_CODE.I)) jobs[i] = 1;
  }
  for (const b of state.buildings.values()) {
    if (!getBuildingDef(b.defId)?.capacity?.jobs) continue;
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) jobs[tileIndex(map, x, y)] = 1;
  }
  return jobs;
}

/** Espera en un modo con la financiación actual del transporte (más dinero, más frecuencia). */
export const transitWait = (state: GameState, mode: TransitMode) => (TRANSIT_WAIT[mode] * 100) / state.economy.funding.transit;

/**
 * Calcula el coste en transporte desde cada lote residencial y la cobertura a pie de las paradas.
 * Usa el tráfico del día anterior (el autobús se mete en los mismos atascos que los coches, aunque menos).
 */
export function planTransit(state: GameState): TransitPlan {
  const { map, layers } = state;
  const size = map.width * map.height;
  const cost = new Float32Array(size).fill(Infinity);
  const origin = new Int32Array(size).fill(-1);
  layers.transitCoverage.fill(0);

  // 1. Paradas en servicio
  const stops: ActiveStop[] = [];
  for (const b of state.buildings.values()) {
    const def = getBuildingDef(b.defId);
    if (!def?.transit || stopProblem(state, b)) continue;
    stops.push({
      b,
      def,
      mode: def.transit.mode,
      cx: b.x + (b.w - 1) / 2,
      cy: b.y + (b.h - 1) / 2,
      radius: def.transit.radius,
      entry: bestEntry(state, b),
      egress: Infinity,
      cost: Infinity,
    });
  }
  if (!stops.length) return { stops, cost, origin, busTree: null };

  // 2. A pie desde cada parada hasta el empleo más cercano
  const jobs = jobTiles(state);
  for (const s of stops) {
    let best = Infinity;
    forWalk(state, s, (i, d) => {
      if (jobs[i] && d < best) best = d;
    });
    s.egress = best * WALK_COST;
  }

  // 3. Autobús: por las calles, desde las paradas que dejan cerca de un empleo
  const byMode = (mode: TransitMode) => stops.filter((s) => s.mode === mode);
  const buses = byMode('bus');
  let busTree: PathTree | null = null;
  const busSources = buses.filter((s) => Number.isFinite(s.egress)).map((s) => [s.entry, s.egress] as const);
  if (busSources.length) {
    const busStep = (n: number) => {
      const road = ROAD_BY_CODE[map.road[n]]!;
      const load = layers.traffic[n] / road.capacity;
      return road.travelCost * BUS_TRAVEL_FACTOR * (1 + CONGESTION_COST * BUS_CONGESTION * load * load);
    };
    busTree = shortestTree(map, (n) => map.road[n] !== 0, busSources, busStep);
    const root = treeRoots(busTree);
    const wait = transitWait(state, 'bus');
    for (const s of buses) s.cost = root[s.entry] === s.entry ? Infinity : busTree.dist[s.entry] + wait;
  }

  // 4. Metro: por los túneles
  const metros = byMode('metro');
  const metroSources = metros.filter((s) => Number.isFinite(s.egress)).flatMap((s) => tunnelAccess(state, s.b).map((i) => [i, s.egress] as const));
  if (metroSources.length) {
    const tree = shortestTree(map, (n) => map.metro[n] !== 0, metroSources, () => METRO_TILE_COST);
    const root = treeRoots(tree);
    const wait = transitWait(state, 'metro');
    for (const s of metros) {
      const own = new Set(tunnelAccess(state, s.b));
      let best = Infinity;
      for (const i of own) if (!own.has(root[i])) best = Math.min(best, tree.dist[i]);
      s.cost = best + wait;
    }
  }

  // 5. Tren: entre estaciones, en línea recta
  const trains = byMode('train');
  const wait = transitWait(state, 'train');
  for (const o of trains) {
    let best = Infinity;
    for (const d of trains) if (d !== o) best = Math.min(best, d.egress + Math.hypot(o.cx - d.cx, o.cy - d.cy) * TRAIN_TILE_COST);
    o.cost = best + wait;
  }

  // 6. Cada lote residencial se queda con la parada a pie que le sale más barata
  stops.forEach((s, k) => {
    const bit = COVERAGE_BIT[s.mode];
    const useful = Number.isFinite(s.cost);
    forWalk(state, s, (i, d) => {
      layers.transitCoverage[i] |= bit;
      if (!useful || map.zoneType[i] !== ZONE_CODE.R || !map.lotLevel[i]) return;
      const c = d * WALK_COST + s.cost;
      if (c < cost[i]) {
        cost[i] = c;
        origin[i] = k;
      }
    });
  });
  return { stops, cost, origin, busTree };
}

/**
 * Fracción de trabajadores que deja el coche (0-TRANSIT_MAX_SHARE), con una curva logística sobre
 * la diferencia de costes: el coche paga además CAR_OVERHEAD. Sin camino en coche, todos van en transporte.
 */
export function transitShareFor(car: number, transit: number): number {
  if (!Number.isFinite(transit)) return 0;
  if (!Number.isFinite(car)) return 1;
  return TRANSIT_MAX_SHARE / (1 + Math.exp((transit - car - CAR_OVERHEAD) / MODE_SPLIT_SCALE));
}

/** Demanda regional que trae la primera estación de tren en servicio. */
export function regionalDemand(state: GameState, zone: ZoneType): number {
  return state.stats.transit.trainStations > 0 ? (TRAIN_DEMAND[zone] ?? 0) : 0;
}
