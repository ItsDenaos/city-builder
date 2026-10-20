import { mulberry32 } from './rng';
import { TERRAIN_LAND, TERRAIN_WATER } from './types';

interface Octave {
  cell: number;
  amp: number;
  gw: number;
  grid: Float32Array;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function sample(o: Octave, x: number, y: number): number {
  const fx = x / o.cell;
  const fy = y / o.cell;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = smooth(fx - ix);
  const ty = smooth(fy - iy);
  const g = o.grid;
  const a = g[iy * o.gw + ix];
  const b = g[iy * o.gw + ix + 1];
  const c = g[(iy + 1) * o.gw + ix];
  const d = g[(iy + 1) * o.gw + ix + 1];
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

/** Genera el terreno con ruido de valor en varias octavas: lagos y costas donde el ruido es bajo. */
export function generateTerrain(width: number, height: number, seed: number, waterLevel = 0.36): Uint8Array {
  const rand = mulberry32(seed);
  const octaves: Octave[] = [
    { cell: 32, amp: 0.6 },
    { cell: 12, amp: 0.3 },
    { cell: 5, amp: 0.1 },
  ].map(({ cell, amp }) => {
    const gw = Math.ceil(width / cell) + 2;
    const gh = Math.ceil(height / cell) + 2;
    const grid = new Float32Array(gw * gh);
    for (let i = 0; i < grid.length; i++) grid[i] = rand();
    return { cell, amp, gw, grid };
  });

  const terrain = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let n = 0;
      for (const o of octaves) n += o.amp * sample(o, x, y);
      terrain[y * width + x] = n < waterLevel ? TERRAIN_WATER : TERRAIN_LAND;
    }
  }
  return terrain;
}
