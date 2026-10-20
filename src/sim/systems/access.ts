import { ROAD_ACCESS_DISTANCE } from '../config';
import { type GameState, NO_ACCESS } from '../state';
import { TERRAIN_WATER } from '../types';

/**
 * Recalcula state.layers.roadAccess en dos pasadas (BFS):
 * 1. Carreteras conectadas con el borde del mapa (por ahí llegan habitantes y mercancías) → 0.
 * 2. Distancia a pie desde esa red, sin cruzar agua, hasta ROAD_ACCESS_DISTANCE.
 * Una carretera aislada no da acceso.
 * También anota en state.layers.roadEntry la carretera por la que sale cada casilla (para el tráfico).
 */
export function computeRoadAccess(state: GameState): void {
  const { map } = state;
  const { width: w, height: h } = map;
  const access = state.layers.roadAccess;
  const entry = state.layers.roadEntry;
  access.fill(NO_ACCESS);
  entry.fill(-1);
  const queue = new Int32Array(w * h);
  let tail = 0;

  const seed = (i: number) => {
    if (map.road[i] && access[i] === NO_ACCESS) {
      access[i] = 0;
      entry[i] = i;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }

  const forNeighbors = (i: number, fn: (n: number) => void) => {
    const x = i % w;
    if (x > 0) fn(i - 1);
    if (x < w - 1) fn(i + 1);
    if (i >= w) fn(i - w);
    if (i < w * (h - 1)) fn(i + w);
  };

  // 1. Red conectada
  for (let head = 0; head < tail; head++) forNeighbors(queue[head], seed);

  // 2. Distancia desde la red (la cola ya contiene todas las carreteras conectadas)
  for (let head = 0; head < tail; head++) {
    const i = queue[head];
    const d = access[i];
    if (d >= ROAD_ACCESS_DISTANCE) continue;
    forNeighbors(i, (n) => {
      if (access[n] === NO_ACCESS && map.terrain[n] !== TERRAIN_WATER) {
        access[n] = d + 1;
        entry[n] = entry[i];
        queue[tail++] = n;
      }
    });
  }
}

export function hasRoadAccess(state: GameState, i: number): boolean {
  return state.layers.roadAccess[i] <= ROAD_ACCESS_DISTANCE;
}
