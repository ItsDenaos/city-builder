import { STATS_HISTORY_MONTHS } from '../config';
import type { GameState } from '../state';
import type { SimEvent } from '../types';

/** Guarda una muestra de las estadísticas al cerrar cada mes (después del presupuesto). */
export function recordHistory(state: GameState, events: SimEvent[]): void {
  const month = events.find((e) => e.type === 'newMonth');
  if (!month || month.type !== 'newMonth') return;
  const { stats, economy } = state;
  state.history.push({
    month: month.month,
    year: month.year,
    population: stats.population,
    money: economy.money,
    happiness: stats.happiness,
    unemployment: stats.workforce ? Math.max(0, stats.workforce - stats.employed) / stats.workforce : 0,
    demand: { ...stats.demand },
    income: economy.lastMonth?.totalIncome ?? 0,
    expenses: economy.lastMonth?.totalExpenses ?? 0,
    commute: stats.traffic.avgCommute,
  });
  if (state.history.length > STATS_HISTORY_MONTHS) state.history.shift();
}
