// Tipos de vía. El código es el valor que se guarda en map.road (0 = sin carretera).

export type RoadKind = 'street' | 'avenue';

export interface RoadDef {
  kind: RoadKind;
  code: number;
  name: string;
  cost: number; // por casilla
  upkeep: number; // por casilla y mes
  /** Viajes por día que admite una casilla antes de congestionarse. */
  capacity: number;
  /** Coste de recorrer una casilla sin tráfico (las avenidas son más rápidas). */
  travelCost: number;
  color: string;
}

export const ROADS: Record<RoadKind, RoadDef> = {
  street: { kind: 'street', code: 1, name: 'Calle', cost: 10, upkeep: 0.5, capacity: 400, travelCost: 1, color: '#4B535A' },
  avenue: { kind: 'avenue', code: 2, name: 'Avenida', cost: 25, upkeep: 1.2, capacity: 1200, travelCost: 0.7, color: '#3E464E' },
};

export const ROAD_BY_CODE: readonly (RoadDef | null)[] = [null, ROADS.street, ROADS.avenue];
