import { DEFAULT_MAP_SIZE, ELECTION_YEARS, FUNDING_DEFAULT, START_MONEY, START_YEAR, TAX_DEFAULT } from './config';
import { generateTerrain } from './mapgen';
import type { ServiceType } from './data/buildings';
import type { Funding } from './data/departments';
import { type LandState, setupLand } from './land';
import type { TutorialState } from './tutorial';
import type { Speed, ZoneType } from './types';

export const NO_BUILDING = -1;
export const NO_ACCESS = 255;

/**
 * El mapa se guarda como "struct of arrays": una capa tipada por propiedad.
 * Es rápido de recorrer y los sistemas de fases futuras (contaminación, valor del suelo...)
 * añaden sus propias capas del mismo tamaño.
 */
export interface GameMap {
  readonly width: number;
  readonly height: number;
  terrain: Uint8Array; // TERRAIN_*
  road: Uint8Array; // 0/1
  zoneType: Uint8Array; // ZONE_CODE (0 = sin zona)
  zoneDensity: Uint8Array; // DENSITY_CODE
  /** Nivel del edificio que creció en la zona (0 = lote vacío, 1..MAX_LOT_LEVEL). */
  lotLevel: Uint8Array;
  /** Habitantes (R) o trabajadores (C/I) del lote. */
  lotOccupants: Uint16Array;
  building: Int32Array; // id de BuildingInstance o NO_BUILDING
  /** Tendido eléctrico (solo hace falta donde no hay carretera, zona ni edificio, que ya conducen). */
  powerLine: Uint8Array;
  /** Tubería de agua (subterránea: convive con cualquier cosa en superficie). */
  waterPipe: Uint8Array;
  /** Días que lleva ardiendo el edificio de la casilla (0 = no arde). */
  fire: Uint8Array;
  /** Túnel de metro (subterráneo: convive con cualquier cosa en superficie). */
  metro: Uint8Array;
}

/** Modo de transporte público de un lote en las capas derivadas (0 = ninguno). */
export const TRANSIT_MODE_CODE = { bus: 1, metro: 2, train: 3 } as const;

/** Capas derivadas: los sistemas las recalculan, no hace falta guardarlas. */
export interface DerivedLayers {
  /** 0 = carretera conectada con el exterior; 1..N = distancia a ella; NO_ACCESS = sin acceso. */
  roadAccess: Uint8Array;
  /** Casilla de carretera conectada por la que sale cada casilla con acceso (-1 = ninguna). */
  roadEntry: Int32Array;
  /** Viajes por día en cada casilla de carretera (suavizado). */
  traffic: Float32Array;
  /** Coste del trayecto al empleo más cercano desde cada lote residencial (-1 = sin empleo alcanzable). */
  commute: Float32Array;
  /** 1 = la casilla recibe electricidad. */
  powered: Uint8Array;
  /** 1 = la casilla está cubierta por la red de agua y recibe suministro. */
  watered: Uint8Array;
  /** Cobertura de cada servicio, 0-100. */
  coverage: Record<ServiceType, Float32Array>;
  pollution: Float32Array; // 0-100
  crime: Float32Array; // 0-100
  landValue: Float32Array; // 0-100
  /** Felicidad de los vecinos de cada lote residencial, 0-100 (0 en el resto). */
  happiness: Float32Array;
  /** Fracción de los trabajadores de cada lote residencial que va al trabajo en transporte público (0-1). */
  transitShare: Float32Array;
  /** Modo de transporte que usarían los vecinos de cada lote residencial (TRANSIT_MODE_CODE, 0 = ninguno). */
  transitMode: Uint8Array;
  /** Casillas a distancia a pie de alguna parada o estación en servicio (máscara de bits por modo). */
  transitCoverage: Uint8Array;
  /** Viajeros que suben cada día en cada parada o estación (por id de edificio). */
  ridership: Map<number, number>;
  /**
   * Paradas en servicio (por id de edificio): coste a pie hasta el empleo más cercano desde la parada
   * y coste del viaje desde ella hasta un empleo (Infinity si no lleva a ninguno). Para el inspector.
   */
  transitStops: Map<number, { egress: number; cost: number }>;
}

export interface UtilityStats {
  production: number;
  /** Consumo de lo que está conectado a alguna red. */
  demand: number;
}

