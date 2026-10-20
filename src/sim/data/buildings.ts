// Catálogo de edificios colocables. Para añadir un edificio basta con una entrada nueva:
// los menús, la validación y el render lo leen de aquí.

export type BuildingCategory = 'power' | 'water' | 'services' | 'parks';
export type ServiceType = 'police' | 'fire' | 'health' | 'education' | 'park';

export interface BuildingDef {
  id: string;
  name: string;
  short: string; // etiqueta dentro del cuadro
  category: BuildingCategory;
  size: { w: number; h: number };
  cost: number;
  upkeep: number; // mensual
  power?: { produces?: number; consumes?: number }; // MW
  water?: { produces?: number; consumes?: number }; // m³/día (unidades de juego)
  coverage?: { service: ServiceType; radius: number };
  /** Efecto máximo (escala 0-100) en el centro; decrece hasta el radio. */
  effects?: { pollution?: number; landValue?: number; crime?: number; radius: number };
  capacity?: { jobs?: number; residents?: number };
  requiresWaterAdjacent?: boolean;
  unlockAtPopulation: number;
  /** Color identificativo (muestras del menú y vista alejada), en la paleta de AKROPOLIS. */
  color: string;
}

export const BUILDING_CATEGORIES: readonly { id: BuildingCategory; label: string }[] = [
  { id: 'power', label: 'Electricidad' },
  { id: 'water', label: 'Agua' },
  { id: 'services', label: 'Servicios' },
  { id: 'parks', label: 'Parques' },
];

export const BUILDINGS: readonly BuildingDef[] = [
  // Electricidad
  {
    id: 'wind_turbine', name: 'Turbina eólica', short: 'T', category: 'power',
    size: { w: 1, h: 1 }, cost: 1_500, upkeep: 30,
    power: { produces: 8 }, effects: { landValue: -5, radius: 2 },
    unlockAtPopulation: 0, color: '#E4E2DC',
  },
  {
    id: 'coal_plant', name: 'Central de carbón', short: 'CC', category: 'power',
    size: { w: 4, h: 4 }, cost: 12_000, upkeep: 400,
    power: { produces: 150 }, effects: { pollution: 80, landValue: -20, radius: 10 },
    capacity: { jobs: 60 }, unlockAtPopulation: 0, color: '#6B645C',
  },
  // Agua
  {
    id: 'water_tower', name: 'Torre de agua', short: 'TA', category: 'water',
    size: { w: 1, h: 1 }, cost: 1_200, upkeep: 40,
    water: { produces: 20 }, power: { consumes: 2 },
    unlockAtPopulation: 0, color: '#9DC0D2',
  },
  {
    id: 'water_pump', name: 'Bomba de agua', short: 'BA', category: 'water',
    size: { w: 2, h: 2 }, cost: 3_000, upkeep: 90,
    water: { produces: 100 }, power: { consumes: 5 }, requiresWaterAdjacent: true,
    capacity: { jobs: 10 }, unlockAtPopulation: 0, color: '#4E7F99',
  },
  // Servicios
  {
    id: 'police_station', name: 'Comisaría', short: 'P', category: 'services',
    size: { w: 2, h: 2 }, cost: 3_000, upkeep: 100,
    coverage: { service: 'police', radius: 14 }, power: { consumes: 3 }, water: { consumes: 2 },
    capacity: { jobs: 15 }, unlockAtPopulation: 0, color: '#2E4A61',
  },
  {
    id: 'fire_station', name: 'Estación de bomberos', short: 'B', category: 'services',
    size: { w: 2, h: 2 }, cost: 3_000, upkeep: 100,
    coverage: { service: 'fire', radius: 14 }, power: { consumes: 3 }, water: { consumes: 4 },
    capacity: { jobs: 15 }, unlockAtPopulation: 0, color: '#A9574A',
  },
  {
    id: 'clinic', name: 'Clínica', short: 'C', category: 'services',
    size: { w: 2, h: 2 }, cost: 4_000, upkeep: 120,
    coverage: { service: 'health', radius: 12 }, power: { consumes: 4 }, water: { consumes: 3 },
    capacity: { jobs: 20 }, unlockAtPopulation: 0, color: '#C0503F',
  },
  {
    id: 'hospital', name: 'Hospital', short: 'H', category: 'services',
    size: { w: 3, h: 3 }, cost: 15_000, upkeep: 400,
    coverage: { service: 'health', radius: 25 }, power: { consumes: 12 }, water: { consumes: 10 },
    capacity: { jobs: 80 }, unlockAtPopulation: 2_000, color: '#9E3F33',
  },
  {
    id: 'elementary_school', name: 'Escuela', short: 'E', category: 'services',
    size: { w: 3, h: 2 }, cost: 5_000, upkeep: 150,
    coverage: { service: 'education', radius: 14 }, power: { consumes: 4 }, water: { consumes: 3 },
    capacity: { jobs: 25 }, unlockAtPopulation: 0, color: '#A8744E',
  },
  {
    id: 'high_school', name: 'Instituto', short: 'I', category: 'services',
    size: { w: 3, h: 3 }, cost: 10_000, upkeep: 300,
    coverage: { service: 'education', radius: 22 }, power: { consumes: 8 }, water: { consumes: 6 },
    capacity: { jobs: 45 }, unlockAtPopulation: 2_000, color: '#8F6141',
  },
  // Parques
  {
    id: 'park_small', name: 'Parque pequeño', short: 'pq', category: 'parks',
    size: { w: 1, h: 1 }, cost: 200, upkeep: 5,
    coverage: { service: 'park', radius: 4 }, effects: { landValue: 15, radius: 4 },
    unlockAtPopulation: 0, color: '#7E9C78',
  },
  {
    id: 'plaza', name: 'Plaza', short: 'PZ', category: 'parks',
    size: { w: 2, h: 2 }, cost: 800, upkeep: 20,
    coverage: { service: 'park', radius: 6 }, effects: { landValue: 25, crime: -15, radius: 6 },
    unlockAtPopulation: 0, color: '#C9C2B2',
  },
];

const BY_ID = new Map(BUILDINGS.map((b) => [b.id, b]));

export function getBuildingDef(id: string): BuildingDef | undefined {
  return BY_ID.get(id);
}
