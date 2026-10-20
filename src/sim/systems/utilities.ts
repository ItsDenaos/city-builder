import { OUTAGE_CAPACITY, PIPE_RADIUS, POWER_PER_CAPACITY, WATER_PER_CAPACITY } from '../config';
import { type BuildingDef, getBuildingDef } from '../data/buildings';
import { getZoneDefByCode } from '../data/zones';
import { effectWaterDemand } from '../effects';
import { type GameMap, type GameState, NO_BUILDING, tileIndex } from '../state';

/**
 * Electricidad y agua. Cada red reparte su producción en orden de cercanía a la fuente
 * (orden BFS): si no alcanza, se quedan sin servicio primero los consumidores más lejanos.
 */

function lotNeed(map: GameMap, i: number, perCapacity: number): number {
  const level = map.lotLevel[i];
  return level ? getZoneDefByCode(map.zoneType[i], map.zoneDensity[i]).capacity[level - 1] * perCapacity : 0;
}

/** Las carreteras, zonas, edificios y el tendido eléctrico conducen la electricidad. */
export function conductsPower(map: GameMap, i: number): boolean {
  return map.road[i] !== 0 || map.powerLine[i] === 1 || map.zoneType[i] !== 0 || map.building[i] !== NO_BUILDING;
}

function forNeighbors(map: GameMap, i: number, fn: (n: number) => void): void {
  const w = map.width;
  const x = i % w;
  if (x > 0) fn(i - 1);
  if (x < w - 1) fn(i + 1);
  if (i >= w) fn(i - w);
  if (i < w * (map.height - 1)) fn(i + w);
}

function fillFootprint(state: GameState, id: number, layer: Uint8Array, value: number): void {
  const b = state.buildings.get(id)!;
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) layer[tileIndex(state.map, x, y)] = value;
}

/** Reparte la producción de una red entre edificios y lotes y acumula el consumo que intentó atender. */
class Allocator {
  demand = 0;
  private served = new Map<number, boolean>();

  constructor(
    private state: GameState,
    private layer: Uint8Array,
    public remaining: number,
    private buildingNeed: (def: BuildingDef) => number,
    private isProducer: (def: BuildingDef) => boolean,
    private perCapacity: number,
  ) {}

  /** Decide si una casilla de la red recibe servicio. */
  visit(i: number): void {
    const { map } = this.state;
    const id = map.building[i];
    if (id !== NO_BUILDING) {
      if (this.served.has(id)) return;
      const def = getBuildingDef(this.state.buildings.get(id)!.defId)!;
      const need = this.buildingNeed(def);
      this.demand += need;
      const ok = this.isProducer(def) || this.take(need);
      this.served.set(id, ok);
      fillFootprint(this.state, id, this.layer, ok ? 1 : 0);
    } else if (map.lotLevel[i]) {
      const need = lotNeed(map, i, this.perCapacity);
      this.demand += need;
      this.layer[i] = this.take(need) ? 1 : 0;
    } else {
      // Zona vacía, carretera, tendido...: tiene servicio si a la red le queda algo
      this.layer[i] = this.remaining > 0 ? 1 : 0;
    }
  }

  private take(need: number): boolean {
    if (need > this.remaining) return false;
    this.remaining -= need;
    return true;
  }
}

