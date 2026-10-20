import { applyCommand } from '../src/sim/commands';
import { type GameState, tileIndex } from '../src/sim/state';
import { TERRAIN_WATER } from '../src/sim/types';

/**
 * Carretera desde el borde superior hacia abajo por x = 10, con zonas a ambos lados
 * y una central de carbón pegada a la zona industrial (las zonas conducen la electricidad).
 */
export function smallTown(s: GameState) {
  applyCommand(s, { type: 'buildRoad', from: { x: 10, y: 0 }, to: { x: 10, y: 30 } });
  applyCommand(s, { type: 'zone', rect: { x0: 7, y0: 0, x1: 9, y1: 20 }, zone: 'R', density: 'low' });
  applyCommand(s, { type: 'zone', rect: { x0: 11, y0: 0, x1: 13, y1: 10 }, zone: 'C', density: 'low' });
  applyCommand(s, { type: 'zone', rect: { x0: 11, y0: 11, x1: 13, y1: 30 }, zone: 'I', density: 'low' });
  applyCommand(s, { type: 'placeBuilding', defId: 'coal_plant', at: { x: 14, y: 26 } });
}

/** Bomba junto a un lago (esquina superior derecha), alimentada con tendido, y tuberías que cubren las zonas de smallTown. */
export function addWater(s: GameState) {
  for (let y = 0; y <= 2; y++) for (let x = 20; x <= 22; x++) s.map.terrain[tileIndex(s.map, x, y)] = TERRAIN_WATER;
  applyCommand(s, { type: 'placeBuilding', defId: 'water_pump', at: { x: 18, y: 0 } });
  applyCommand(s, { type: 'buildPowerLine', from: { x: 14, y: 1 }, to: { x: 17, y: 1 } });
  applyCommand(s, { type: 'buildPipe', from: { x: 8, y: 0 }, to: { x: 17, y: 0 } });
  applyCommand(s, { type: 'buildPipe', from: { x: 8, y: 0 }, to: { x: 8, y: 30 } });
  applyCommand(s, { type: 'buildPipe', from: { x: 12, y: 0 }, to: { x: 12, y: 30 } });
}

/** Policía, bomberos, clínica y escuela pegados a la zona residencial de smallTown (reciben electricidad a través de ella). */
export function addServices(s: GameState) {
  applyCommand(s, { type: 'placeBuilding', defId: 'police_station', at: { x: 5, y: 0 } });
  applyCommand(s, { type: 'placeBuilding', defId: 'fire_station', at: { x: 5, y: 3 } });
  applyCommand(s, { type: 'placeBuilding', defId: 'clinic', at: { x: 5, y: 6 } });
  applyCommand(s, { type: 'placeBuilding', defId: 'elementary_school', at: { x: 4, y: 9 } });
}
