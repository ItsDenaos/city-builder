import type { Density, ZoneType } from '../types';

export const MAX_LOT_LEVEL = 3;

export interface ZoneDef {
  id: string;
  type: ZoneType;
  density: Density;
  label: string;
  /** Nombre del edificio que crece en la zona. */
  buildingName: string;
  costPerTile: number;
  unlockAtPopulation: number;
  /** Por nivel 1..3: habitantes (R) o empleos (C/I) por casilla. */
  capacity: readonly [number, number, number];
  color: string; // "arte" provisional: color del cuadro
}

// Codificación en los Uint8Array del mapa (0 = sin zona).
export const ZONE_CODE: Record<ZoneType, number> = { R: 1, C: 2, I: 3 };
export const ZONE_BY_CODE: readonly (ZoneType | null)[] = [null, 'R', 'C', 'I'];
export const DENSITY_CODE: Record<Density, number> = { low: 0, medium: 1, high: 2 };
export const DENSITY_BY_CODE: readonly Density[] = ['low', 'medium', 'high'];

export const ZONE_TYPE_LABEL: Record<ZoneType, string> = {
  R: 'Residencial',
  C: 'Comercial',
  I: 'Industrial',
};
export const DENSITY_LABEL: Record<Density, string> = { low: 'baja', medium: 'media', high: 'alta' };

const COST: Record<Density, number> = { low: 5, medium: 10, high: 20 };
const UNLOCK: Record<Density, number> = { low: 0, medium: 1_000, high: 5_000 };
const CAPACITY: Record<ZoneType, Record<Density, readonly [number, number, number]>> = {
  R: { low: [4, 8, 12], medium: [15, 30, 45], high: [40, 80, 120] },
  C: { low: [2, 4, 6], medium: [6, 12, 18], high: [15, 30, 45] },
  I: { low: [4, 8, 12], medium: [10, 20, 30], high: [25, 50, 75] },
};
const BUILDING_NAME: Record<ZoneType, Record<Density, string>> = {
  R: { low: 'Casa', medium: 'Edificio de apartamentos', high: 'Torre residencial' },
  C: { low: 'Tienda', medium: 'Centro comercial', high: 'Torre de oficinas' },
  I: { low: 'Taller', medium: 'Fábrica', high: 'Complejo industrial' },
};
// Verde residencial, azul comercial y amarillo industrial, en tonos que conviven con la paleta de AKROPOLIS
const COLORS: Record<ZoneType, Record<Density, string>> = {
  R: { low: '#93C99E', medium: '#79B887', high: '#5E9E6E' },
  C: { low: '#90B9DE', medium: '#6FA3D2', high: '#5486B8' },
  I: { low: '#E3C97E', medium: '#D6B65A', high: '#B99A3F' },
};

export const ZONES: readonly ZoneDef[] = (['R', 'C', 'I'] as const).flatMap((type) =>
  DENSITY_BY_CODE.map((density) => ({
    id: `${type}_${density}`,
    type,
    density,
    label: `${ZONE_TYPE_LABEL[type]} ${DENSITY_LABEL[density]}`,
    buildingName: BUILDING_NAME[type][density],
    costPerTile: COST[density],
    unlockAtPopulation: UNLOCK[density],
    capacity: CAPACITY[type][density],
    color: COLORS[type][density],
  })),
);

export function getZoneDef(type: ZoneType, density: Density): ZoneDef {
  return ZONES.find((z) => z.type === type && z.density === density)!;
}

// Búsqueda rápida por códigos del mapa: índice = (zoneType - 1) * 3 + zoneDensity
const BY_CODE = (['R', 'C', 'I'] as const).flatMap((t) => DENSITY_BY_CODE.map((d) => getZoneDef(t, d)));

export function getZoneDefByCode(zoneType: number, zoneDensity: number): ZoneDef {
  return BY_CODE[(zoneType - 1) * 3 + zoneDensity];
}
