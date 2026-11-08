import { rankFor } from './data/progression';
import { refreshDerived } from './simulation';
import { type BuildingInstance, type GameMap, type GameState, createGame, newAgora, newDemography, newEducationStats, newFunding, newGarbageStats, newHealthStats, newIncidents, newProgress, newTourismStats, newTransitStats, newWeather } from './state';

/**
 * Súbela si cambia el formato y añade la migración en deserialize.
 * v2: progreso con rango, logros y contadores; terreno por parcelas; escenarios.
 * v3: modo libre, primeros pasos, eventos y desastres (capa de incendios), Ágora y elecciones.
 * v4: financiación por departamento, ordenanzas y distritos con nombre.
 * v5: transporte público (capa de túneles de metro y financiación del transporte).
 * v6: basura y salud (capa de basura, carga de los vertederos y financiación de residuos).
 * v7: educación y edades (reparto de la población por edades y estudios).
 * v8: monumentos y turismo (estadísticas de turismo).
 * v9: clima.
 * v10: capas comprimidas con PackBits (prefijo «p:»); las de antes, en base64 sin comprimir, se siguen leyendo.
 */
export const SAVE_VERSION = 10;

// Capas del mapa que se guardan; las derivadas (acceso, redes, influencia, tráfico) se recalculan al cargar.
const MAP_LAYERS = ['terrain', 'road', 'zoneType', 'zoneDensity', 'lotLevel', 'lotOccupants', 'building', 'powerLine', 'waterPipe', 'fire', 'metro', 'garbage'] as const;
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

const DAMAGED = 'La partida está dañada: el tamaño de una capa no coincide.';
const PACKED = 'p:';

function bytesOf(arr: ArrayBufferView): Uint8Array {
  return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * Compresión PackBits: una cabecera h y después h + 1 bytes tal cual (h < 128) o un byte que se repite 257 − h veces
 * (h > 128). Las capas son casi todo ceros y rachas largas, así que una partida de 256 × 256 baja de 2 MB a unos
 * cientos de KB, y escribirla en el almacenamiento del navegador ya no frena el dibujo.
 */
export function packBits(bytes: Uint8Array): Uint8Array {
  const n = bytes.length;
  const out = new Uint8Array(n + Math.ceil(n / 128) + 1);
  let o = 0;
  let i = 0;
  while (i < n) {
    let run = 1;
    while (i + run < n && run < 128 && bytes[i + run] === bytes[i]) run++;
    if (run >= 3) {
      out[o++] = 257 - run;
      out[o++] = bytes[i];
      i += run;
      continue;
    }
    // Bytes sueltos hasta la siguiente racha de tres iguales (o 128 como mucho)
    const start = i;
    while (i < n && i - start < 128 && !(i + 2 < n && bytes[i] === bytes[i + 1] && bytes[i] === bytes[i + 2])) i++;
    out[o++] = i - start - 1;
    out.set(bytes.subarray(start, i), o);
    o += i - start;
  }
  return out.slice(0, o);
}

export function unpackBits(src: Uint8Array, target: Uint8Array): void {
  let o = 0;
  let i = 0;
  while (i < src.length) {
    const h = src[i++];
    if (h < 128) {
      const len = h + 1;
      if (o + len > target.length || i + len > src.length) throw new Error(DAMAGED);
      target.set(src.subarray(i, i + len), o);
      i += len;
      o += len;
    } else if (h > 128) {
      const len = 257 - h;
      if (o + len > target.length || i >= src.length) throw new Error(DAMAGED);
      target.fill(src[i++], o, o + len);
      o += len;
    }
  }
  if (o !== target.length) throw new Error(DAMAGED);
}

function encodeLayer(arr: ArrayBufferView): string {
  return PACKED + bytesToBase64(packBits(bytesOf(arr)));
}

function decodeLayer(text: string, target: Uint8Array | Uint16Array | Int32Array | Float32Array): void {
  const packed = text.startsWith(PACKED);
  const binary = atob(packed ? text.slice(PACKED.length) : text);
  const bytes = bytesOf(target);
  if (packed) {
    const src = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) src[i] = binary.charCodeAt(i);
    unpackBits(src, bytes);
    return;
  }
  // Partidas v1-v9: base64 sin comprimir
  if (binary.length !== bytes.length) throw new Error(DAMAGED);
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
  const encoded = Object.fromEntries(MAP_LAYERS.map((k) => [k, encodeLayer(map[k])])) as Record<MapLayer, string>;
  return {
    version: SAVE_VERSION,
    meta: saveMeta(state),
    // structuredClone evita que la partida guardada comparta objetos con la que sigue en juego
    state: structuredClone({
      ...rest,
      map: { width: map.width, height: map.height, layers: encoded, traffic: encodeLayer(layers.traffic) },
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
    if (layer) decodeLayer(layer, (state.map as GameMap)[k]);
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
  // Partidas v1-v3: sin financiación por departamento, ordenanzas ni distritos (v1-v4: sin la del transporte)
  state.economy.funding = { ...newFunding(), ...state.economy.funding };
  state.economy.ordinances ??= [];
  state.districts ??= [];
  // Partidas v1-v5: sin estadísticas de basura y salud; la basura y la salud se activan (son parte del juego)
  state.stats.garbage = { ...newGarbageStats(), ...state.stats.garbage };
  state.stats.health = { ...newHealthStats(), ...state.stats.health };
  state.stats.transit = { ...newTransitStats(), ...state.stats.transit };
  state.sanitation = (rest as Partial<GameState>).sanitation ?? true;
  // Partidas v1-v6: sin edades ni estudios; se activan con la mezcla de una ciudad nueva
  state.demographics = (rest as Partial<GameState>).demographics ?? true;
  state.demography = { ...newDemography(), ...(rest as Partial<GameState>).demography };
  state.stats.education = { ...newEducationStats(), ...state.stats.education };
  state.stats.tourism = { ...newTourismStats(), ...state.stats.tourism };
  // Partidas v1-v8: sin clima; empieza despejado
  state.weather = { ...newWeather(state.seed), ...(rest as Partial<GameState>).weather };
  state.nextDistrictId ??= 1;
  state.buildings = new Map(buildings.map((b) => [b.id, { ...b }]));
  const traffic = new Float32Array(savedMap.width * savedMap.height);
  decodeLayer(savedMap.traffic, traffic);
  refreshDerived(state, traffic);
  return state;
}
