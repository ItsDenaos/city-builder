import type { GameState } from '../../sim/state';
import type { Rect } from '../../sim/types';

/** Todo lo que necesita una función de dibujo para un fotograma. */
export interface Frame {
  ctx: CanvasRenderingContext2D;
  state: GameState;
  vis: Rect;
  /** Casilla → píxel de pantalla (redondeado para que no queden rendijas). */
  px: (tx: number) => number;
  py: (ty: number) => number;
  /** Píxeles por casilla. */
  s: number;
  /** Píxeles que sube una casilla de altura (0 = edificios planos, en las vistas de datos). */
  hs: number;
  /** Segundos, para las animaciones. */
  time: number;
  /** Nivel de detalle: false con mucho zoom de alejamiento. */
  detail: boolean;
}

/** Número pseudoaleatorio estable en [0, 1) para una casilla: la misma casilla siempre se ve igual. */
export function hash2(x: number, y: number, salt = 0): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Ruido suave en [0, 1): interpola valores estables en una rejilla de `scale` casillas. */
export function valueNoise(x: number, y: number, scale: number, salt = 0): number {
  const fx = x / scale;
  const fy = y / scale;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = smooth(fx - ix);
  const ty = smooth(fy - iy);
  const a = hash2(ix, iy, salt);
  const b = hash2(ix + 1, iy, salt);
  const c = hash2(ix, iy + 1, salt);
  const d = hash2(ix + 1, iy + 1, salt);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** Mezcla dos colores #rrggbb (t = 0 → a, t = 1 → b). */
export function mixHex(a: string, b: string, t: number): string {
  const na = parseInt(a.slice(1), 16);
  const nb = parseInt(b.slice(1), 16);
  const c = (shift: number) => Math.round(((na >> shift) & 255) + ((((nb >> shift) & 255) - ((na >> shift) & 255)) * t));
  return `rgb(${c(16)}, ${c(8)}, ${c(0)})`;
}

export function pick<T>(items: readonly T[], r: number): T {
  return items[Math.min(items.length - 1, Math.floor(r * items.length))];
}

const shadeCache = new Map<string, string>();

/** Aclara (f > 1) u oscurece (f < 1) un color #rrggbb. */
export function shade(hex: string, f: number): string {
  const key = `${hex}:${f}`;
  let out = shadeCache.get(key);
  if (!out) {
    const n = parseInt(hex.slice(1), 16);
    const c = (shift: number) => Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * f)));
    out = `rgb(${c(16)}, ${c(8)}, ${c(0)})`;
    shadeCache.set(key, out);
  }
  return out;
}

export function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
