export type ZoneType = 'R' | 'C' | 'I';
export type Density = 'low' | 'medium' | 'high';
export type Speed = 0 | 1 | 2 | 3;

export interface Point {
  x: number;
  y: number;
}

/** Rectángulo de casillas, inclusivo y normalizado (x0 <= x1, y0 <= y1). */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const TERRAIN_LAND = 0;
export const TERRAIN_WATER = 1;

export type SimEvent =
  | { type: 'newMonth'; month: number; year: number }
  | { type: 'newYear'; year: number }
  | { type: 'unlock'; name: string; population: number }
  | { type: 'advice'; text: string }
  | { type: 'loanPaidOff'; amount: number }
  | { type: 'bankrupt' }
  | { type: 'rankUp'; rank: number; grant: number; unlocks: string[] }
  | { type: 'achievement'; id: string; name: string }
  | { type: 'scenarioEnd'; id: string; won: boolean }
  /** Un evento espera la decisión del jugador (state.incidents.pending). */
  | { type: 'decision'; id: string }
  /** `covered`: la casilla tiene buena cobertura de bomberos. */
  | { type: 'fire'; x: number; y: number; covered: boolean }
  | { type: 'fireOver'; destroyed: number }
  | { type: 'effectEnded'; label: string }
  | { type: 'repaired'; name: string }
  | { type: 'petitionNew'; title: string; x: number; y: number }
  | { type: 'petition'; title: string; done: boolean }
  | { type: 'electionSoon'; months: number; approval: number }
  | { type: 'election'; won: boolean; share: number; year: number };
