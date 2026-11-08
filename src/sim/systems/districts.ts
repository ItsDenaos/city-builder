import { ZONE_CODE } from '../data/zones';
import type { District, GameState } from '../state';

export interface DistrictStats {
  tiles: number;
  /** Habitantes de los lotes residenciales. */
  population: number;
  /** Trabajadores de comercios e industrias. */
  workers: number;
  /** Felicidad media de los habitantes (0 si no hay). */
  happiness: number;
  /** Contaminación y crimen medios de las casillas del distrito, 0-100. */
  pollution: number;
  crime: number;
}

/** Datos del distrito sobre el estado actual (se calcula al pintar el panel, no se guarda). */
export function districtStats(state: GameState, d: District): DistrictStats {
  const { map, layers } = state;
  let tiles = 0;
  let population = 0;
  let workers = 0;
  let happy = 0;
  let pollution = 0;
  let crime = 0;
  for (let y = d.y0; y <= d.y1; y++) {
    for (let x = d.x0; x <= d.x1; x++) {
      const i = y * map.width + x;
      tiles++;
      pollution += layers.pollution[i];
      crime += layers.crime[i];
      if (!map.lotLevel[i]) continue;
      if (map.zoneType[i] === ZONE_CODE.R) {
        population += map.lotOccupants[i];
        happy += layers.happiness[i] * map.lotOccupants[i];
      } else {
        workers += map.lotOccupants[i];
      }
    }
  }
  return {
    tiles,
    population,
    workers,
    happiness: population ? happy / population : 0,
    pollution: tiles ? pollution / tiles : 0,
    crime: tiles ? crime / tiles : 0,
  };
}
