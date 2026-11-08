import { roadCapacity } from '../../sim/systems/traffic';
import { CARS } from './palette';
import { type Frame, hash2, pick } from './util';

const CAR_COLORS = CARS;
const MAX_CARS_PER_TILE = 4;

/**
 * Coches de adorno: cuantos más viajes tiene una casilla, más coches; con atasco van más despacio.
 * Circulan por la derecha, en los dos sentidos.
 */
export function drawCars(f: Frame): void {
  const { ctx, state, vis, px, py, s, time } = f;
  const { map, layers } = state;
  if (!f.detail || s < 12) return;
  const road = (x: number, y: number) => x >= 0 && y >= 0 && x < map.width && y < map.height && map.road[y * map.width + x] !== 0;
  const len = s * 0.26;
  const wid = s * 0.14;

  for (let y = vis.y0; y <= vis.y1; y++) {
    for (let x = vis.x0; x <= vis.x1; x++) {
      const i = y * map.width + x;
      const t = layers.traffic[i];
      if (!map.road[i] || t < 2) continue;
      const load = t / roadCapacity(map, i);
      const cars = Math.min(MAX_CARS_PER_TILE, Math.max(1, Math.ceil(load * MAX_CARS_PER_TILE)));
      const speed = 0.5 * (1 - Math.min(0.85, load * 0.7));
      const horizontalRoad = road(x - 1, y) || road(x + 1, y);
      const verticalRoad = road(x, y - 1) || road(x, y + 1);
      // En los giros (dibujados en curva) no se pintan coches: irían en línea recta por fuera del asfalto
      const links = [road(x - 1, y), road(x + 1, y), road(x, y - 1), road(x, y + 1)].filter(Boolean).length;
      if (links === 2 && horizontalRoad && verticalRoad) continue;
      const sx = px(x);
      const sy = py(y);
      for (let k = 0; k < cars; k++) {
        const r = hash2(x, y, 20 + k);
        // En los cruces cada coche va en un eje
        const horizontal = horizontalRoad && (!verticalRoad || r < 0.5);
        const forward = k % 2 === 0;
        let p = (time * speed + r) % 1;
        if (!forward) p = 1 - p;
        ctx.fillStyle = pick(CAR_COLORS, hash2(x, y, 40 + k));
        // De noche (fase 20) cada coche lleva los faros delante, en el sentido de la marcha
        const lamp = Math.max(1, wid * 0.5);
        if (horizontal) {
          const cy = sy + s * (forward ? 0.6 : 0.4);
          const cx = sx + p * s;
          ctx.fillRect(cx - len / 2, cy - wid / 2, len, wid);
          if (f.night > 0.3) f.headlights.push(forward ? cx + len / 2 : cx - len / 2 - lamp, cy - lamp / 2, lamp, lamp);
        } else {
          const cx = sx + s * (forward ? 0.4 : 0.6);
          const cy = sy + p * s;
          ctx.fillRect(cx - wid / 2, cy - len / 2, wid, len);
          if (f.night > 0.3) f.headlights.push(cx - lamp / 2, forward ? cy + len / 2 : cy - len / 2 - lamp, lamp, lamp);
        }
      }
    }
  }
}