export interface BuildingInstance {
  id: number;
  defId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Días que le faltan para volver a funcionar tras una avería. */
  outage?: number;
}

export interface GameTime {
  tick: number;
  day: number;
  month: number;
  year: number;
  speed: Speed;
}

export interface CityStats {
  population: number;
  workforce: number;
  employed: number;
  /** Capacidad de empleo por tipo. */
  jobs: { C: number; I: number; services: number };
  /** Puestos ocupados por tipo. */
  workers: { C: number; I: number; services: number };
  /** Demanda RCI en [-1, 1], suavizada. */
  demand: Record<ZoneType, number>;
  /** Felicidad media de los habitantes, 0-100. */
  happiness: number;
  traffic: { trips: number; congestedShare: number; avgCommute: number };
  transit: TransitStats;
}

/** Transporte público (fase 16): viajeros diarios al trabajo por modo. */
export interface TransitStats {
  riders: number;
  bus: number;
  metro: number;
  train: number;
  /** Fracción de los trayectos al trabajo que se hacen en transporte público (0-1). */
  share: number;
  /** Estaciones de tren en servicio (la primera trae demanda regional). */
  trainStations: number;
}

export const newTransitStats = (): TransitStats => ({ riders: 0, bus: 0, metro: 0, train: 0, share: 0, trainStations: 0 });

export interface Loan {
  id: number;
  amount: number;
  /** Capital pendiente. */
  balance: number;
  monthlyPayment: number;
  monthsLeft: number;
}

export interface Budget {
  income: Record<ZoneType, number>;
  /** Billetes del transporte público (fase 16), ya incluidos en `totalIncome`. */
  fares: number;
  expenses: {
    roads: number;
    networks: number;
    power: number;
    water: number;
    services: number;
    parks: number;
    transport: number;
    ordinances: number;
    loans: number;
  };
  /** Mantenimiento mensual de cada departamento (ya incluido en `expenses`). */
  departments: Funding;
  totalIncome: number;
  totalExpenses: number;
  net: number;
}

export interface Economy {
  money: number;
  /** Impuesto por tipo de zona, en %. */
  taxes: Record<ZoneType, number>;
  /** Financiación de cada departamento, en % (50-150, 100 = normal). */
  funding: Funding;
  /** Ordenanzas activas (ids de data/ordinances.ts). */
  ordinances: string[];
  loans: Loan[];
  nextLoanId: number;
  /** Cierre del último mes (null hasta que termine el primero). */
  lastMonth: Budget | null;
  /** Dinero al cierre de cada mes, el más reciente al final. */
  history: { month: number; year: number; money: number; net: number }[];
  monthsInDebt: number;
  bankrupt: boolean;
}

/** Muestra mensual para las gráficas de estadísticas. */
export interface StatsSample {
  month: number;
  year: number;
  population: number;
  money: number;
  happiness: number;
  unemployment: number; // 0-1
  demand: Record<ZoneType, number>;
  income: number;
  expenses: number;
  commute: number;
  /** Fracción de trayectos en transporte público (no existe en partidas anteriores a la fase 16). */
  transitShare?: number;
}

export interface Progress {
  peakPopulation: number;
  /** Índice en RANKS. */
  rank: number;
  achievements: string[];
  /** Meses seguidos con balance positivo. */
  monthsPositive: number;
  loansClosed: number;
  plotsBought: number;
}

/** Efecto temporal de un evento (ver effects.ts). */
export interface ActiveEffect {
  id: string;
  label: string;
  monthsLeft: number;
  demand?: Partial<Record<ZoneType, number>>;
  happiness?: number;
  /** Multiplicador del consumo de agua. */
  waterDemand?: number;
  /** Multiplicador de la recaudación por tipo de zona. */
  taxIncome?: Partial<Record<ZoneType, number>>;
}

