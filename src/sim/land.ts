import { PLOT_SIZE, RANKS, START_PLOTS, plotCost } from './data/progression';
import { ROADS } from './data/roads';
import type { GameState } from './state';
import { TERRAIN_WATER } from './types';

/**
 * Terreno comprable: el mapa se divide en parcelas de PLOT_SIZE × PLOT_SIZE.
 * Se empieza con un cuadrado de START_PLOTS × START_PLOTS unido al exterior por una autopista,
 * y se compran parcelas vecinas a medida que la ciudad sube de rango.
 * Con `land = null` (tests, modo libre, partidas antiguas) todo el mapa es del jugador.
 */
export interface LandState {
  plotSize: number;
  cols: number;
  rows: number;
  /** 1 = parcela propia. Array normal (no tipado) para que viaje bien en JSON. */
  owned: number[];
}

export function plotAt(land: LandState, x: number, y: number): number {
  return Math.floor(y / land.plotSize) * land.cols + Math.floor(x / land.plotSize);
}

export function ownsTile(state: GameState, x: number, y: number): boolean {
  const { land } = state;
  return !land || land.owned[plotAt(land, x, y)] === 1;
}

export const ownedPlots = (land: LandState) => land.owned.reduce((n, v) => n + v, 0);

/** Centro (en casillas) del terreno propio: ahí empieza la cámara. Sin terreno, el centro del mapa. */
export function landCenter(state: GameState): { x: number; y: number } {
  const { land, map } = state;
  let x = 0;
  let y = 0;
  let n = 0;
  land?.owned.forEach((owned, plot) => {
    if (!owned) return;
    x += ((plot % land.cols) + 0.5) * land.plotSize;
    y += (Math.floor(plot / land.cols) + 0.5) * land.plotSize;
    n++;
  });
  return n ? { x: x / n, y: y / n } : { x: map.width / 2, y: map.height / 2 };
}

/** Motivo por el que no se puede comprar una parcela (null si se puede, sin contar el dinero). */
export function plotBlocker(state: GameState, plot: number): string | null {
  const { land } = state;
  if (!land) return 'En esta partida todo el terreno es tuyo';
  if (plot < 0 || plot >= land.owned.length) return 'Fuera del mapa';
  if (land.owned[plot]) return 'Esta parcela ya es tuya';
  const px = plot % land.cols;
  const py = (plot - px) / land.cols;
  const neighbor = (x: number, y: number) => x >= 0 && y >= 0 && x < land.cols && y < land.rows && land.owned[y * land.cols + x] === 1;
  if (!neighbor(px - 1, py) && !neighbor(px + 1, py) && !neighbor(px, py - 1) && !neighbor(px, py + 1)) {
    return 'Solo se pueden comprar parcelas junto a las tuyas';
  }
  const rank = RANKS[state.progress.rank];
  if (ownedPlots(land) >= rank.maxPlots) {
    const next = RANKS.find((r) => r.maxPlots > rank.maxPlots);
    return next ? `Con el rango ${rank.name} no puedes tener más parcelas: llega a ${next.name}` : 'No quedan parcelas';
  }
  return null;
}

export const nextPlotCost = (state: GameState) => plotCost(state.progress.plotsBought);

/**
 * Prepara el terreno de una partida nueva: elige el cuadrado inicial con más tierra (cerca del centro)
 * y traza una autopista hasta él desde el borde más cercano, con puentes si hace falta.
 */
export function setupLand(state: GameState): void {
  const { map } = state;
  const cols = Math.ceil(map.width / PLOT_SIZE);
  const rows = Math.ceil(map.height / PLOT_SIZE);
  const land: LandState = { plotSize: PLOT_SIZE, cols, rows, owned: new Array(cols * rows).fill(0) };
  const n = Math.min(START_PLOTS, cols, rows);

  // 1. Cuadrado inicial: máxima proporción de tierra, desempatando por cercanía al centro
  let best = { px: 0, py: 0, score: -Infinity };
  for (let py = 0; py + n <= rows; py++) {
    for (let px = 0; px + n <= cols; px++) {
      let landTiles = 0;
      let tiles = 0;
      for (let y = py * PLOT_SIZE; y < Math.min(map.height, (py + n) * PLOT_SIZE); y++) {
        for (let x = px * PLOT_SIZE; x < Math.min(map.width, (px + n) * PLOT_SIZE); x++) {
          tiles++;
          if (map.terrain[y * map.width + x] !== TERRAIN_WATER) landTiles++;
        }
      }
      const center = Math.hypot(px + n / 2 - cols / 2, py + n / 2 - rows / 2);
      const score = landTiles / tiles - center * 0.05;
      if (score > best.score) best = { px, py, score };
    }
  }
  for (let y = best.py; y < best.py + n; y++) for (let x = best.px; x < best.px + n; x++) land.owned[y * cols + x] = 1;
  state.land = land;

  // 2. Autopista (avenida) desde el borde más cercano hasta dos casillas dentro del terreno propio
  const x0 = best.px * PLOT_SIZE;
  const y0 = best.py * PLOT_SIZE;
  const x1 = Math.min(map.width, (best.px + n) * PLOT_SIZE) - 1;
  const y1 = Math.min(map.height, (best.py + n) * PLOT_SIZE) - 1;
  const cx = Math.floor((x0 + x1) / 2);
  const cy = Math.floor((y0 + y1) / 2);
  const options = [
    { len: x0, tiles: () => Array.from({ length: x0 + 3 }, (_, k) => [k, cy] as const) },
    { len: map.width - 1 - x1, tiles: () => Array.from({ length: map.width - x1 + 2 }, (_, k) => [map.width - 1 - k, cy] as const) },
    { len: y0, tiles: () => Array.from({ length: y0 + 3 }, (_, k) => [cx, k] as const) },
    { len: map.height - 1 - y1, tiles: () => Array.from({ length: map.height - y1 + 2 }, (_, k) => [cx, map.height - 1 - k] as const) },
  ].sort((a, b) => a.len - b.len);
  for (const [x, y] of options[0].tiles()) map.road[y * map.width + x] = ROADS.avenue.code;
}
