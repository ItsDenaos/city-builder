import { COMMUTE_OK } from '../config';
import { mulberry32 } from '../rng';
import type { GameState } from '../state';
import { ROAD_BY_CODE } from './roads';
import { ZONE_CODE, getZoneDefByCode } from './zones';

/**
 * El Ágora (fase 18): lo que dicen los vecinos. Cada mensaje sale de un lote real y de su causa real
 * (sin luz, humo, trayecto largo...), y las quejas que más se repiten acaban en peticiones con plazo.
 */

// ---------- Barrios ----------

/** Lado de cada barrio, en casillas. */
export const NEIGHBORHOOD_SIZE = 24;

const NEIGHBORHOODS = [
  'Los Olivos', 'La Alameda', 'El Puerto', 'San Telmo', 'Las Eras', 'El Molino', 'La Vega', 'El Ensanche',
  'La Ribera', 'Los Arcos', 'Santa Ana', 'El Carmen', 'La Loma', 'Las Huertas', 'El Prado', 'La Fuente',
  'Los Pinos', 'El Mirador', 'La Estación', 'Las Canteras', 'San Roque', 'El Pilar', 'La Atalaya', 'Los Almendros',
  'El Rosal', 'La Muralla', 'San Lorenzo', 'El Castillo', 'La Dehesa', 'Los Robles', 'El Barrio Alto', 'La Marina',
  'Las Cuestas', 'El Llano', 'La Colina', 'San Martín', 'El Parque', 'La Granja', 'Los Tilos', 'El Faro',
  'La Plaza', 'Las Torres', 'El Romeral', 'La Cañada', 'San Pedro', 'El Viso', 'La Herradura', 'Los Llanos',
  'El Arrabal', 'La Solana', 'Las Viñas', 'El Cerro', 'La Huerta', 'San Miguel', 'El Tejar', 'La Estrella',
  'Los Cipreses', 'El Bosque', 'La Ermita', 'Las Fuentes', 'El Real', 'La Paz', 'El Carril', 'La Albufera',
];

const shuffled = new Map<number, string[]>();

/** Nombre del barrio de una casilla: cada partida reparte los nombres a su manera, sin repetirlos. */
export function neighborhoodName(state: GameState, x: number, y: number): string {
  let names = shuffled.get(state.seed);
  if (!names) {
    const rnd = mulberry32(state.seed ^ 0x5eed);
    names = [...NEIGHBORHOODS];
    for (let k = names.length - 1; k > 0; k--) {
      const j = Math.floor(rnd() * (k + 1));
      [names[k], names[j]] = [names[j], names[k]];
    }
    shuffled.set(state.seed, names);
  }
  const cols = Math.ceil(state.map.width / NEIGHBORHOOD_SIZE);
  const k = Math.floor(y / NEIGHBORHOOD_SIZE) * cols + Math.floor(x / NEIGHBORHOOD_SIZE);
  return names[k % names.length];
}

// ---------- Vecinos ----------

export const FIRST_NAMES = [
  'Lucía', 'Andrés', 'Carmen', 'Javier', 'Marta', 'Pablo', 'Elena', 'Sergio', 'Nuria', 'Diego', 'Rosa', 'Óscar',
  'Inés', 'Raúl', 'Pilar', 'Hugo', 'Alba', 'Tomás', 'Sara', 'Iván', 'Beatriz', 'Mario', 'Clara', 'Rubén',
  'Teresa', 'Álvaro', 'Julia', 'Víctor', 'Irene', 'Marcos', 'Lola', 'Adrián',
];

export const BUSINESSES = ['Ferretería', 'Panadería', 'Talleres', 'Distribuciones', 'Almacenes', 'Librería', 'Conservas', 'Muebles'];

// ---------- Temas ----------

export type PostTone = 'queja' | 'elogio';

export interface PetitionGoal {
  /** Qué se mide, para la barra de progreso. */
  label: string;
  value: number;
  target: number;
  done: boolean;
  /** Objetivo de sí o no (tener luz, tener agua...): sin barra de progreso. */
  binary?: boolean;
}

export interface TopicDef {
  id: string;
  tone: PostTone;
  /** Quién habla: un vecino (lotes residenciales) o un negocio (comercio e industria). */
  speaker: 'vecino' | 'negocio';
  detect(state: GameState, i: number): boolean;
  lines: readonly string[];
  /** Si la queja se repite, los vecinos piden esto. */
  petition?: {
    title: (barrio: string) => string;
    months: number;
    goal(state: GameState, i: number): PetitionGoal;
  };
}

