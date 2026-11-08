import { BUS_ROAD_LOAD, CONGESTION_COST, SHOPPING_TRIPS_PER_RESIDENT, TOURIST_CAR_TRIPS, TRAFFIC_SMOOTHING } from '../config';
import { getBuildingDef } from '../data/buildings';
import { ROAD_BY_CODE } from '../data/roads';
import { ZONE_CODE } from '../data/zones';
import { type GameMap, type GameState, TRANSIT_MODE_CODE, tileIndex } from '../state';
import { accumulate, shortestTree } from './paths';
import { workforceRatio } from './demography';
import { activeMonuments } from './tourism';
import { planTransit, transitShareFor } from './transit';

/** Capacidad (viajes/día) de una casilla de carretera; 0 si no hay carretera. */
export function roadCapacity(map: GameMap, i: number): number {
  return ROAD_BY_CODE[map.road[i]]?.capacity ?? 0;
}

/** Coste de cruzar una casilla con la congestión actual: crece con el cuadrado de la carga. */
function travelCost(map: GameMap, traffic: Float32Array, i: number): number {
  const road = ROAD_BY_CODE[map.road[i]]!;
  const load = traffic[i] / road.capacity;
  return road.travelCost * (1 + CONGESTION_COST * load * load);
}

/**
 * Turistas en coche (fase 19): entran por las calles conectadas del borde del mapa, repartidos a partes
 * iguales, y van a la calle de entrada de los monumentos en servicio. Null si no hay turistas en coche.
 */
function touristTrips(state: GameState): { origins: Float32Array; sights: Uint8Array } | null {
  const { map, layers, stats } = state;
  const byCar = stats.tourism.visitors - stats.tourism.byTrain;
  if (byCar <= 0) return null;
  const size = map.width * map.height;
  const sights = new Uint8Array(size);
  let any = false;
  for (const b of activeMonuments(state)) {
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        const e = layers.roadEntry[tileIndex(map, x, y)];
        if (e < 0) continue;
        sights[e] = 1;
        any = true;
      }
    }
  }
  const gates: number[] = [];
  for (let i = 0; i < size; i++) {
    const x = i % map.width;
    const y = (i - x) / map.width;
    const border = x === 0 || y === 0 || x === map.width - 1 || y === map.height - 1;
    if (border && map.road[i] && layers.roadAccess[i] === 0) gates.push(i);
  }
  if (!any || !gates.length) return null;
  const origins = new Float32Array(size);
  for (const g of gates) origins[g] += (byCar * TOURIST_CAR_TRIPS) / gates.length;
  return { origins, sights };
}

/**
 * Tráfico diario (simulación agregada, sin vehículos individuales):
 * - Cada vivienda manda a sus trabajadores al empleo más cercano en tiempo de viaje
 *   y a una parte de sus vecinos al comercio más cercano. Los viajes se asignan con un árbol de
 *   caminos mínimos: Dijkstra desde todos los destinos a la vez y el flujo de cada origen se acumula
 *   siguiendo el árbol (paths.ts).
 * - Reparto modal (fase 16): si hay una parada a pie que lleve a un empleo, parte de los trabajadores
 *   deja el coche (transit.ts). Esos viajes salen de la calzada; los autobuses ponen algo de carga.
 * - El coste de cada casilla usa la congestión del día anterior, así que el tráfico
 *   se reparte solo por rutas alternativas cuando una vía se satura.
 * - Los turistas (fase 19) entran en coche por el borde del mapa y van a los monumentos.
 * - Calcula también el trayecto al trabajo de cada lote (layers.commute).
 * Los viajes no tienen en cuenta cuántas plazas quedan en el destino: es una aproximación.
 */
