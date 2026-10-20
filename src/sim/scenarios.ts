import { getScenario } from './data/scenarios';
import { refreshDerived } from './simulation';
import { type GameState, createGame } from './state';

/** Nivel de eventos y desastres de los escenarios: «pocos». */
const SCENARIO_INCIDENTS = 1;

/** Crea la partida de un escenario: mapa, preparación y plazo. */
export function createScenario(id: string): GameState {
  const def = getScenario(id);
  if (!def) throw new Error('Escenario desconocido');
  const state = createGame({ ...def.options, name: def.name });
  def.prepare?.(state);
  refreshDerived(state);
  state.time.speed = 1;
  state.scenario = { id, startYear: state.time.year, endYear: state.time.year + def.years, status: 'active' };
  // Los escenarios tienen algunos imprevistos (se activan después de preparar la ciudad de partida)
  state.incidents.level = SCENARIO_INCIDENTS;
  return state;
}

/** Avance de cada objetivo del escenario en curso (vacío si no hay escenario). */
export function scenarioGoals(state: GameState): { label: string; progress: number }[] {
  const def = state.scenario && getScenario(state.scenario.id);
  return def ? def.goals.map((g) => ({ label: g.label, progress: g.progress(state) })) : [];
}
