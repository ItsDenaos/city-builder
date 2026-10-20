import { DAYS_PER_MONTH, MONTHS_PER_YEAR } from '../config';
import type { GameState } from '../state';
import type { SimEvent } from '../types';

/** Avanza un día. Calendario simplificado: 12 meses de 30 días. */
export function advanceTime(state: GameState): SimEvent[] {
  const t = state.time;
  const events: SimEvent[] = [];
  t.tick++;
  t.day++;
  if (t.day > DAYS_PER_MONTH) {
    t.day = 1;
    t.month++;
    if (t.month > MONTHS_PER_YEAR) {
      t.month = 1;
      t.year++;
      events.push({ type: 'newYear', year: t.year });
    }
    events.push({ type: 'newMonth', month: t.month, year: t.year });
  }
  return events;
}