/** Eventos y desastres (fase 17). */
export interface Incidents {
  /** 0 = ninguno, 1 = pocos, 2 = normales, 3 = muchos. */
  level: number;
  effects: ActiveEffect[];
  /** Evento que espera una decisión del jugador. */
  pending: { id: string; data: Record<string, number> } | null;
  /** Días que faltan para que pueda llegar otro evento. */
  cooldown: number;
  /** Últimos eventos, para no repetirlos seguidos. */
  recent: string[];
  /** Edificios en llamas ahora mismo. */
  burning: number;
  /** Edificios destruidos por el incendio en curso (se anuncia al apagarse). */
  fireLosses: number;
  /** Incendios declarados en toda la partida. */
  fires: number;
  /** Incendios apagados sin perder ningún edificio. */
  firesContained: number;
  /** Eventos resueltos (decisiones tomadas). */
  resolved: number;
}

export const newIncidents = (level = 0): Incidents => ({
  level,
  effects: [],
  pending: null,
  cooldown: 60,
  recent: [],
  burning: 0,
  fireLosses: 0,
  fires: 0,
  firesContained: 0,
  resolved: 0,
});

/** Un mensaje del Ágora: quién, dónde, qué y por qué (el tema es la causa real que lo provoca). */
export interface AgoraPost {
  /** Día de juego (time.tick). */
  day: number;
  x: number;
  y: number;
  author: string;
  barrio: string;
  text: string;
  tone: 'queja' | 'elogio';
  topic: string;
}

export interface Petition {
  id: number;
  topic: string;
  title: string;
  barrio: string;
  x: number;
  y: number;
  created: number;
  deadline: number;
  status: 'open' | 'done' | 'failed';
}

/** La voz de la ciudad (fase 18). */
export interface Agora {
  /** Generador propio: lo que digan los vecinos no altera la simulación. */
  rng: number;
  posts: AgoraPost[];
  petitions: Petition[];
  nextPetitionId: number;
  /** Aprobación del alcalde, 0-100. */
  approval: number;
  elections: boolean;
  /** Año de las próximas elecciones (en enero). */
  nextElection: number;
  electionsWon: number;
  petitionsDone: number;
}

export const newAgora = (seed: number, elections: boolean): Agora => ({
  rng: (seed ^ 0xa60a) >>> 0,
  posts: [],
  petitions: [],
  nextPetitionId: 1,
  approval: 55,
  elections,
  nextElection: START_YEAR + ELECTION_YEARS,
  electionsWon: 0,
  petitionsDone: 0,
});

/** Zona rectangular con nombre propio que pone el jugador (fase 13); manda sobre los barrios automáticos. */
export interface District {
  id: number;
  name: string;
  /** Esquinas inclusivas, en casillas. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ScenarioState {
  id: string;
  startYear: number;
  endYear: number;
  status: 'active' | 'won' | 'lost';
}

export interface GameState {
  name: string;
  seed: number;
  rng: number;
  map: GameMap;
  layers: DerivedLayers;
  buildings: Map<number, BuildingInstance>;
  nextBuildingId: number;
  economy: Economy;
  stats: CityStats;
  /** Los desbloqueos dependen de la población máxima alcanzada, así no se pierden. */
  progress: Progress;
  /** Terreno comprable; null = todo el mapa es del jugador (modo libre, tests, partidas antiguas). */
  land: LandState | null;
  /** Escenario en curso, si la partida es un escenario. */
  scenario: ScenarioState | null;
  /** Modo libre: dinero ilimitado, todo desbloqueado, sin bancarrota ni logros. */
  sandbox: boolean;
  /** Primeros pasos en curso (null = sin guía). */
  tutorial: TutorialState | null;
  incidents: Incidents;
  agora: Agora;
  /** Distritos con nombre; el último creado manda donde se solapan. */
  districts: District[];
  nextDistrictId: number;
  utilities: { power: UtilityStats; water: UtilityStats };
  time: GameTime;
  /** Una muestra por mes, la más reciente al final. */
  history: StatsSample[];
}

export interface NewGameOptions {
  name?: string;
  width?: number;
  height?: number;
  seed?: number;
  money?: number;
  /** Mapa sin agua (útil en tests). */
  flat?: boolean;
  /** Umbral de agua del generador de terreno (más alto, más lagos). */
  waterLevel?: number;
  /** Terreno por parcelas que se compran; si no, todo el mapa es del jugador. */
  landPlots?: boolean;
  /** Modo libre (sin parcelas aunque se pidan). */
  sandbox?: boolean;
  /** Empezar con la guía de primeros pasos. */
  tutorial?: boolean;
  /** Nivel de eventos y desastres (0 = ninguno, el de serie: los tests y el balance no tienen sorpresas). */
  incidents?: number;
  /** Elecciones cada ELECTION_YEARS años (no en el modo libre). */
  elections?: boolean;
}

