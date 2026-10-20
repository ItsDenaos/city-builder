import { getBuildingDef } from './data/buildings';
import { ROADS } from './data/roads';
import { ZONE_CODE } from './data/zones';
import type { GameState } from './state';
import type { ZoneType } from './types';

/**
 * Primeros pasos: una guía de objetivos para la primera ciudad. Cada paso se da por hecho cuando
 * la ciudad cumple su condición, sin importar cómo se haya conseguido.
 */
export interface TutorialStep {
  id: string;
  title: string;
  hint: string;
  /** Categoría del dock que conviene resaltar mientras el paso está pendiente. */
  highlight?: string;
  done(state: GameState): boolean;
}

/** Paso en curso; cuando llega a TUTORIAL.length la guía está completa. */
export interface TutorialState {
  step: number;
}

/** Casillas de calle conectadas con el borde del mapa. */
function connectedStreets(state: GameState): number {
  const { road } = state.map;
  const access = state.layers.roadAccess;
  let n = 0;
  for (let i = 0; i < road.length; i++) if (road[i] === ROADS.street.code && access[i] === 0) n++;
  return n;
}

function zoned(state: GameState, zone: ZoneType, served?: (i: number) => boolean): number {
  const code = ZONE_CODE[zone];
  const { zoneType } = state.map;
  let n = 0;
  for (let i = 0; i < zoneType.length; i++) if (zoneType[i] === code && (!served || served(i))) n++;
  return n;
}

export const TUTORIAL: readonly TutorialStep[] = [
  {
    id: 'calle',
    title: 'Traza una calle conectada con el borde',
    hint: 'Carreteras → Calle (tecla R) y arrastra. Por el borde del mapa llegan los vecinos; si empiezas con parcelas, sal de la avenida que ya tienes.',
    highlight: 'roads',
    done: (s) => connectedStreets(s) >= 8,
  },
  {
    id: 'viviendas',
    title: 'Zonifica viviendas junto a la calle',
    hint: 'Zonas → Residencial baja y arrastra por encima de la calle: se zonifica una franja de 3 casillas a cada lado. La tecla F cambia el ancho.',
    highlight: 'zones',
    done: (s) => zoned(s, 'R', (i) => s.layers.roadAccess[i] <= 3) >= 16,
  },
  {
    id: 'luz',
    title: 'Lleva la electricidad',
    hint: 'Electricidad → Turbina eólica, cerca de las zonas. Calles, zonas y edificios conducen la corriente; si queda lejos, únela con tendido eléctrico.',
    highlight: 'power',
    done: (s) => zoned(s, 'R', (i) => s.layers.powered[i] === 1) >= 8,
  },
  {
    id: 'agua',
    title: 'Lleva el agua',
    hint: 'Agua → Torre de agua, y tuberías bajo las calles: cada tubería abastece las casillas a 2 de distancia.',
    highlight: 'water',
    done: (s) => zoned(s, 'R', (i) => s.layers.watered[i] === 1) >= 8,
  },
  {
    id: 'empleo',
    title: 'Crea empleo: comercio e industria',
    hint: 'Los vecinos necesitan trabajo. Zonifica comercio cerca de las casas e industria algo apartada, porque contamina.',
    highlight: 'zones',
    done: (s) => zoned(s, 'C') >= 8 && zoned(s, 'I') >= 8,
  },
  {
    id: 'tiempo',
    title: 'Deja correr el tiempo hasta 100 habitantes',
    hint: 'Pulsa ▶ o las teclas 1 a 3. Las barras R C I de arriba dicen qué zonas pide la ciudad: si una baja, sobra de ese tipo.',
    done: (s) => s.stats.population >= 100,
  },
  {
    id: 'servicios',
    title: 'Coloca un servicio público',
    hint: 'Servicios → escuela, comisaría o bomberos. Suben el valor del suelo y la felicidad a su alrededor; la vista de datos (abajo a la derecha) muestra su alcance.',
    highlight: 'services',
    done: (s) => [...s.buildings.values()].some((b) => getBuildingDef(b.defId)?.category === 'services'),
  },
  {
    id: 'cuentas',
    title: 'Cierra un mes con balance positivo',
    hint: 'Abre el presupuesto (tecla P): impuestos menos mantenimiento. Si pierdes dinero, sube un punto los impuestos o espera a que la ciudad crezca.',
    done: (s) => (s.economy.lastMonth?.net ?? 0) > 0,
  },
];

/** Si el paso en curso ya se cumple, pasa al siguiente y lo devuelve. */
export function advanceTutorial(state: GameState): TutorialStep | null {
  const t = state.tutorial;
  if (!t || t.step >= TUTORIAL.length) return null;
  const step = TUTORIAL[t.step];
  if (!step.done(state)) return null;
  t.step++;
  return step;
}
