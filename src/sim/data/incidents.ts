import { addEffect } from '../effects';
import { random } from '../rng';
import type { GameState } from '../state';
import { TERRAIN_WATER } from '../types';
import { getBuildingDef } from './buildings';
import { ZONE_CODE, getZoneDefByCode } from './zones';

/**
 * Eventos con decisión (fase 17). Llegan al cerrar un mes, detienen la partida y se resuelven
 * eligiendo una opción (comando `decide`). Cada uno tiene al menos una opción gratis.
 */
export type IncidentData = Record<string, number>;

export interface IncidentChoice {
  label: string;
  /** Qué pasará, en una frase. */
  detail(state: GameState, data: IncidentData): string;
  cost?(state: GameState, data: IncidentData): number;
  /** Aplica la decisión; puede devolver un resultado para avisar al jugador. */
  apply(state: GameState, data: IncidentData): string | void;
}

export interface IncidentDef {
  id: string;
  kicker: string;
  title: string;
  /** Peso en el sorteo mensual (0 = solo lo lanza otro sistema, como las averías). */
  weight: number;
  /** Datos del evento si puede ocurrir ahora; null si no tiene sentido (sin agua, sin industria...). */
  prepare(state: GameState): IncidentData | null;
  body(state: GameState, data: IncidentData): string;
  choices: IncidentChoice[];
}

const round100 = (v: number) => Math.max(100, Math.round(v / 100) * 100);
const money = (v: number) => `$${Math.round(v).toLocaleString('es-ES')}`;
const inMonths = (state: GameState, months: number[]) => months.includes(state.time.month);
const nothing = () => {};

/** Lotes construidos junto al agua (en las 8 casillas vecinas). */
export function shoreLots(state: GameState): number[] {
  const { map } = state;
  const { width: w, height: h } = map;
  const out: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!map.lotLevel[i]) continue;
    const x = i % w;
    const y = (i - x) / w;
    let wet = false;
    for (let dy = -1; dy <= 1 && !wet; dy++) {
      for (let dx = -1; dx <= 1 && !wet; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        wet = nx >= 0 && ny >= 0 && nx < w && ny < h && map.terrain[ny * w + nx] === TERRAIN_WATER;
      }
    }
    if (wet) out.push(i);
  }
  return out;
}

function zonedLots(state: GameState, code: number): number {
  let n = 0;
  for (let i = 0; i < state.map.zoneType.length; i++) if (state.map.zoneType[i] === code) n++;
  return n;
}

/** Centrales que pueden averiarse: las grandes (la eólica no). */
export function breakablePlants(state: GameState) {
  return [...state.buildings.values()].filter((b) => !b.outage && (getBuildingDef(b.defId)?.power?.produces ?? 0) >= 50);
}

