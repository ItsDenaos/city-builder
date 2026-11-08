import type { ZoneType } from '../types';

/**
 * Ordenanzas (fase 13): políticas con un coste mensual fijo y un efecto. Se pueden tener activas
 * MAX_ORDINANCES a la vez. Para añadir una basta con una entrada nueva: la lista del panel, el coste
 * y los efectos se leen de aquí (los efectos los consulta effects.ts).
 */
export interface OrdinanceDef {
  id: string;
  name: string;
  /** Qué hace, en una frase. */
  summary: string;
  /** Coste mensual. */
  cost: number;
  unlockAtPopulation: number;
  /** Felicidad que se suma a todos los vecinos. */
  happiness?: number;
  /** Multiplicador del crimen de la ciudad. */
  crime?: number;
  /** Multiplicador de la contaminación de la industria. */
  industryPollution?: number;
  /** Multiplicador del consumo de agua. */
  waterDemand?: number;
  /** Demanda extra por tipo de zona. */
  demand?: Partial<Record<ZoneType, number>>;
  /** Multiplicador de la recaudación por tipo de zona. */
  taxIncome?: Partial<Record<ZoneType, number>>;
}

export const ORDINANCES: readonly OrdinanceDef[] = [
  {
    id: 'neighborhood_watch', name: 'Vigilancia vecinal', cost: 120, unlockAtPopulation: 500,
    summary: 'El crimen baja un 20 %, pero los vecinos se sienten vigilados (−1 de felicidad).',
    crime: 0.8, happiness: -1,
  },
  {
    id: 'industrial_filters', name: 'Filtros industriales', cost: 200, unlockAtPopulation: 1_000,
    summary: 'La industria contamina un 40 % menos; la recaudación industrial baja un 8 %.',
    industryPollution: 0.6, taxIncome: { I: 0.92 },
  },
  {
    id: 'water_saving', name: 'Ahorro de agua', cost: 80, unlockAtPopulation: 500,
    summary: 'Campañas y contadores: el consumo de agua baja un 20 %.',
    waterDemand: 0.8,
  },
  {
    id: 'shop_incentives', name: 'Incentivos al comercio', cost: 150, unlockAtPopulation: 1_000,
    summary: 'Ayudas a los negocios: más demanda comercial (+0,05) y un 5 % menos de recaudación comercial.',
    demand: { C: 0.05 }, taxIncome: { C: 0.95 },
  },
  {
    id: 'industrial_park', name: 'Fomento industrial', cost: 150, unlockAtPopulation: 1_500,
    summary: 'Suelo barato para fábricas: más demanda industrial (+0,05), pero a los vecinos no les gusta (−1 de felicidad).',
    demand: { I: 0.05 }, happiness: -1,
  },
  {
    id: 'city_festivals', name: 'Fiestas populares', cost: 250, unlockAtPopulation: 2_000,
    summary: 'La ciudad celebra más: +3 de felicidad en todos los barrios.',
    happiness: 3,
  },
];

const BY_ID = new Map(ORDINANCES.map((o) => [o.id, o]));

export const getOrdinance = (id: string): OrdinanceDef | undefined => BY_ID.get(id);