export function computePower(state: GameState): void {
  const { map } = state;
  const size = map.width * map.height;
  const powered = state.layers.powered;
  powered.fill(0);
  const visited = new Uint8Array(size);
  const queue = new Int32Array(size);
  let production = 0;
  let demand = 0;

  for (const b of state.buildings.values()) {
    if (!getBuildingDef(b.defId)?.power?.produces) continue;
    const start = tileIndex(map, b.x, b.y);
    if (visited[start]) continue; // ya contada dentro de otra red

    // 1. Recorrer la red conectada a esta central
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    for (let head = 0; head < tail; head++) {
      forNeighbors(map, queue[head], (n) => {
        if (!visited[n] && conductsPower(map, n)) {
          visited[n] = 1;
          queue[tail++] = n;
        }
      });
    }

    // 2. Sumar la producción de todas las centrales de la red
    const producers = new Set<number>();
    let supply = 0;
    for (let k = 0; k < tail; k++) {
      const id = map.building[queue[k]];
      if (id === NO_BUILDING || producers.has(id)) continue;
      producers.add(id);
      const b = state.buildings.get(id)!;
      // Una central averiada rinde menos hasta que se repara
      supply += (getBuildingDef(b.defId)?.power?.produces ?? 0) * (b.outage ? OUTAGE_CAPACITY : 1);
    }
    production += supply;

    // 3. Repartir desde la central hacia fuera
    const alloc = new Allocator(
      state, powered, supply,
      (def) => def.power?.consumes ?? 0,
      (def) => (def.power?.produces ?? 0) > 0,
      POWER_PER_CAPACITY,
    );
    for (let k = 0; k < tail; k++) alloc.visit(queue[k]);
    demand += alloc.demand;
  }
  state.utilities.power = { production, demand };
}

/** Debe ejecutarse después de computePower: las bombas sin electricidad no producen. */
export function computeWater(state: GameState): void {
  const { map } = state;
  const { width: w, height: h } = map;
  const size = w * h;
  const watered = state.layers.watered;
  watered.fill(0);

  // 1. Etiquetar las redes de tuberías
  const component = new Int32Array(size).fill(-1);
  const order: number[][] = []; // casillas de cada red en orden BFS
  for (let i = 0; i < size; i++) {
    if (!map.waterPipe[i] || component[i] !== -1) continue;
    const c = order.length;
    const tiles = [i];
    component[i] = c;
    for (let head = 0; head < tiles.length; head++) {
      forNeighbors(map, tiles[head], (n) => {
        if (map.waterPipe[n] && component[n] === -1) {
          component[n] = c;
          tiles.push(n);
        }
      });
    }
    order.push(tiles);
  }

  // 2. Cada fuente con electricidad aporta a la red cuya tubería toca (encima o al lado)
  const supply = new Array<number>(order.length).fill(0);
  let production = 0;
  for (const b of state.buildings.values()) {
    const produces = getBuildingDef(b.defId)?.water?.produces;
    if (!produces || !state.layers.powered[tileIndex(map, b.x, b.y)]) continue;
    let c = -1;
    for (let y = b.y - 1; y <= b.y + b.h && c < 0; y++) {
      for (let x = b.x - 1; x <= b.x + b.w && c < 0; x++) {
        if (x >= 0 && y >= 0 && x < w && y < h) c = component[tileIndex(map, x, y)];
      }
    }
    if (c < 0) continue;
    supply[c] += produces;
    production += produces;
  }

  // 3. Cada tubería cubre las casillas a PIPE_RADIUS; se reparte en orden de la red
  const claimed = new Uint8Array(size);
  let demand = 0;
  const mult = effectWaterDemand(state); // ola de calor...
  order.forEach((tiles, c) => {
    if (!supply[c]) return;
    const alloc = new Allocator(state, watered, supply[c], (def) => (def.water?.consumes ?? 0) * mult, (def) => (def.water?.produces ?? 0) > 0, WATER_PER_CAPACITY * mult);
    for (const p of tiles) {
      const px = p % w;
      const py = (p - px) / w;
      for (let y = Math.max(0, py - PIPE_RADIUS); y <= Math.min(h - 1, py + PIPE_RADIUS); y++) {
        for (let x = Math.max(0, px - PIPE_RADIUS); x <= Math.min(w - 1, px + PIPE_RADIUS); x++) {
          const i = y * w + x;
          if (claimed[i]) continue;
          claimed[i] = 1;
          alloc.visit(i);
        }
      }
    }
    demand += alloc.demand;
  });
  state.utilities.water = { production, demand };
}