export function computeTraffic(state: GameState): void {
  const { map, layers, stats } = state;
  const size = map.width * map.height;
  const entry = layers.roadEntry;
  const shoppers = new Float32Array(size);
  const jobs = new Uint8Array(size);
  const shops = new Uint8Array(size);

  for (let i = 0; i < size; i++) {
    const e = entry[i];
    if (e < 0 || !map.lotLevel[i]) continue;
    const type = map.zoneType[i];
    // Cualquier comercio o industria construido cuenta como destino, aunque aún no tenga plantilla
    if (type === ZONE_CODE.R) {
      shoppers[e] += map.lotOccupants[i] * SHOPPING_TRIPS_PER_RESIDENT;
    } else {
      jobs[e] = 1;
      if (type === ZONE_CODE.C) shops[e] = 1;
    }
  }
  for (const b of state.buildings.values()) {
    if (!getBuildingDef(b.defId)?.capacity?.jobs) continue;
    const e = entry[tileIndex(map, b.x, b.y)];
    if (e >= 0) jobs[e] = 1;
  }

  const isRoad = (n: number) => map.road[n] !== 0;
  const carStep = (n: number) => travelCost(map, layers.traffic, n);
  const sourcesOf = (mask: Uint8Array) => {
    const sources: [number, number][] = [];
    for (let i = 0; i < size; i++) if (mask[i] && map.road[i]) sources.push([i, 0]);
    return sources;
  };
  const toWork = shortestTree(map, isRoad, sourcesOf(jobs), carStep);
  const transit = planTransit(state);

  // Reparto modal y trayecto al trabajo de cada lote residencial
  const commuters = new Float32Array(size);
  const busLoad = new Float32Array(size);
  const riders = { bus: 0, metro: 0, train: 0 };
  layers.ridership.clear();
  layers.transitStops = new Map(transit.stops.map((s) => [s.b.id, { egress: s.egress, cost: s.cost }]));
  layers.transitShare.fill(0);
  layers.transitMode.fill(0);
  layers.commute.fill(-1);
  let weighted = 0;
  let residents = 0;
  let workforce = 0;
  const ratio = workforceRatio(state);
  for (let i = 0; i < size; i++) {
    const e = entry[i];
    if (e < 0 || map.zoneType[i] !== ZONE_CODE.R || !map.lotLevel[i]) continue;
    const workers = map.lotOccupants[i] * ratio;
    const d = toWork.dist[e];
    const car = Number.isFinite(d) ? d + layers.roadAccess[i] : Infinity;
    const byTransit = transit.cost[i];
    const share = transitShareFor(car, byTransit);
    commuters[e] += workers * (1 - share);
    workforce += workers;
    if (share > 0) {
      const stop = transit.stops[transit.origin[i]];
      const r = workers * share;
      riders[stop.mode] += r;
      layers.ridership.set(stop.b.id, (layers.ridership.get(stop.b.id) ?? 0) + r);
      if (stop.mode === 'bus') busLoad[stop.entry] += r * BUS_ROAD_LOAD;
      layers.transitShare[i] = share;
      layers.transitMode[i] = TRANSIT_MODE_CODE[stop.mode];
    }
    // Quien elige el transporte no tarda más que en coche: si lo coge es porque le compensa
    const commute = Number.isFinite(car) ? car - share * Math.max(0, car - byTransit) : byTransit;
    if (!Number.isFinite(commute)) continue;
    layers.commute[i] = commute;
    weighted += layers.commute[i] * map.lotOccupants[i];
    residents += map.lotOccupants[i];
  }

  const fresh = new Float32Array(size);
  accumulate(toWork, commuters, fresh);
  accumulate(shortestTree(map, isRoad, sourcesOf(shops), carStep), shoppers, fresh);
  if (transit.busTree) accumulate(transit.busTree, busLoad, fresh);
  const tourists = touristTrips(state);
  if (tourists) accumulate(shortestTree(map, isRoad, sourcesOf(tourists.sights), carStep), tourists.origins, fresh);

  // Suavizar para que las rutas no oscilen de un día a otro
  let trips = 0;
  let roads = 0;
  let congested = 0;
  for (let i = 0; i < size; i++) {
    if (!map.road[i]) {
      layers.traffic[i] = 0;
      continue;
    }
    layers.traffic[i] += (fresh[i] - layers.traffic[i]) * TRAFFIC_SMOOTHING;
    roads++;
    if (layers.traffic[i] > roadCapacity(map, i)) congested++;
  }
  for (let i = 0; i < size; i++) trips += commuters[i] + shoppers[i] + (tourists ? tourists.origins[i] : 0);

  const totalRiders = riders.bus + riders.metro + riders.train;
  stats.traffic = {
    trips: Math.round(trips),
    congestedShare: roads ? congested / roads : 0,
    avgCommute: residents ? weighted / residents : 0,
  };
  stats.transit = {
    riders: totalRiders,
    ...riders,
    share: workforce ? totalRiders / workforce : 0,
    trainStations: transit.stops.filter((s) => s.mode === 'train').length,
  };
}
