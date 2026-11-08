import { HEALTH_BASE, HEALTH_COVERAGE, HEALTH_GARBAGE, HEALTH_POLLUTION, HEALTH_SICK, SICK_HAPPINESS, SICK_MAX, UNTREATED_HAPPINESS } from '../config';
import { getBuildingDef } from '../data/buildings';
import { ZONE_CODE } from '../data/zones';
import { type GameState, tileIndex } from '../state';
import { hasRoadAccess } from './access';
import { excessGarbage } from './garbage';

const clamp100 = (v: number) => Math.max(0, Math.min(100, v));

/**
 * Salud de los vecinos (fase 14). Cada vivienda tiene un índice 0-100: la cobertura sanitaria suma y la
 * contaminación y la basura acumulada restan. Con salud baja una parte de los vecinos enferma: no trabaja
 * (demand.ts descuenta los enfermos de la población activa) y necesita cama en una clínica u hospital.
 * Sin `sanitation` el índice se calcula igual (para verlo), pero nadie enferma.
 * Se llama desde computeInfluence, con la cobertura y la contaminación del día ya calculadas.
 */
export function computeHealth(state: GameState): void {
  const { map, layers, stats } = state;
  const { coverage, pollution, health, sick } = layers;
  health.fill(0);
  sick.fill(0);
  let residents = 0;
  let weighted = 0;
  let sickTotal = 0;
  for (let i = 0; i < health.length; i++) {
    if (map.zoneType[i] !== ZONE_CODE.R || !map.lotLevel[i]) continue;
    const h = clamp100(HEALTH_BASE + coverage.health[i] * HEALTH_COVERAGE - pollution[i] * HEALTH_POLLUTION - excessGarbage(map.garbage[i]) * HEALTH_GARBAGE);
    health[i] = h;
    if (state.sanitation) sick[i] = SICK_MAX * Math.max(0, Math.min(1, (HEALTH_SICK - h) / HEALTH_SICK));
    const occ = map.lotOccupants[i];
    weighted += h * occ;
    residents += occ;
    sickTotal += occ * sick[i];
  }
  // Camas: clínicas y hospitales con electricidad y calle (más financiación, más camas)
  let beds = 0;
  const funding = state.economy.funding.health / 100;
  for (const b of state.buildings.values()) {
    const def = getBuildingDef(b.defId);
    const i = tileIndex(map, b.x, b.y);
    if (def?.beds && layers.powered[i] && hasRoadAccess(state, i)) beds += def.beds * funding;
  }
  stats.health = { average: residents ? weighted / residents : HEALTH_BASE, sick: sickTotal, beds, treated: Math.min(sickTotal, beds) };
}

/** Felicidad que quita la enfermedad en un lote: estar enfermo, y más si no hay camas para todos. */
export function sicknessPenalty(state: GameState, i: number): number {
  const s = state.layers.sick[i];
  if (!s) return 0;
  const { sick, treated } = state.stats.health;
  const untreated = sick > 0 ? 1 - treated / sick : 0;
  return s * (SICK_HAPPINESS + untreated * UNTREATED_HAPPINESS);
}
