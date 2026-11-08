import type { ServiceType } from './buildings';

/**
 * Departamentos del presupuesto (fase 13): uno por servicio con cobertura, más el transporte público
 * (fase 16) y los residuos (fase 14). Su financiación (50-150 %) multiplica el mantenimiento de sus edificios; en los servicios,
 * por debajo de 100 % la cobertura es más débil y por encima llega más lejos; en el transporte cambia
 * la frecuencia (las esperas); en los residuos, la basura que se recoge al día; en la salud, también las camas.
 */
export type DepartmentId = ServiceType | 'transit' | 'waste';

export interface DepartmentDef {
  id: DepartmentId;
  label: string;
  /** Qué mejora al financiarlo más, para la descripción emergente. */
  effect: string;
}

export const DEPARTMENTS: readonly DepartmentDef[] = [
  { id: 'police', label: 'Policía', effect: 'Menos crimen en su radio' },
  { id: 'fire', label: 'Bomberos', effect: 'Previenen y apagan incendios' },
  { id: 'health', label: 'Salud', effect: 'Más cobertura y más camas para los enfermos' },
  { id: 'education', label: 'Educación', effect: 'Más felicidad y niveles de industria' },
  { id: 'park', label: 'Parques', effect: 'Más felicidad y valor del suelo' },
  { id: 'transit', label: 'Transporte', effect: 'Más frecuencia: esperas más cortas en paradas y estaciones' },
  { id: 'waste', label: 'Residuos', effect: 'Más camiones: más basura recogida al día' },
];

export const DEPARTMENT_IDS: readonly DepartmentId[] = DEPARTMENTS.map((d) => d.id);

export type Funding = Record<DepartmentId, number>;
