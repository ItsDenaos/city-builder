import { CONGESTION_COST, SHOPPING_TRIPS_PER_RESIDENT, TRAFFIC_SMOOTHING, WORKFORCE_RATIO } from '../config';
import { getBuildingDef } from '../data/buildings';
import { ROAD_BY_CODE } from '../data/roads';
import { ZONE_CODE } from '../data/zones';
import { MinHeap } from '../heap';
import { type GameMap, type GameState, tileIndex } from '../state';

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
 * Asigna viajes a la red con un árbol de caminos mínimos:
 * Dijkstra desde todos los destinos a la vez (cada carretera queda unida a su destino más cercano),
 * y luego el flujo de cada origen se acumula siguiendo el árbol hacia su destino.
 * Devuelve el coste de viaje desde cada casilla de carretera a su destino más cercano (Infinity si no llega).
 */
function assign(map: GameMap, prevTraffic: Float32Array, origins: Float32Array, destinations: Uint8Array, out: Float32Array): Float32Array {
  const size = map.width * map.height;
  const dist = new Float32Array(size).fill(Infinity);
  const parent = new Int32Array(size).fill(-1);
  const settled = new Uint8Array(size);
  const order: number[] = [];
  const heap = new MinHeap();
  for (let i = 0; i < size; i++) {
    if (destinations[i] && map.road[i]) {
      dist[i] = 0;
      heap.push(i, 0);
    }
  }
  const w = map.width;
  while (heap.size) {
    const i = heap.pop();
    if (settled[i]) continue;
    settled[i] = 1;
    order.push(i);
    const x = i % w;
    const neighbors = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
    for (const n of neighbors) {
      if (n < 0 || n >= size || !map.road[n] || settled[n]) continue;
      const d = dist[i] + travelCost(map, prevTraffic, n);
      if (d < dist[n]) {
        dist[n] = d;
        parent[n] = i;
        heap.push(n, d);
      }
    }
  }
  // Acumular el flujo desde los más lejanos hacia sus destinos
  const flow = origins.slice();
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k];
    out[i] += flow[i];
    if (parent[i] >= 0) flow[parent[i]] += flow[i];
  }
  return dist;
}

/**
 * Tráfico diario (simulación agregada, sin vehículos individuales):
 * - Cada vivienda manda a sus trabajadores al empleo más cercano en tiempo de viaje
 *   y a una parte de sus vecinos al comercio más cercano.
 * - El coste de cada casilla usa la congestión del día anterior, así que el tráfico
 *   se reparte solo por rutas alternativas cuando una vía se satura.
 * - Calcula también el trayecto al trabajo de cada lote (layers.commute).
 * Los viajes no tienen en cuenta cuántas plazas quedan en el destino: es una aproximación.
 */
export function computeTraffic(state: GameState): void {
  const { map, layers, stats } = state;
  const size = map.width * map.height;
  const entry = layers.roadEntry;
  const commuters = new Float32Array(size);
  const shoppers = new Float32Array(size);
  const jobs = new Uint8Array(size);
  const shops = new Uint8Array(size);

  for (let i = 0; i < size; i++) {
    const e = entry[i];
    if (e < 0 || !map.lotLevel[i]) continue;
    const type = map.zoneType[i];
    // Cualquier comercio o industria construido cuenta como destino, aunque aún no tenga plantilla
    if (type === ZONE_CODE.R) {
      commuters[e] += map.lotOccupants[i] * WORKFORCE_RATIO;
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

  const fresh = new Float32Array(size);
  const toWork = assign(map, layers.traffic, commuters, jobs, fresh);
  assign(map, layers.traffic, shoppers, shops, fresh);

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

  // Trayecto al trabajo de cada lote residencial
  let weighted = 0;
  let residents = 0;
  layers.commute.fill(-1);
  for (let i = 0; i < size; i++) {
    const e = entry[i];
    if (e < 0 || map.zoneType[i] !== ZONE_CODE.R || !map.lotLevel[i]) continue;
    const d = toWork[e];
    if (!Number.isFinite(d)) continue;
    layers.commute[i] = d + layers.roadAccess[i];
    weighted += layers.commute[i] * map.lotOccupants[i];
    residents += map.lotOccupants[i];
  }
  for (let i = 0; i < size; i++) trips += commuters[i] + shoppers[i];

  stats.traffic = {
    trips: Math.round(trips),
    congestedShare: roads ? congested / roads : 0,
    avgCommute: residents ? weighted / residents : 0,
  };
}
