import { getBuildingDef } from '../../sim/data/buildings';
import { ROADS } from '../../sim/data/roads';
import { ZONE_BY_CODE, getZoneDefByCode } from '../../sim/data/zones';
import { NO_BUILDING } from '../../sim/state';
import { TERRAIN_WATER } from '../../sim/types';
import { WORLD } from './palette';
import { type Frame, hash2, mixHex, valueNoise, withAlpha } from './util';

const GROUND_TONES = Array.from({ length: 8 }, (_, k) => mixHex(WORLD.groundLow, WORLD.groundHigh, k / 7));
/** Tono del terreno libre en una casilla (estable). */
export const groundTone = (x: number, y: number) =>
  GROUND_TONES[Math.min(7, Math.floor((valueNoise(x, y, 9, 21) * 0.75 + hash2(x, y) * 0.25) * 8))];

const isWater = (f: Frame, x: number, y: number) => {
  const { map } = f.state;
  return x >= 0 && y >= 0 && x < map.width && y < map.height && map.terrain[y * map.width + x] === TERRAIN_WATER;
};

/**
 * Zócalo de la maqueta: la ciudad se apoya en una base de mármol que asoma por el borde sur,
 * con su sombra sobre la mesa. Es la "ciudad en alto" de la marca.
 */
export function drawPlinth(f: Frame): void {
  const { ctx, state, px, py, s } = f;
  const { width: w, height: h } = state.map;
  const x0 = px(0);
  const x1 = px(w);
  const y0 = py(0);
  const y1 = py(h);
  const depth = Math.max(4, Math.round(s * 0.7));
  // Sombra sobre la mesa (hacia el sureste, como el resto de sombras)
  ctx.fillStyle = WORLD.plinthShadow;
  ctx.fillRect(x0 + depth, y1 + depth * 0.6, x1 - x0, depth * 1.6);
  ctx.fillRect(x1, y0 + depth, depth * 0.9, y1 - y0 + depth);
  // Cara frontal del zócalo con su canto superior iluminado y la base en sombra
  ctx.fillStyle = WORLD.plinth;
  ctx.fillRect(x0, y1, x1 - x0, depth);
  ctx.fillStyle = WORLD.plinthTop;
  ctx.fillRect(x0, y1, x1 - x0, Math.max(1, Math.round(depth * 0.18)));
  ctx.fillStyle = WORLD.plinthShade;
  ctx.fillRect(x0, y1 + depth - Math.max(1, Math.round(depth * 0.12)), x1 - x0, Math.max(1, Math.round(depth * 0.12)));
}

/** Terreno, orillas, parcelas, patios de los lotes y suelo bajo los edificios. */
export function drawGround(f: Frame): void {
  const { ctx, state, vis, px, py, s, detail, time } = f;
  const { map } = state;
  const parcels: [number, number, number, number, string][] = [];

  for (let y = vis.y0; y <= vis.y1; y++) {
    const sy = py(y);
    const sh = py(y + 1) - sy;
    for (let x = vis.x0; x <= vis.x1; x++) {
      const i = y * map.width + x;
      const sx = px(x);
      const sw = px(x + 1) - sx;

      if (map.terrain[i] === TERRAIN_WATER) {
        ctx.fillStyle = WORLD.water;
        ctx.fillRect(sx, sy, sw, sh);
        // Reflejos: un trazo claro que respira, como la luz sobre el agua de una maqueta
        if (detail && s >= 12 && !map.road[i] && hash2(x, y, 7) < 0.45) {
          const r = hash2(x, y, 8);
          const phase = Math.sin(time * 0.9 + r * 6.28);
          ctx.fillStyle = withAlpha(WORLD.waterLight, 0.25 + 0.2 * phase);
          ctx.fillRect(sx + sw * (0.15 + r * 0.45) + phase * s * 0.05, sy + sh * (0.3 + r * 0.35), s * 0.24, Math.max(1, s * 0.035));
        }
        continue;
      }

      const type = ZONE_BY_CODE[map.zoneType[i]];
      if (map.building[i] !== NO_BUILDING) {
        const b = state.buildings.get(map.building[i])!;
        ctx.fillStyle = getBuildingDef(b.defId)?.category === 'parks' ? WORLD.parkGround : WORLD.pavement;
      } else if (type && map.lotLevel[i]) {
        ctx.fillStyle = WORLD.yard[type];
      } else {
        ctx.fillStyle = groundTone(x, y);
      }
      ctx.fillRect(sx, sy, sw, sh);

      // Parcela zonificada sin construir: tinte suave y línea discontinua, como en un plano
      if (type && !map.lotLevel[i]) {
        const color = getZoneDefByCode(map.zoneType[i], map.zoneDensity[i]).color;
        ctx.fillStyle = withAlpha(color, 0.3);
        ctx.fillRect(sx, sy, sw, sh);
        if (detail) parcels.push([sx, sy, sw, sh, color]);
      }

      // Orilla
      if (detail) {
        const t = Math.max(1, Math.round(s * 0.14));
        ctx.fillStyle = WORLD.shore;
        if (isWater(f, x - 1, y)) ctx.fillRect(sx, sy, t, sh);
        if (isWater(f, x + 1, y)) ctx.fillRect(sx + sw - t, sy, t, sh);
        if (isWater(f, x, y - 1)) ctx.fillRect(sx, sy, sw, t);
        if (isWater(f, x, y + 1)) ctx.fillRect(sx, sy + sh - t, sw, t);
      }
    }
  }

  if (parcels.length) {
    ctx.setLineDash([Math.max(2, s * 0.14), Math.max(2, s * 0.09)]);
    ctx.lineWidth = Math.max(1, s * 0.045);
    const m = Math.max(1, s * 0.12);
    for (const [sx, sy, sw, sh, color] of parcels) {
      ctx.strokeStyle = withAlpha(color, 0.95);
      ctx.strokeRect(sx + m, sy + m, sw - 2 * m, sh - 2 * m);
    }
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
  }
}

