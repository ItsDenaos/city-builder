import type { GameState } from './state';
import { computeRoadAccess } from './systems/access';
import { advise } from './systems/advisor';
import { updateAgora } from './systems/agora';
import { computeStats, updateDemand } from './systems/demand';
import { settleMonth } from './systems/economy';
import { recordHistory } from './systems/history';
import { growLots } from './systems/growth';
import { updateIncidents } from './systems/incidents';
import { computeInfluence } from './systems/influence';
import { updateProgress } from './systems/progress';
import { advanceTime } from './systems/time';
import { computeTraffic } from './systems/traffic';
import { computePower, computeWater } from './systems/utilities';
import type { SimEvent } from './types';

/** Un sistema recibe el estado y los eventos del día (y puede añadir más); se ejecutan en orden. */
type System = (state: GameState, events: SimEvent[]) => void;

const SYSTEMS: System[] = [
  computeRoadAccess,
  computePower,
  computeWater, // después de la electricidad: las bombas la necesitan
  computeStats,
  computeTraffic, // necesita la ocupación de los lotes
  computeInfluence, // necesita el empleo y los trayectos para la felicidad
  updateDemand,
  growLots,
  updateIncidents, // incendios (necesitan la cobertura de bomberos), averías y eventos
  computeStats, // otra vez, para que la UI vea el resultado del día
  settleMonth,
  recordHistory,
  updateProgress,
  advise,
  updateAgora, // al final: los vecinos hablan de cómo ha quedado el día
];

/** Avanza la simulación un día de juego. */
export function tick(state: GameState): SimEvent[] {
  const events = advanceTime(state);
  for (const system of SYSTEMS) system(state, events);
  return events;
}

/**
 * Recalcula las capas derivadas sin avanzar el tiempo (tras cargar una partida).
 * Si se pasa el tráfico guardado se conserva tal cual (es la única capa con memoria, porque se suaviza
 * día a día), así la partida sigue exactamente igual; si no, se repite para que converja.
 */
export function refreshDerived(state: GameState, savedTraffic?: Float32Array): void {
  computeRoadAccess(state);
  computePower(state);
  computeWater(state);
  computeStats(state);
  if (savedTraffic) {
    state.layers.traffic.set(savedTraffic);
    computeTraffic(state); // para los trayectos
    state.layers.traffic.set(savedTraffic);
  } else {
    for (let k = 0; k < 10; k++) computeTraffic(state);
  }
  computeInfluence(state);
}
