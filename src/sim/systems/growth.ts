import {
  DEVELOP_CHANCE,
  INDUSTRY_LEVEL_EDUCATION,
  LEVEL_LAND_VALUE,
  LEVEL_UP_CHANCE,
  LEVEL_UP_MIN_DEMAND,
  MOVE_OUT_DEMAND,
  OCCUPANCY_STEP,
  UNHAPPY_MOVE_OUT,
} from '../config';
import { MAX_LOT_LEVEL, ZONE_BY_CODE, getZoneDefByCode } from '../data/zones';
import { random } from '../rng';
import type { GameState } from '../state';
import { hasRoadAccess } from './access';

/**
 * Un paso diario de crecimiento por cada casilla zonificada:
 * - Lote vacío con acceso y demanda > 0 → aparece un edificio de nivel 1 (probabilidad ∝ demanda).
 * - R: entran habitantes si hay demanda, se van si es muy negativa.
 * - C/I: contratan desempleados hasta llenarse; despiden si faltan trabajadores.
 * - Lote lleno con demanda → puede subir de nivel (más capacidad) si el valor del suelo lo permite
 *   (R y C) o si hay educación suficiente (I).
 * - R: con felicidad por debajo de UNHAPPY_MOVE_OUT los vecinos se van aunque haya demanda.
 * - Sin acceso vial o sin electricidad se vacía y, al quedar vacío, el edificio desaparece.
 * - Sin agua no pasa del nivel 1: su capacidad se limita a la del nivel 1 y no sube de nivel.
 */
export function growLots(state: GameState): void {
  const { map, stats } = state;
  const size = map.width * map.height;
  let unemployed = stats.workforce - stats.employed; // negativo = faltan trabajadores
  // Empezar en una casilla aleatoria para no favorecer siempre la esquina superior izquierda
  const start = Math.floor(random(state) * size);

  for (let k = 0; k < size; k++) {
    const i = (start + k) % size;
    const code = map.zoneType[i];
    if (!code || map.fire[i]) continue; // un edificio en llamas no crece ni se llena
    const type = ZONE_BY_CODE[code]!;
    const demand = stats.demand[type];
    const level = map.lotLevel[i];
    const access = hasRoadAccess(state, i);
    const powered = state.layers.powered[i] === 1;
    const watered = state.layers.watered[i] === 1;

    if (level === 0) {
      if (access && powered && demand > 0 && random(state) < DEVELOP_CHANCE * demand) map.lotLevel[i] = 1;
      continue;
    }

    const caps = getZoneDefByCode(code, map.zoneDensity[i]).capacity;
    const capacity = watered ? caps[level - 1] : Math.min(caps[level - 1], caps[0]);
    let occ = Math.min(map.lotOccupants[i], capacity);
    const step = Math.max(1, Math.ceil(capacity * OCCUPANCY_STEP));

    if (!access || !powered) {
      const leaving = Math.min(step, occ);
      occ -= leaving;
      if (type !== 'R') unemployed += leaving;
      if (occ === 0) map.lotLevel[i] = 0;
    } else if (type === 'R') {
      const unhappy = state.layers.happiness[i] < UNHAPPY_MOVE_OUT;
      if (unhappy || demand < MOVE_OUT_DEMAND) occ = Math.max(0, occ - step);
      else if (demand > 0) occ = Math.min(capacity, occ + step);
    } else if (unemployed > 0 && occ < capacity) {
      const hired = Math.min(step, capacity - occ, unemployed);
      occ += hired;
      unemployed -= hired;
    } else if (unemployed < 0 && occ > 0) {
      const fired = Math.min(step, occ, -unemployed);
      occ -= fired;
      unemployed += fired;
    }

    const next = level + 1;
    const qualifies =
      type === 'I'
        ? state.layers.coverage.education[i] >= INDUSTRY_LEVEL_EDUCATION[next]
        : state.layers.landValue[i] >= LEVEL_LAND_VALUE[next];
    if (
      access && powered && watered && qualifies && occ === capacity && level < MAX_LOT_LEVEL &&
      demand > LEVEL_UP_MIN_DEMAND && random(state) < LEVEL_UP_CHANCE
    ) {
      map.lotLevel[i] = next;
    }
    map.lotOccupants[i] = occ;
  }
}
