import type { ActiveEffect, GameState } from './state';
import type { ZoneType } from './types';

/**
 * Efectos temporales de los eventos (ola de calor, recesión, festival...). Cada sistema pregunta
 * aquí por lo que le toca; un efecto dura `monthsLeft` cierres de mes.
 */
export function addEffect(state: GameState, effect: ActiveEffect): void {
  const fx = state.incidents.effects.filter((e) => e.id !== effect.id);
  fx.push(effect);
  state.incidents.effects = fx;
}

/** Demanda extra (o menos demanda) de un tipo de zona. */
export const effectDemand = (state: GameState, zone: ZoneType) => state.incidents.effects.reduce((sum, e) => sum + (e.demand?.[zone] ?? 0), 0);

/** Puntos de felicidad que se suman a todos los vecinos. */
export const effectHappiness = (state: GameState) => state.incidents.effects.reduce((sum, e) => sum + (e.happiness ?? 0), 0);

/** Multiplicador del consumo de agua. */
export const effectWaterDemand = (state: GameState) => state.incidents.effects.reduce((m, e) => m * (e.waterDemand ?? 1), 1);

/** Multiplicador de la recaudación de un tipo de zona. */
export const effectTaxIncome = (state: GameState, zone: ZoneType) => state.incidents.effects.reduce((m, e) => m * (e.taxIncome?.[zone] ?? 1), 1);
