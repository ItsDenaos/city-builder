import { ZONE_CODE } from '../data/zones';
import type { GameState } from '../state';

export interface ResidentAverages {
  residents: number;
  police: number;
  fire: number;
  health: number;
  education: number;
  crime: number;
  pollution: number;
  landValue: number;
}

/** Medias de lo que viven los habitantes, ponderadas por ocupantes de cada lote residencial. */
export function residentAverages(state: GameState): ResidentAverages {
  const { map, layers } = state;
  const { coverage } = layers;
  const avg: ResidentAverages = { residents: 0, police: 0, fire: 0, health: 0, education: 0, crime: 0, pollution: 0, landValue: 0 };
  for (let i = 0; i < map.zoneType.length; i++) {
    if (map.zoneType[i] !== ZONE_CODE.R || !map.lotOccupants[i]) continue;
    const n = map.lotOccupants[i];
    avg.residents += n;
    avg.police += coverage.police[i] * n;
    avg.fire += coverage.fire[i] * n;
    avg.health += coverage.health[i] * n;
    avg.education += coverage.education[i] * n;
    avg.crime += layers.crime[i] * n;
    avg.pollution += layers.pollution[i] * n;
    avg.landValue += layers.landValue[i] * n;
  }
  const d = avg.residents || 1;
  for (const k of ['police', 'fire', 'health', 'education', 'crime', 'pollution', 'landValue'] as const) avg[k] /= d;
  return avg;
}

export function unemploymentRate(state: GameState): number {
  const { workforce, employed } = state.stats;
  return workforce ? Math.max(0, workforce - employed) / workforce : 0;
}

export function countBuildings(state: GameState, defId: string): number {
  let n = 0;
  for (const b of state.buildings.values()) if (b.defId === defId) n++;
  return n;
}