export const newFunding = (): Funding => ({
  police: FUNDING_DEFAULT,
  fire: FUNDING_DEFAULT,
  health: FUNDING_DEFAULT,
  education: FUNDING_DEFAULT,
  park: FUNDING_DEFAULT,
  transit: FUNDING_DEFAULT,
});

export const newProgress =(): Progress => ({ peakPopulation: 0, rank: 0, achievements: [], monthsPositive: 0, loansClosed: 0, plotsBought: 0 });

export function createGame(opts: NewGameOptions = {}): GameState {
  const width = opts.width ?? DEFAULT_MAP_SIZE;
  const height = opts.height ?? DEFAULT_MAP_SIZE;
  const seed = opts.seed ?? 1;
  const size = width * height;
  const state: GameState = {
    name: opts.name ?? 'Ciudad nueva',
    seed,
    rng: seed,
    map: {
      width,
      height,
      terrain: opts.flat ? new Uint8Array(size) : generateTerrain(width, height, seed, opts.waterLevel),
      road: new Uint8Array(size),
      zoneType: new Uint8Array(size),
      zoneDensity: new Uint8Array(size),
      lotLevel: new Uint8Array(size),
      lotOccupants: new Uint16Array(size),
      building: new Int32Array(size).fill(NO_BUILDING),
      powerLine: new Uint8Array(size),
      waterPipe: new Uint8Array(size),
      fire: new Uint8Array(size),
      metro: new Uint8Array(size),
    },
    layers: {
      roadAccess: new Uint8Array(size).fill(NO_ACCESS),
      roadEntry: new Int32Array(size).fill(-1),
      traffic: new Float32Array(size),
      commute: new Float32Array(size).fill(-1),
      powered: new Uint8Array(size),
      watered: new Uint8Array(size),
      coverage: {
        police: new Float32Array(size),
        fire: new Float32Array(size),
        health: new Float32Array(size),
        education: new Float32Array(size),
        park: new Float32Array(size),
      },
      pollution: new Float32Array(size),
      crime: new Float32Array(size),
      landValue: new Float32Array(size),
      happiness: new Float32Array(size),
      transitShare: new Float32Array(size),
      transitMode: new Uint8Array(size),
      transitCoverage: new Uint8Array(size),
      ridership: new Map(),
      transitStops: new Map(),
    },
    buildings: new Map(),
    nextBuildingId: 1,
    economy: {
      money: opts.money ?? START_MONEY,
      taxes: { R: TAX_DEFAULT, C: TAX_DEFAULT, I: TAX_DEFAULT },
      funding: newFunding(),
      ordinances: [],
      loans: [],
      nextLoanId: 1,
      lastMonth: null,
      history: [],
      monthsInDebt: 0,
      bankrupt: false,
    },
    stats: {
      population: 0,
      workforce: 0,
      employed: 0,
      jobs: { C: 0, I: 0, services: 0 },
      workers: { C: 0, I: 0, services: 0 },
      demand: { R: 0, C: 0, I: 0 },
      happiness: 50,
      traffic: { trips: 0, congestedShare: 0, avgCommute: 0 },
      transit: newTransitStats(),
    },
    progress: newProgress(),
    land: null,
    scenario: null,
    sandbox: !!opts.sandbox,
    tutorial: opts.tutorial ? { step: 0 } : null,
    incidents: newIncidents(opts.incidents ?? 0),
    agora: newAgora(seed, !!opts.elections && !opts.sandbox),
    districts: [],
    nextDistrictId: 1,
    utilities: { power: { production: 0, demand: 0 }, water: { production: 0, demand: 0 } },
    time: { tick: 0, day: 1, month: 1, year: START_YEAR, speed: 1 },
    history: [],
  };
  if (opts.landPlots && !opts.sandbox) setupLand(state);
  return state;
}

export function inBounds(map: GameMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

export function tileIndex(map: GameMap, x: number, y: number): number {
  return y * map.width + x;
}

export function isUnlocked(state: GameState, threshold: number): boolean {
  return state.sandbox || state.progress.peakPopulation >= threshold;
}