export const INCIDENTS: readonly IncidentDef[] = [
  {
    id: 'ola-calor',
    kicker: 'Evento',
    title: 'Ola de calor',
    weight: 3,
    prepare: (s) =>
      inMonths(s, [6, 7, 8]) && s.stats.population >= 300 && s.utilities.water.production > 0
        ? { cost: round100(Math.max(800, s.utilities.water.demand * 30)) }
        : null,
    body: () => 'Las temperaturas se disparan. Durante dos meses el consumo de agua subirá un 40 %: si la red no da abasto, habrá barrios sin agua.',
    choices: [
      {
        label: 'Comprar agua a la región',
        cost: (_, d) => d.cost,
        detail: () => 'El consumo de la red no cambia durante la ola.',
        apply: nothing,
      },
      {
        label: 'Restringir el riego',
        detail: () => 'El consumo sube solo un 10 %, pero a los vecinos no les gusta (−6 de felicidad).',
        apply: (s) => addEffect(s, { id: 'ola-calor', label: 'Restricciones de riego', monthsLeft: 2, waterDemand: 1.1, happiness: -6 }),
      },
      {
        label: 'Aguantar',
        detail: () => 'El consumo sube un 40 % durante dos meses.',
        apply: (s) => addEffect(s, { id: 'ola-calor', label: 'Ola de calor', monthsLeft: 2, waterDemand: 1.4 }),
      },
    ],
  },
  {
    id: 'recesion',
    kicker: 'Evento',
    title: 'Recesión regional',
    weight: 2,
    prepare: (s) => (s.stats.population >= 1_000 ? { cost: round100(s.stats.population * 1.5) } : null),
    body: () => 'La economía de la región se frena: durante seis meses caerá la demanda de comercio e industria.',
    choices: [
      {
        label: 'Plan de estímulo',
        cost: (_, d) => d.cost,
        detail: () => 'La caída de la demanda se queda en casi nada.',
        apply: (s) => addEffect(s, { id: 'recesion', label: 'Recesión (con estímulo)', monthsLeft: 6, demand: { C: -0.08, I: -0.08 } }),
      },
      {
        label: 'Rebajar impuestos a las empresas',
        detail: () => 'La demanda apenas cae, pero se recauda un 40 % menos de comercio e industria.',
        apply: (s) =>
          addEffect(s, { id: 'recesion', label: 'Recesión (impuestos rebajados)', monthsLeft: 6, demand: { C: -0.08, I: -0.08 }, taxIncome: { C: 0.6, I: 0.6 } }),
      },
      {
        label: 'Esperar a que pase',
        detail: () => 'La demanda de comercio e industria cae con fuerza durante seis meses.',
        apply: (s) => addEffect(s, { id: 'recesion', label: 'Recesión', monthsLeft: 6, demand: { C: -0.25, I: -0.25 } }),
      },
    ],
  },
  {
    id: 'festival',
    kicker: 'Evento',
    title: 'Festival de verano',
    weight: 3,
    prepare: (s) => (inMonths(s, [5, 6, 7, 8, 9]) && s.stats.population >= 200 ? { cost: round100(800 + s.stats.population * 0.4) } : null),
    body: () => 'Los vecinos proponen celebrar un festival en las calles de la ciudad.',
    choices: [
      {
        label: 'Financiarlo',
        cost: (_, d) => d.cost,
        detail: () => '+8 de felicidad y más demanda de comercio durante dos meses.',
        apply: (s) => addEffect(s, { id: 'festival', label: 'Festival de verano', monthsLeft: 2, happiness: 8, demand: { C: 0.1 } }),
      },
      {
        label: 'Con patrocinio privado',
        detail: () => 'Más modesto: +4 de felicidad durante un mes.',
        apply: (s) => addEffect(s, { id: 'festival', label: 'Festival patrocinado', monthsLeft: 1, happiness: 4 }),
      },
      {
        label: 'Este año no',
        detail: () => 'Algo de decepción: −2 de felicidad durante un mes.',
        apply: (s) => addEffect(s, { id: 'festival', label: 'Sin festival', monthsLeft: 1, happiness: -2 }),
      },
    ],
  },
  {
    id: 'fabrica',
    kicker: 'Propuesta',
    title: 'Una empresa quiere instalarse',
    weight: 2,
    prepare: (s) => (s.stats.population >= 500 && zonedLots(s, ZONE_CODE.I) >= 4 ? { amount: round100(4_000 + s.stats.population * 0.8) } : null),
    body: (_, d) => `Una empresa de la región quiere abrir una gran fábrica y ofrece ${money(d.amount)} a cambio de licencias rápidas.`,
    choices: [
      {
        label: 'Aceptar',
        detail: (_, d) => `+${money(d.amount)} y más demanda industrial durante un año, pero contamina (−3 de felicidad).`,
        apply: (s, d) => {
          s.economy.money += d.amount;
          addEffect(s, { id: 'fabrica', label: 'Gran fábrica', monthsLeft: 12, demand: { I: 0.25 }, happiness: -3 });
        },
      },
      { label: 'Rechazar', detail: () => 'Todo sigue igual.', apply: nothing },
    ],
  },
  {
    id: 'lluvias',
    kicker: 'Desastre',
    title: 'Lluvias torrenciales',
    weight: 2,
    prepare: (s) => {
      if (!inMonths(s, [3, 4, 10, 11])) return null;
      const lots = shoreLots(s).length;
      return lots >= 8 ? { cost: round100(lots * 30), lots } : null;
    },
    body: (_, d) => `Se esperan lluvias torrenciales. Hay ${d.lots} edificios junto al agua que pueden inundarse.`,
    choices: [
      {
        label: 'Reforzar las orillas',
        cost: (_, d) => d.cost,
        detail: () => 'Sacos terreros y bombas de achique: no habrá daños.',
        apply: nothing,
      },
      {
        label: 'Arriesgarse',
        detail: () => 'Más o menos la mitad de los edificios de la orilla perderán un nivel.',
        apply: (s) => {
          const { map } = s;
          let damaged = 0;
          for (const i of shoreLots(s)) {
            if (random(s) >= 0.5) continue;
            damaged++;
            map.lotLevel[i]--;
            const level = map.lotLevel[i];
            map.lotOccupants[i] = level ? Math.min(map.lotOccupants[i], getZoneDefByCode(map.zoneType[i], map.zoneDensity[i]).capacity[level - 1]) : 0;
          }
          return damaged ? `La inundación ha dañado ${damaged} ${damaged === 1 ? 'edificio' : 'edificios'}` : 'El agua no ha llegado a los edificios';
        },
      },
    ],
  },
  {
    id: 'mecenas',
    kicker: 'Propuesta',
    title: 'Un mecenas',
    weight: 1,
    prepare: (s) => (s.progress.rank >= 2 && s.stats.happiness >= 55 ? { amount: round100(3_000 + s.stats.population * 0.5) } : null),
    body: (_, d) => `Una fundación agradecida quiere donar ${money(d.amount)} a la ciudad, o pagar unos jardines con su nombre.`,
    choices: [
      { label: 'Al presupuesto', detail: (_, d) => `+${money(d.amount)} para la ciudad.`, apply: (s, d) => void (s.economy.money += d.amount) },
      {
        label: 'Los jardines',
        detail: () => '+5 de felicidad durante un año.',
        apply: (s) => addEffect(s, { id: 'mecenas', label: 'Jardines del mecenas', monthsLeft: 12, happiness: 5 }),
      },
    ],
  },
  {
    // La lanza el sistema de averías (no el sorteo): data.building es la central averiada
    id: 'averia',
    kicker: 'Avería',
    title: 'Avería en la central',
    weight: 0,
    prepare: (s) => {
      const plants = breakablePlants(s);
      if (!plants.length) return null;
      const b = plants[Math.floor(random(s) * plants.length)];
      return { building: b.id, cost: round100((getBuildingDef(b.defId)?.cost ?? 0) * 0.25) };
    },
    body: (s, d) => {
      const name = getBuildingDef(s.buildings.get(d.building)?.defId ?? '')?.name ?? 'La central';
      return `${name} ha sufrido una avería: hasta que se repare rinde al 40 % y los barrios más alejados pueden quedarse sin luz.`;
    },
    choices: [
      {
        label: 'Reparación urgente',
        cost: (_, d) => d.cost,
        detail: () => 'Vuelve a funcionar del todo en 3 días.',
        apply: (s, d) => setOutage(s, d.building, 3),
      },
      {
        label: 'Reparación ordinaria',
        detail: () => 'Gratis, pero tarda 20 días.',
        apply: (s, d) => setOutage(s, d.building, 20),
      },
    ],
  },
];

function setOutage(state: GameState, building: number, days: number): void {
  const b = state.buildings.get(building);
  if (b) b.outage = days;
}

export function getIncident(id: string): IncidentDef | undefined {
  return INCIDENTS.find((d) => d.id === id);
}

/** Opción por defecto (la última, la que no cuesta): la usa el jugador automático. */
export const defaultChoice = (def: IncidentDef) => def.choices.length - 1;
