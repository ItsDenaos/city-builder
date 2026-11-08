import type { Point, Rect } from './types';

export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x0: Math.min(a.x, b.x),
    y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x),
    y1: Math.max(a.y, b.y),
  };
}

export function clipRect(r: Rect, width: number, height: number): Rect | null {
  const c = {
    x0: Math.max(0, r.x0),
    y0: Math.max(0, r.y0),
    x1: Math.min(width - 1, r.x1),
    y1: Math.min(height - 1, r.y1),
  };
  return c.x0 > c.x1 || c.y0 > c.y1 ? null : c;
}

export function rectPoints(r: Rect): Point[] {
  const pts: Point[] = [];
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) pts.push({ x, y });
  return pts;
}

/**
 * Esquinas de una rejilla de huecos de w × h que cubre el rectángulo (al menos uno), empezando en su esquina.
 * Sirve para colocar varios edificios de una vez arrastrando.
 */
export function gridPositions(r: Rect, w: number, h: number): Point[] {
  const pts: Point[] = [];
  for (let y = r.y0; y <= Math.max(r.y0, r.y1 - h + 1); y += h) {
    for (let x = r.x0; x <= Math.max(r.x0, r.x1 - w + 1); x += w) pts.push({ x, y });
  }
  return pts;
}

/**
 * Camino curvo entre dos casillas (fase 2, carreteras curvas): una curva de Bézier cuadrática con el punto de
 * control en el codo del camino en «L», pasada a casillas unidas por un lado (en cada paso en diagonal se añade
 * la casilla intermedia más cercana a la curva). Si las dos casillas están en la misma fila o columna, es recto.
 */
export function curvePath(from: Point, to: Point): Point[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (!dx || !dy) return roadPath(from, to);
  const c = Math.abs(dx) >= Math.abs(dy) ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
  const n = 4 * (Math.abs(dx) + Math.abs(dy));
  const pts: Point[] = [{ x: from.x, y: from.y }];
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    const u = 1 - t;
    const fx = u * u * from.x + 2 * u * t * c.x + t * t * to.x;
    const fy = u * u * from.y + 2 * u * t * c.y + t * t * to.y;
    const x = Math.round(fx);
    const y = Math.round(fy);
    const last = pts[pts.length - 1];
    if (x === last.x && y === last.y) continue;
    if (x !== last.x && y !== last.y) {
      const a = { x, y: last.y };
      const b = { x: last.x, y };
      pts.push(Math.hypot(a.x - fx, a.y - fy) <= Math.hypot(b.x - fx, b.y - fy) ? a : b);
    }
    pts.push({ x, y });
  }
  return pts;
}

/** Camino en "L" entre dos casillas; empieza por el eje con mayor distancia. */
export function roadPath(from: Point, to: Point): Point[] {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  const horizontalFirst = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
  let { x, y } = from;
  const pts: Point[] = [{ x, y }];
  const walkX = () => {
    while (x !== to.x) pts.push({ x: (x += dx), y });
  };
  const walkY = () => {
    while (y !== to.y) pts.push({ x, y: (y += dy) });
  };
  if (horizontalFirst) {
    walkX();
    walkY();
  } else {
    walkY();
    walkX();
  }
  return pts;
}
