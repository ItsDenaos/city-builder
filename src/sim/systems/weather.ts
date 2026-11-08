import { SEASON_WEATHER, WEATHER, type WeatherDef, type WeatherKind, seasonOf } from '../data/weather';
import { random } from '../rng';
import type { GameState } from '../state';
import type { SimEvent } from '../types';

/**
 * Clima (fase 20): cada día se descuenta uno al tiempo actual y, cuando se acaba, se sortea el siguiente
 * según la estación. Usa su propio generador (state.weather.rng) para que el clima no altere la simulación:
 * una partida con el mismo mapa y las mismas órdenes sigue igual llueva o no.
 */
export function updateWeather(state: GameState, events: SimEvent[]): void {
  const w = state.weather;
  if (--w.daysLeft > 0) return;
  const weights = SEASON_WEATHER[seasonOf(state.time.month)];
  const kinds = Object.keys(weights) as WeatherKind[];
  const total = kinds.reduce((sum, k) => sum + (weights[k] ?? 0), 0);
  let pick = random(w) * total;
  let next: WeatherKind = kinds[kinds.length - 1];
  for (const k of kinds) {
    pick -= weights[k] ?? 0;
    if (pick < 0) {
      next = k;
      break;
    }
  }
  const [min, max] = WEATHER[next].days;
  w.daysLeft = min + Math.floor(random(w) * (max - min + 1));
  if (next !== w.kind && (next === 'storm' || next === 'snow')) events.push({ type: 'weather', kind: next });
  w.kind = next;
}

/** El tiempo que hace hoy. */
export const currentWeather = (state: GameState): WeatherDef => WEATHER[state.weather.kind];
