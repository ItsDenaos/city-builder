import { clipRect } from './geometry';
import { type GameState, tileIndex } from './state';
import { type Rect, TERRAIN_WATER } from './types';

/**
 * Casillas del rectángulo que están a `depth` pasos o menos de una carretera (a pie, sin cruzar agua,
 * como el acceso de las zonas). Es la franja que se zonifica junto a las calles.
 * Cuenta cualquier carretera, aunque aún no llegue al borde del mapa.
 */
export function roadStrip(state: GameState, rect: Rect, depth: number): Set<number> {
  const { map } = state;
  const out = new Set<number>();
  const inner = clipRect(rect, map.width, map.height);
  const area = clipRect({ x0: rect.x0 - depth, y0: rect.y0 - depth, x1: rect.x1 + depth, y1: rect.y1 + depth }, map.width, map.height);
  if (!inner || !area) return out;
  const w = area.x1 - area.x0 + 1;
  const h = area.y1 - area.y0 + 1;
  const dist = new Uint8Array(w * h).fill(255);
  const queue = new Int32Array(w * h);
  let tail = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (map.road[tileIndex(map, area.x0 + x, area.y0 + y)]) {
        dist[y * w + x] = 0;
        queue[tail++] = y * w + x;
      }
    }
  }
  for (let head = 0; head < tail; head++) {
    const k = queue[head];
    const d = dist[k];
    if (d >= depth) continue;
    const x = k % w;
    const y = (k - x) / w;
    const visit = (nx: number, ny: number) => {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
      const n = ny * w + nx;
      if (dist[n] !== 255 || map.terrain[tileIndex(map, area.x0 + nx, area.y0 + ny)] === TERRAIN_WATER) return;
      dist[n] = d + 1;
      queue[tail++] = n;
    };
    visit(x - 1, y);
    visit(x + 1, y);
    visit(x, y - 1);
    visit(x, y + 1);
  }
  for (let y = inner.y0; y <= inner.y1; y++) {
    for (let x = inner.x0; x <= inner.x1; x++) {
      const d = dist[(y - area.y0) * w + (x - area.x0)];
      if (d >= 1 && d <= depth) out.add(tileIndex(map, x, y));
    }
  }
  return out;
}
