import type { ServiceType } from './buildings';

/**
 * Departamentos del presupuesto (fase 13): uno por servicio con cobertura. Su financiación (50-150 %)
 * multiplica el mantenimiento de sus edificios; por debajo de 100 % la cobertura es más débil y por
 * encima llega más lejos.
 */
export interface DepartmentDef {
  id: ServiceType;
  label: string;
  /** Qué mejora al financiarlo más, para la descripción emergente. */
  effect: string;
}

export const DEPARTMENTS: readonly DepartmentDef[] = [
  { id: 'police', label: 'Policía', effect: 'Menos crimen en su radio' },
  { id: 'fire', label: 'Bomberos', effect: 'Previenen y apagan incendios' },
  { id: 'health', label: 'Salud', effect: 'Más felicidad en su radio' },
  { id: 'education', label: 'Educación', effect: 'Más felicidad y niveles de industria' },
  { id: 'park', label: 'Parques', effect: 'Más felicidad y valor del suelo' },
];

export const DEPARTMENT_IDS: readonly ServiceType[] = DEPARTMENTS.map((d) => d.id);

export type Funding = Record<ServiceType, number>;
