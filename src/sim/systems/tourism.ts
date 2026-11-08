import {
  MONUMENT_PRIDE,
  TAX_NEUTRAL,
  TOURISM_QUALITY_MAX,
  TOURISM_QUALITY_MIN,
  TOURIST_SPENDING,
  TRAIN_TOURISM_BOOST,
  TRAIN_TOURIST_SHARE,
  VISITORS_PER_ATTRACTION,
} from '../config';
import { getBuildingDef } from '../data/buildings';
import { type BuildingInstance, type GameState, newTourismStats, tileIndex } from '../state';
import { hasRoadAccess } from './access';
import { residentAverages } from './metrics';

/**
 * Monumentos y turismo (fase 19), en la simulación agregada. Cada monumento en servicio suma su atractivo;
 * los visitantes diarios son ese atractivo por la calidad de la ciudad (felicidad media y seguridad) y
 * por la estación de tren, si la hay. Los turistas gastan (ingreso de turismo, que sigue al impuesto
 * comercial), piden comercio (demand.ts) y llegan en coche desde el borde del mapa hasta los monumentos
 * (traffic.ts) o en tren. Además, cada monumento da orgullo de ciudad: felicidad en todas las viviendas.
 * Sin monumentos no hay turismo.
 */

/** Por qué un monumento no recibe visitas, o null si las recibe. */
export function monumentProblem(state: GameState, b: BuildingInstance): string | null {
  const def = getBuildingDef(b.defId);
  if (!def?.monument) return null;
  const { map } = state;
  let access = false;
  for (let y = b.y; y < b.y + b.h && !access; y++) for (let x = b.x; x < b.x + b.w && !access; x++) access = hasRoadAccess(state, tileIndex(map, x, y));
  if (!access) return 'Sin acceso a una calle conectada';
  if (def.power?.consumes && !state.layers.powered[tileIndex(map, b.x, b.y)]) return 'Sin electricidad';
  return null;
}

/** Monumentos en servicio. */
export function activeMonuments(state: GameState): BuildingInstance[] {
  return [...state.buildings.values()].filter((b) => getBuildingDef(b.defId)?.monument && !monumentProblem(state, b));
}

/** Felicidad que el orgullo de ciudad suma a todas las viviendas. */
export function monumentPride(state: GameState): number {
  return state.stats.tourism.monuments * MONUMENT_PRIDE;
}

/** Calidad de la ciudad para los turistas: felicidad media y seguridad. */
export function tourismQuality(state: GameState): number {
  const crime = residentAverages(state).crime;
  const mood = (state.stats.happiness - 20) / 50;
  return Math.max(TOURISM_QUALITY_MIN, Math.min(TOURISM_QUALITY_MAX, mood * (1 - Math.min(0.5, crime / 100))));
}

/** Turismo del día (después de la influencia: necesita la felicidad y el crimen). */
export function computeTourism(state: GameState): void {
  const monuments = activeMonuments(state);
  if (!monuments.length) {
    state.stats.tourism = newTourismStats();
    return;
  }
  const attraction = monuments.reduce((sum, b) => sum + getBuildingDef(b.defId)!.monument!.attraction, 0);
  const quality = tourismQuality(state);
  const train = state.stats.transit.trainStations > 0;
  const visitors = attraction * VISITORS_PER_ATTRACTION * quality * (train ? TRAIN_TOURISM_BOOST : 1);
  state.stats.tourism = {
    monuments: monuments.length,
    attraction,
    quality,
    visitors,
    byTrain: train ? visitors * TRAIN_TOURIST_SHARE : 0,
    revenue: visitors * TOURIST_SPENDING * (state.economy.taxes.C / TAX_NEUTRAL),
  };
}

/** Visitantes de un monumento concreto (su parte del atractivo total). */
export function monumentVisitors(state: GameState, b: BuildingInstance): number {
  const t = state.stats.tourism;
  const def = getBuildingDef(b.defId);
  if (!def?.monument || !t.attraction || monumentProblem(state, b)) return 0;
  return (t.visitors * def.monument.attraction) / t.attraction;
}
