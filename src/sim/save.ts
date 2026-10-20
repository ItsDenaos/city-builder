import { rankFor } from './data/progression';
import { refreshDerived } from './simulation';
import { type BuildingInstance, type GameMap, type GameState, createGame, newAgora, newIncidents, newProgress } from './state';

/**
 * Súbela si cambia el formato y añade la migración en deserialize.
 * v2: progreso con rango, logros y contadores; terreno por parcelas; escenarios.
 * v3: modo libre, primeros pasos, eventos y desastres (capa de incendios), Ágora y elecciones.
 */
export const SAVE_VERSION = 3;

// Capas del mapa que se guardan; las derivadas (acceso, redes, influencia, tráfico) se recalculan al cargar.
const MAP_LAYERS = ['terrain', 'road', 'zoneType', 'zoneDensity', 'lotLevel', 'lotOccupants', 'building', 'powerLine', 'waterPipe', 'fire'] as const;
type MapLayer = (typeof MAP_LAYERS)[number];

export interface SaveMeta {
  name: string;
  savedAt: string; // ISO
  population: number;
  money: number;
  date: { day: number; month: number; year: number };
  sandbox?: boolean;
}

export interface SaveData {
  version: number;
  meta: SaveMeta;
  state: Omit<GameState, 'map' | 'layers' | 'buildings'> & {
    // Las capas que no existían en versiones anteriores pueden faltar
    map: { width: number; height: number; layers: Partial<Record<MapLayer, string>>; traffic: string };
    buildings: BuildingInstance[];
  };
}

function toBase64(arr: ArrayBufferView): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(b64: string, target: Uint8Array | Uint16Array | Int32Array | Float32Array): void {
  const binary = atob(b64);
  const bytes = new Uint8Array(target.buffer, target.byteOffset, target.byteLength);
  if (binary.length !== bytes.length) throw new Error('La partida está dañada: el tamaño de una capa no coincide.');
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
}

export function saveMeta(state: GameState): SaveMeta {
  const { day, month, year } = state.time;
  return {
    name: state.name,
    savedAt: new Date().toISOString(),
    population: state.stats.population,
    money: Math.round(state.economy.money),
    date: { day, month, year },
    sandbox: state.sandbox,
  };
}

export function serialize(state: GameState): SaveData {
  const { map, layers, buildings, ...rest } = state;
  const encoded = Object.fromEntries(MAP_LAYERS.map((k) => [k, toBase64(map[k])])) as Record<MapLayer, string>;
  return {
    version: SAVE_VERSION,
    meta: saveMeta(state),
    // structuredClone evita que la partida guardada comparta objetos con la que sigue en juego
    state: structuredClone({
      ...rest,
      map: { width: map.width, height: map.height, layers: encoded, traffic: toBase64(layers.traffic) },
      buildings: [...buildings.values()],
    }),
  };
}

/** Reconstruye una partida; lanza un Error con un mensaje para el jugador si no se puede. */
export function deserialize(data: unknown): GameState {
  const save = data as SaveData;
  if (!save || typeof save !== 'object' || typeof save.version !== 'number' || !save.state?.map) {
    throw new Error('El archivo no es una partida de AKROPOLIS.');
  }
  if (save.version > SAVE_VERSION) throw new Error('La partida es de una versión más nueva del juego.');

  const { map: savedMap, buildings, ...rest } = save.state;
  const state = createGame({ width: savedMap.width, height: savedMap.height, seed: rest.seed, flat: true });
  for (const k of MAP_LAYERS) {
    const layer = savedMap.layers[k];
    if (layer) fromBase64(layer, (state.map as GameMap)[k]);
  }
  Object.assign(state, structuredClone(rest));
  // Partidas v1: el progreso solo tenía la población máxima; el resto toma valores iniciales
  const saved = (rest as Partial<GameState>).progress;
  state.progress = { ...newProgress(), ...saved, rank: saved?.rank ?? rankFor(saved?.peakPopulation ?? 0) };
  state.land ??= null;
  state.scenario ??= null;
  state.sandbox ??= false;
  state.tutorial ??= null;
  state.incidents = { ...newIncidents(0), ...(rest as Partial<GameState>).incidents };
  state.agora = { ...newAgora(state.seed, false), ...(rest as Partial<GameState>).agora };
  state.buildings = new Map(buildings.map((b) => [b.id, { ...b }]));
  const traffic = new Float32Array(savedMap.width * savedMap.height);
  fromBase64(savedMap.traffic, traffic);
  refreshDerived(state, traffic);
  return state;
}