const L = (s: GameState) => s.layers;
const atLeast = (label: string, value: number, target: number): PetitionGoal => ({ label, value: Math.round(value), target, done: value >= target });
const atMost = (label: string, value: number, target: number): PetitionGoal => ({ label, value: Math.round(value), target, done: value <= target });
const yes = (label: string, ok: boolean): PetitionGoal => ({ label, value: ok ? 1 : 0, target: 1, done: ok, binary: true });

function nearFire(s: GameState, i: number, r = 2): boolean {
  const { map } = s;
  const x = i % map.width;
  const y = (i - x) / map.width;
  for (let ty = Math.max(0, y - r); ty <= Math.min(map.height - 1, y + r); ty++) {
    for (let tx = Math.max(0, x - r); tx <= Math.min(map.width - 1, x + r); tx++) if (map.fire[ty * map.width + tx]) return true;
  }
  return false;
}

function nearJam(s: GameState, i: number, r = 2): boolean {
  const { map } = s;
  const x = i % map.width;
  const y = (i - x) / map.width;
  for (let ty = Math.max(0, y - r); ty <= Math.min(map.height - 1, y + r); ty++) {
    for (let tx = Math.max(0, x - r); tx <= Math.min(map.width - 1, x + r); tx++) {
      const k = ty * map.width + tx;
      const road = ROAD_BY_CODE[map.road[k]];
      if (road && s.layers.traffic[k] > road.capacity * 0.9) return true;
    }
  }
  return false;
}

const unemployment = (s: GameState) => (s.stats.workforce ? Math.max(0, s.stats.workforce - s.stats.employed) / s.stats.workforce : 0);
const cityHasJobs = (s: GameState) => s.stats.jobs.C + s.stats.jobs.I + s.stats.jobs.services > 0;

