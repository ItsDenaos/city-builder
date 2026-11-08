/**
 * Clima (fase 20). Cada tiempo dura unos días y el siguiente se sortea según la estación, con un clima
 * mediterráneo: veranos secos, otoños y primaveras lluviosos, nieve solo en invierno.
 * Casi todo es ambiente (dibujo y sonido); en la simulación solo cambia el riesgo de incendio.
 */
export type WeatherKind = 'clear' | 'clouds' | 'rain' | 'storm' | 'fog' | 'snow';
export type Season = 'winter' | 'spring' | 'summer' | 'autumn';

export interface WeatherDef {
  kind: WeatherKind;
  label: string;
  /** Multiplicadores del riesgo de que empiece un incendio, de que se propague y de apagarlo. */
  fireRisk: number;
  fireSpread: number;
  extinguish: number;
  /** Días que dura, entre estos dos (ambos incluidos). */
  days: [number, number];
}

export const WEATHER: Record<WeatherKind, WeatherDef> = {
  clear: { kind: 'clear', label: 'Despejado', fireRisk: 1, fireSpread: 1, extinguish: 1, days: [3, 8] },
  clouds: { kind: 'clouds', label: 'Nublado', fireRisk: 0.8, fireSpread: 0.9, extinguish: 1, days: [2, 5] },
  rain: { kind: 'rain', label: 'Lluvia', fireRisk: 0.3, fireSpread: 0.4, extinguish: 1.6, days: [2, 4] },
  // Los rayos prenden fuego, pero la lluvia lo frena
  storm: { kind: 'storm', label: 'Tormenta', fireRisk: 1.5, fireSpread: 0.5, extinguish: 1.4, days: [1, 2] },
  fog: { kind: 'fog', label: 'Niebla', fireRisk: 0.7, fireSpread: 0.8, extinguish: 1, days: [1, 3] },
  snow: { kind: 'snow', label: 'Nieve', fireRisk: 0.3, fireSpread: 0.3, extinguish: 1.3, days: [2, 4] },
};

/** Pesos de cada tiempo por estación (no hace falta que sumen 1). */
export const SEASON_WEATHER: Record<Season, Partial<Record<WeatherKind, number>>> = {
  winter: { clear: 3, clouds: 3, rain: 2, fog: 2, snow: 1.5, storm: 0.2 },
  spring: { clear: 4, clouds: 3, rain: 2.5, storm: 0.8, fog: 0.5 },
  summer: { clear: 7, clouds: 1.5, storm: 1.2, rain: 0.3 },
  autumn: { clear: 3, clouds: 3, rain: 3, storm: 1, fog: 1.5 },
};

export const SEASON_LABEL: Record<Season, string> = { winter: 'invierno', spring: 'primavera', summer: 'verano', autumn: 'otoño' };

/** Estación de un mes (1-12): invierno de diciembre a febrero. */
export function seasonOf(month: number): Season {
  if (month === 12 || month <= 2) return 'winter';
  if (month <= 5) return 'spring';
  if (month <= 8) return 'summer';
  return 'autumn';
}