/** Calles y avenidas: asfalto grafito, aceras, línea mármol y eje de oro en las avenidas; puentes con barandilla. */
export function drawRoads(f: Frame): void {
  const { ctx, state, vis, px, py, s, detail } = f;
  const { map } = state;
  const road = (x: number, y: number) => x >= 0 && y >= 0 && x < map.width && y < map.height && map.road[y * map.width + x] !== 0;

  for (let y = vis.y0; y <= vis.y1; y++) {
    const sy = py(y);
    const sh = py(y + 1) - sy;
    for (let x = vis.x0; x <= vis.x1; x++) {
      const i = y * map.width + x;
      if (!map.road[i]) continue;
      const sx = px(x);
      const sw = px(x + 1) - sx;
      const avenue = map.road[i] === ROADS.avenue.code;
      const bridge = map.terrain[i] === TERRAIN_WATER;
      const [l, r, u, d] = [road(x - 1, y), road(x + 1, y), road(x, y - 1), road(x, y + 1)];

      ctx.fillStyle = bridge ? WORLD.bridge : avenue ? WORLD.avenue : WORLD.street;
      ctx.fillRect(sx, sy, sw, sh);
      if (!detail) continue;

      const t = Math.max(1, Math.round(s * (bridge ? 0.07 : 0.12)));
      ctx.fillStyle = bridge ? WORLD.rail : WORLD.sidewalk;
      if (!l) ctx.fillRect(sx, sy, t, sh);
      if (!r) ctx.fillRect(sx + sw - t, sy, t, sh);
      if (!u) ctx.fillRect(sx, sy, sw, t);
      if (!d) ctx.fillRect(sx, sy + sh - t, sw, t);
      // Esquinas de acera en los cruces
      if (!bridge && s >= 16) {
        if (l && u && !road(x - 1, y - 1)) ctx.fillRect(sx, sy, t, t);
        if (r && u && !road(x + 1, y - 1)) ctx.fillRect(sx + sw - t, sy, t, t);
        if (l && d && !road(x - 1, y + 1)) ctx.fillRect(sx, sy + sh - t, t, t);
        if (r && d && !road(x + 1, y + 1)) ctx.fillRect(sx + sw - t, sy + sh - t, t, t);
      }

      // Línea central solo en tramos rectos
      const horizontal = (l || r) && !u && !d;
      const vertical = (u || d) && !l && !r;
      if (!horizontal && !vertical) continue;
      const lw = Math.max(1, Math.round(s * 0.045));
      if (avenue) {
        // El eje de oro: las avenidas son los grandes ejes de la ciudad
        ctx.fillStyle = WORLD.avenueLine;
        if (horizontal) {
          ctx.fillRect(sx, sy + sh / 2 - lw * 1.5, sw, lw);
          ctx.fillRect(sx, sy + sh / 2 + lw * 0.5, sw, lw);
        } else {
          ctx.fillRect(sx + sw / 2 - lw * 1.5, sy, lw, sh);
          ctx.fillRect(sx + sw / 2 + lw * 0.5, sy, lw, sh);
        }
      } else {
        ctx.fillStyle = WORLD.lane;
        if (horizontal) ctx.fillRect(sx + sw * 0.32, sy + (sh - lw) / 2, sw * 0.36, lw);
        else ctx.fillRect(sx + (sw - lw) / 2, sy + sh * 0.32, lw, sh * 0.36);
      }
    }
  }
}

/** Tendido eléctrico: postes con cruceta en el centro de la casilla y cables hacia los vecinos que conducen. */
export function drawPowerLines(f: Frame, conducts: (i: number) => boolean): void {
  const { ctx, state, vis, px, py, s } = f;
  const { map } = state;
  if (s < 4) return;
  ctx.strokeStyle = WORLD.wire;
  ctx.lineWidth = Math.max(1, s * 0.035);
  ctx.beginPath();
  const poles: [number, number][] = [];
  for (let y = vis.y0; y <= vis.y1; y++) {
    for (let x = vis.x0; x <= vis.x1; x++) {
      if (!map.powerLine[y * map.width + x]) continue;
      const cx = (px(x) + px(x + 1)) / 2;
      const cy = (py(y) + py(y + 1)) / 2 - f.hs * 0.5; // cables a media casilla de altura
      poles.push([cx, cy]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height || !conducts(ny * map.width + nx)) continue;
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + (dx * s) / 2, cy + (dy * s) / 2 + (dy === 0 ? s * 0.04 : 0));
      }
    }
  }
  ctx.stroke();
  const w = Math.max(1, s * 0.07);
  for (const [cx, cy] of poles) {
    ctx.fillStyle = WORLD.shadow;
    ctx.fillRect(cx, cy + f.hs * 0.5 - w, f.hs * 0.4 + w, w);
    ctx.fillStyle = WORLD.pylon;
    ctx.fillRect(cx - w / 2, cy, w, f.hs * 0.5);
    ctx.fillRect(cx - s * 0.18, cy, s * 0.36, w);
  }
  ctx.lineWidth = 1;
}
