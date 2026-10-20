import { ACHIEVEMENTS } from '../data/achievements';
import { BUILDINGS } from '../data/buildings';
import { RANKS, rankFor } from '../data/progression';
import { getScenario } from '../data/scenarios';
import { ZONES } from '../data/zones';
import type { GameState } from '../state';
import type { SimEvent } from '../types';

const UNLOCKABLES = [
  ...ZONES.map((z) => ({ name: z.label, at: z.unlockAtPopulation })),
  ...BUILDINGS.map((b) => ({ name: b.name, at: b.unlockAtPopulation })),
].filter((u) => u.at > 0);

/** Lo que se desbloquea al pasar de una población máxima a otra. */
export function unlocksBetween(from: number, to: number): string[] {
  return UNLOCKABLES.filter((u) => u.at > from && u.at <= to).map((u) => u.name);
}

/**
 * Progresión diaria y mensual:
 * - población máxima, desbloqueos y rango (con su subvención);
 * - al cerrar el mes: racha de balances positivos, logros y objetivos del escenario.
 * Va después del cierre de mes del presupuesto.
 */
export function updateProgress(state: GameState, events: SimEvent[]): void {
  const p = state.progress;
  const prev = p.peakPopulation;
  const pop = state.stats.population;
  if (pop > prev) {
    p.peakPopulation = pop;
    // En el modo libre todo está desbloqueado desde el principio y no hay subvenciones
    const free = state.sandbox;
    if (!free) for (const name of unlocksBetween(prev, pop)) events.push({ type: 'unlock', name, population: UNLOCKABLES.find((u) => u.name === name)!.at });
    const rank = rankFor(pop);
    while (p.rank < rank) {
      p.rank++;
      const r = RANKS[p.rank];
      const grant = free ? 0 : r.grant;
      state.economy.money += grant;
      events.push({ type: 'rankUp', rank: p.rank, grant, unlocks: free ? [] : unlocksBetween(RANKS[p.rank - 1].population, r.population) });
    }
  }

  if (!events.some((e) => e.type === 'newMonth')) return;
  p.monthsPositive = (state.economy.lastMonth?.net ?? 0) > 0 ? p.monthsPositive + 1 : 0;

  for (const a of ACHIEVEMENTS) {
    if (state.sandbox || p.achievements.includes(a.id) || !a.check(state)) continue;
    p.achievements.push(a.id);
    events.push({ type: 'achievement', id: a.id, name: a.name });
  }

  const sc = state.scenario;
  const def = sc && sc.status === 'active' ? getScenario(sc.id) : null;
  if (sc && def) {
    if (def.goals.every((g) => g.progress(state) >= 1)) {
      sc.status = 'won';
      events.push({ type: 'scenarioEnd', won: true, id: sc.id });
    } else if (state.time.year >= sc.endYear) {
      sc.status = 'lost';
      events.push({ type: 'scenarioEnd', won: false, id: sc.id });
    }
  }
}
