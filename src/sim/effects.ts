import { type OrdinanceDef, getOrdinance } from './data/ordinances';
import type { ActiveEffect, GameState } from './state';
import type { ZoneType } from './types';

/**
 * Efectos temporales de los eventos (ola de calor, recesión, festival...) y efectos permanentes de
 * las ordenanzas activas. Cada sistema pregunta aquí por lo que le toca; un evento dura `monthsLeft`
 * cierres de mes, una ordenanza hasta que se derogue.
 */
export function addEffect(state: GameState, effect: ActiveEffect): void {
  const fx = state.incidents.effects.filter((e) => e.id !== effect.id);
  fx.push(effect);
  state.incidents.effects = fx;
}

/** Ordenanzas activas (ignora ids que ya no existan en el catálogo). */
export function activeOrdinances(state: GameState): OrdinanceDef[] {
  return state.economy.ordinances.flatMap((id) => getOrdinance(id) ?? []);
}

/** Demanda extra (o menos demanda) de un tipo de zona. */
export const effectDemand = (state: GameState, zone: ZoneType) =>
  state.incidents.effects.reduce((sum, e) => sum + (e.demand?.[zone] ?? 0), 0) +
  activeOrdinances(state).reduce((sum, o) => sum + (o.demand?.[zone] ?? 0), 0);

/** Puntos de felicidad que se suman a todos los vecinos. */
export const effectHappiness = (state: GameState) =>
  state.incidents.effects.reduce((sum, e) => sum + (e.happiness ?? 0), 0) +
  activeOrdinances(state).reduce((sum, o) => sum + (o.happiness ?? 0), 0);

/** Multiplicador del consumo de agua. */
export const effectWaterDemand = (state: GameState) =>
  activeOrdinances(state).reduce((m, o) => m * (o.waterDemand ?? 1), state.incidents.effects.reduce((m, e) => m * (e.waterDemand ?? 1), 1));

/** Multiplicador de la recaudación de un tipo de zona. */
export const effectTaxIncome = (state: GameState, zone: ZoneType) =>
  activeOrdinances(state).reduce((m, o) => m * (o.taxIncome?.[zone] ?? 1), state.incidents.effects.reduce((m, e) => m * (e.taxIncome?.[zone] ?? 1), 1));

/** Multiplicador del crimen de la ciudad (ordenanzas). */
export const effectCrime = (state: GameState) => activeOrdinances(state).reduce((m, o) => m * (o.crime ?? 1), 1);

/** Multiplicador de la basura que produce la ciudad (ordenanzas). */
export const effectGarbage = (state: GameState) => activeOrdinances(state).reduce((m, o) => m * (o.garbage ?? 1), 1);

/** Multiplicador de la contaminación de la industria (ordenanzas). */
export const effectIndustryPollution = (state: GameState) => activeOrdinances(state).reduce((m, o) => m * (o.industryPollution ?? 1), 1);