/** Por orden de prioridad: de cada lote se cuenta lo más grave que le pasa. */
export const TOPICS: readonly TopicDef[] = [
  {
    id: 'fuego', tone: 'queja', speaker: 'vecino',
    detect: (s, i) => nearFire(s, i),
    lines: ['¡Hay un incendio en mi calle! ¿Dónde están los bomberos?', 'Se ve el humo del incendio desde mi ventana.'],
  },
  {
    id: 'sin-luz', tone: 'queja', speaker: 'vecino',
    detect: (s, i) => !L(s).powered[i],
    lines: ['Llevamos días sin luz en casa.', '¿Para cuándo la electricidad en el barrio?', 'Cenamos a la luz de las velas otra vez.'],
    petition: { title: (b) => `Electricidad para ${b}`, months: 3, goal: (s, i) => yes('Electricidad en el barrio', L(s).powered[i] === 1) },
  },
  {
    id: 'sin-agua', tone: 'queja', speaker: 'vecino',
    detect: (s, i) => !L(s).watered[i],
    lines: ['No sale agua del grifo.', 'Sin agua no hay quien viva aquí.', 'Vamos a por agua con garrafas a otro barrio.'],
    petition: { title: (b) => `Agua corriente en ${b}`, months: 3, goal: (s, i) => yes('Agua en el barrio', L(s).watered[i] === 1) },
  },
  {
    id: 'humo', tone: 'queja', speaker: 'vecino',
    detect: (s, i) => L(s).pollution[i] > 35,
    lines: ['El humo de las fábricas no deja respirar.', 'Huele a fábrica todo el día.', 'Tiendo la ropa y sale gris.'],
    petition: { title: (b) => `Aire limpio en ${b}`, months: 6, goal: (s, i) => atMost('Contaminación', L(s).pollution[i], 15) },
  },
  {
    id: 'crimen', tone: 'queja', speaker: 'vecino',
    detect: (s, i) => L(s).crime[i] > 35,
    lines: ['Ya no me atrevo a salir de noche.', 'Han vuelto a robar en el portal.', 'Necesitamos más policía por aquí.'],
    petition: { title: (b) => `Más seguridad en ${b}`, months: 6, goal: (s, i) => atMost('Crimen', L(s).crime[i], 15) },
  },
  {
    id: 'sin-empleo', tone: 'queja', speaker: 'vecino',
    detect: (s, i) => L(s).commute[i] < 0 && cityHasJobs(s),
    lines: ['Desde aquí no hay forma de llegar a ningún trabajo.', 'Busco empleo, pero no hay ni una calle que lleve a uno.'],
    petition: { title: (b) => `Conectar ${b} con el empleo`, months: 4, goal: (s, i) => yes('Camino hasta un empleo', L(s).commute[i] >= 0) },
  },
  {
    id: 'trayecto', tone: 'queja', speaker: 'vecino',
    detect: (s, i) => L(s).commute[i] > COMMUTE_OK + 10,
    lines: ['Tardo una eternidad en llegar al trabajo.', 'Hora y media de atasco cada mañana.', 'Paso más tiempo en el coche que en casa.'],
    petition: { title: (b) => `Mejores accesos para ${b}`, months: 6, goal: (s, i) => atMost('Trayecto al trabajo', Math.max(0, L(s).commute[i]), COMMUTE_OK) },
  },
  {
    id: 'impuestos', tone: 'queja', speaker: 'vecino',
    detect: (s) => s.economy.taxes.R >= 13,
    lines: ['Los impuestos están por las nubes.', 'Con lo que pago de impuestos, me mudo.'],
    petition: { title: () => 'Bajar el impuesto residencial', months: 3, goal: (s) => atMost('Impuesto residencial (%)', s.economy.taxes.R, 10) },
  },
  {
    id: 'sin-salud', tone: 'queja', speaker: 'vecino',
    detect: (s, i) => L(s).coverage.health[i] < 15 && s.stats.population >= 800,
    lines: ['El centro de salud más cercano está lejísimos.', 'Para ir al médico hay que cruzar media ciudad.'],
    petition: { title: (b) => `Un centro de salud para ${b}`, months: 6, goal: (s, i) => atLeast('Cobertura sanitaria', L(s).coverage.health[i], 50) },
  },
  {
    id: 'sin-escuela', tone: 'queja', speaker: 'vecino',
    detect: (s, i) => L(s).coverage.education[i] < 15 && s.stats.population >= 500,
    lines: ['Mis hijos no tienen escuela cerca.', 'Llevamos a los niños al colegio en otro barrio.'],
    petition: { title: (b) => `Una escuela en ${b}`, months: 6, goal: (s, i) => atLeast('Cobertura educativa', L(s).coverage.education[i], 50) },
  },
  {
    id: 'sin-parque', tone: 'queja', speaker: 'vecino',
    detect: (s, i) => L(s).coverage.park[i] < 10 && s.stats.population >= 300,
    lines: ['Ni un parque para los niños.', 'Todo asfalto: ni un árbol en el barrio.'],
    petition: { title: (b) => `Un parque para ${b}`, months: 6, goal: (s, i) => atLeast('Cobertura de parques', L(s).coverage.park[i], 40) },
  },
  {
    id: 'parque', tone: 'elogio', speaker: 'vecino',
    detect: (s, i) => L(s).happiness[i] >= 65 && L(s).coverage.park[i] >= 60,
    lines: ['Qué gusto pasear por el parque del barrio.', 'Los niños se pasan la tarde en el parque.'],
  },
  {
    id: 'escuela', tone: 'elogio', speaker: 'vecino',
    detect: (s, i) => L(s).happiness[i] >= 65 && L(s).coverage.education[i] >= 70,
    lines: ['La escuela del barrio es una maravilla.', 'Mis hijos van andando al colegio.'],
  },
  {
    id: 'seguro', tone: 'elogio', speaker: 'vecino',
    detect: (s, i) => L(s).happiness[i] >= 65 && L(s).crime[i] < 5,
    lines: ['Un barrio tranquilo y seguro.', 'Aquí se puede dejar la bici en la calle.'],
  },
  {
    id: 'feliz', tone: 'elogio', speaker: 'vecino',
    detect: (s, i) => L(s).happiness[i] >= 70,
    lines: ['Me encanta vivir aquí.', 'Esta ciudad va a mejor.', 'No cambiaría mi barrio por nada.'],
  },
  // Negocios
  {
    id: 'clientes', tone: 'queja', speaker: 'negocio',
    detect: (s, i) => s.map.zoneType[i] === ZONE_CODE.C && s.stats.demand.C < -0.05,
    lines: ['Hay más tiendas que clientes.', 'Abrimos cada mañana para nadie.'],
  },
  {
    id: 'trabajadores', tone: 'queja', speaker: 'negocio',
    detect: (s, i) => {
      const { map } = s;
      if (!map.lotLevel[i] || unemployment(s) >= 0.02) return false;
      return map.lotOccupants[i] < getZoneDefByCode(map.zoneType[i], map.zoneDensity[i]).capacity[map.lotLevel[i] - 1];
    },
    lines: ['No encontramos trabajadores.', 'Tenemos puestos vacantes y nadie para cubrirlos.'],
  },
  {
    id: 'camiones', tone: 'queja', speaker: 'negocio',
    detect: (s, i) => s.map.zoneType[i] === ZONE_CODE.I && nearJam(s, i),
    lines: ['Los camiones no pasan por el atasco.', 'Las entregas llegan tarde por el tráfico.'],
  },
];

export const getTopic = (id: string) => TOPICS.find((t) => t.id === id);
