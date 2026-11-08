import { GARBAGE_BUILDUP, GARBAGE_CLEANUP, GARBAGE_PER_OCCUPANT, GARBAGE_TOLERANCE } from '../config';
import { getBuildingDef } from '../data/buildings';
import { ZONE_BY_CODE } from '../data/zones';
import { effectGarbage } from '../effects';
import { type BuildingInstance, type GameState, newGarbageStats, tileIndex } from '../state';
import type { SimEvent } from '../types';
import { hasRoadAccess } from './access';

/**
 * Basura (fase 14), en la simulación agregada: cada lote construido produce basura según sus ocupantes;
 * las instalaciones de residuos en servicio la recogen hasta su capacidad del día, de los lotes más cercanos
 * a los más lejanos de su radio (los camiones), por turnos: así cada lote va a la instalación más cercana
 * que aún tenga sitio. Donde no se recoge, la basura se acumula (0-100) y quita
 * felicidad, valor del suelo y salud; donde se recoge, se va limpiando. Los vertederos además se llenan.
 * Solo funciona en partidas con `sanitation`.
 */

/** Desplazamientos de un círculo de radio r, del más cercano al más lejano (se calculan una vez por radio). */
const RINGS = new Map<number, Int16Array>();
function ring(r: number): Int16Array {
  let o = RINGS.get(r);
  if (!o) {
    const list: [number, number, number][] = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.hypot(dx, dy);
        if (d <= r) list.push([dx, dy, d]);
      }
    }
    list.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
    o = new Int16Array(list.flatMap(([dx, dy]) => [dx, dy]));
    RINGS.set(r, o);
  }
  return o;
}

/** Basura acumulada que ya molesta (por encima de la tolerancia). */
export const excessGarbage = (g: number) => Math.max(0, g - GARBAGE_TOLERANCE);

/** Basura que produce un lote al día (sin ordenanzas). */
export function lotGarbage(state: GameState, i: number): number {
  const { map } = state;
  if (!map.lotLevel[i]) return 0;
  const type = ZONE_BY_CODE[map.zoneType[i]];
  return type ? map.lotOccupants[i] * GARBAGE_PER_OCCUPANT[type] : 0;
}

/** Por qué una instalación de residuos no recoge, o null si recoge. */
export function facilityProblem(state: GameState, b: BuildingInstance): string | null {
  const def = getBuildingDef(b.defId);
  if (!def?.garbage) return null;
  const { map } = state;
  let access = false;
  for (let y = b.y; y < b.y + b.h && !access; y++) for (let x = b.x; x < b.x + b.w && !access; x++) access = hasRoadAccess(state, tileIndex(map, x, y));
  if (!access) return 'Sin acceso a una calle conectada';
  if (def.power?.consumes && !state.layers.powered[tileIndex(map, b.x, b.y)]) return 'Sin electricidad';
  if (def.garbage.storage && (b.stored ?? 0) >= def.garbage.storage) return 'Lleno';
  return null;
}

/** Recogida del día y basura acumulada en cada lote. */
export function collectGarbage(state: GameState, events: SimEvent[]): void {
  const { map, layers, stats } = state;
  layers.wasteFacilities.clear();
  if (!state.sanitation) {
    stats.garbage = newGarbageStats();
    return;
  }
  const size = map.width * map.height;
  const mult = effectGarbage(state);
  const funding = state.economy.funding.waste / 100;
  const collected = new Uint8Array(size);
  const garbage = newGarbageStats();

  // 1. Instalaciones en servicio
  const trucks: { b: BuildingInstance; storage: number; cx: number; cy: number; offsets: Int16Array; capacity: number; remaining: number; took: number }[] = [];
  for (const b of state.buildings.values()) {
    const def = getBuildingDef(b.defId);
    if (!def?.garbage) continue;
    const storage = def.garbage.storage ?? 0;
    garbage.landfillCapacity += storage;
    if (facilityProblem(state, b)) {
      garbage.landfillUsed += b.stored ?? 0;
      continue;
    }
    const capacity = Math.min(def.garbage.collect * funding, storage ? storage - (b.stored ?? 0) : Infinity);
    const cx = b.x + Math.floor(b.w / 2);
    const cy = b.y + Math.floor(b.h / 2);
    trucks.push({ b, storage, cx, cy, offsets: ring(def.garbage.radius), capacity, remaining: capacity, took: 0 });
  }

  // 2. Recogida por turnos: en cada vuelta, cada instalación mira su siguiente casilla más cercana
  //    (los anillos de todos los radios comparten el mismo orden, así que avanzan a la par en distancia)
  const longest = trucks.reduce((m, t) => Math.max(m, t.offsets.length), 0);
  for (let k = 0; k < longest; k += 2) {
    for (const t of trucks) {
      if (k >= t.offsets.length || t.remaining <= 0) continue;
      const x = t.cx + t.offsets[k];
      const y = t.cy + t.offsets[k + 1];
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      const i = y * map.width + x;
      if (collected[i]) continue;
      const amount = lotGarbage(state, i) * mult;
      if (amount <= 0 || amount > t.remaining) continue;
      t.remaining -= amount;
      t.took += amount;
      collected[i] = 1;
    }
  }
  for (const t of trucks) {
    layers.wasteFacilities.set(t.b.id, { collected: t.took, capacity: t.capacity });
    garbage.capacity += t.capacity;
    garbage.collected += t.took;
    if (t.storage) {
      t.b.stored = (t.b.stored ?? 0) + t.took;
      garbage.landfillUsed += t.b.stored;
      if (t.b.stored >= t.storage) events.push({ type: 'landfillFull', name: getBuildingDef(t.b.defId)!.name, x: t.b.x, y: t.b.y });
    }
  }

  // 3. Se acumula donde no se recoge y se limpia donde sí
  let lots = 0;
  let dirty = 0;
  for (let i = 0; i < size; i++) {
    if (!map.lotLevel[i]) {
      map.garbage[i] = 0;
      continue;
    }
    const amount = lotGarbage(state, i) * mult;
    garbage.produced += amount;
    lots++;
    if (collected[i]) map.garbage[i] = Math.max(0, map.garbage[i] - GARBAGE_CLEANUP);
    else if (amount > 0) map.garbage[i] = Math.min(100, map.garbage[i] + amount * GARBAGE_BUILDUP);
    if (map.garbage[i] >= 50) dirty++;
  }
  garbage.dirtyShare = lots ? dirty / lots : 0;
  stats.garbage = garbage;
}
