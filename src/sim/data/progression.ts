// Progresión de AKROPOLIS: rangos de ciudad y reglas del terreno comprable.

export interface RankDef {
  id: string;
  name: string;
  /** Artículo para las frases ("ya es una villa"). */
  article: 'un' | 'una';
  /** Población máxima alcanzada necesaria. */
  population: number;
  /** Subvención que se recibe al alcanzarlo. */
  grant: number;
  /** Parcelas de terreno que se pueden poseer con este rango. */
  maxPlots: number;
}

export const RANKS: readonly RankDef[] = [
  { id: 'aldea', name: 'Aldea', article: 'una', population: 0, grant: 0, maxPlots: 4 },
  { id: 'pueblo', name: 'Pueblo', article: 'un', population: 500, grant: 5_000, maxPlots: 5 },
  { id: 'villa', name: 'Villa', article: 'una', population: 1_000, grant: 10_000, maxPlots: 6 },
  { id: 'ciudad', name: 'Ciudad', article: 'una', population: 2_000, grant: 15_000, maxPlots: 8 },
  { id: 'gran-ciudad', name: 'Gran ciudad', article: 'una', population: 5_000, grant: 25_000, maxPlots: 10 },
  { id: 'metropolis', name: 'Metrópolis', article: 'una', population: 15_000, grant: 40_000, maxPlots: 13 },
  { id: 'akropolis', name: 'Akropolis', article: 'una', population: 40_000, grant: 75_000, maxPlots: Infinity },
];

/** Índice del rango que corresponde a una población máxima. */
export function rankFor(peakPopulation: number): number {
  let r = 0;
  for (let k = 0; k < RANKS.length; k++) if (peakPopulation >= RANKS[k].population) r = k;
  return r;
}

/** Lado de cada parcela de terreno, en casillas. */
export const PLOT_SIZE = 32;
/** Parcelas con las que se empieza (un cuadrado de 2 × 2). */
export const START_PLOTS = 2;

/** Precio de la siguiente parcela: cada compra encarece la siguiente. */
export function plotCost(bought: number): number {
  return 15_000 + bought * 10_000;
}
