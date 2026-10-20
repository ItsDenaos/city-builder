import { type ServiceType, getBuildingDef } from '../sim/data/buildings';
import { drawFires } from './art/fire';
import { ZONE_CODE } from '../sim/data/zones';
import { type GameMap, type GameState, NO_BUILDING } from '../sim/state';
import { roadCapacity } from '../sim/systems/traffic';
import { conductsPower } from '../sim/systems/utilities';
import { type Point, TERRAIN_WATER } from '../sim/types';
import { drawCity, tileTop } from './art/buildings';
import { drawGround, drawPlinth, drawPowerLines, drawRoads } from './art/ground';
import { drawLand } from './art/land';
import { TileImage } from './art/minimap';
import { WORLD } from './art/palette';
import type { Frame } from './art/util';
import { drawCars } from './art/vehicles';
import type { Camera } from './camera';
import { UI } from '../theme';

/** Píxeles que sube una casilla de altura, por píxel de casilla (perspectiva cenital con volumen). */
const HEIGHT_SCALE = 0.55;
/** Por debajo de este tamaño de casilla se dibuja un píxel por casilla, sin volumen ni adornos. */
const DETAIL_MIN_SCALE = 10;

const COLORS = WORLD;
/** Rejilla de la mesa de trabajo, cada 4 casillas. */
const TABLE_GRID = 4;

export type HeatOverlay = 'pollution' | 'crime' | 'landValue' | 'happiness' | 'police' | 'fire' | 'health' | 'education' | 'park';
export type Overlay = 'none' | 'power' | 'water' | 'traffic' | HeatOverlay;

type Ramp = (v: number) => string;
const rgbOf = (hex: string) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
/** Intensidad de un solo color: transparente con 0, casi opaco con 100. */
const alphaRamp = (hex: string): Ramp => {
  const [r, g, b] = rgbOf(hex);
  return (v) => `rgba(${r}, ${g}, ${b}, ${(0.08 + (v / 100) * 0.72).toFixed(2)})`;
};
/** Malo (0) → regular (50) → bueno (100), con los colores de estado de la paleta. */
const scoreRamp: Ramp = (v) => {
  const t = Math.max(0, Math.min(1, v / 100));
  const [a, b] = t < 0.5 ? [rgbOf(UI.negative), rgbOf(UI.warning)] : [rgbOf(UI.warning), rgbOf(UI.positive)];
  const k = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * k));
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.72)`;
};
/** Los colores se precalculan en pasos de 5 para no crear una cadena por casilla y fotograma. */
const quantized = (ramp: Ramp): Ramp => {
  const steps = Array.from({ length: 21 }, (_, k) => ramp(k * 5));
  return (v) => steps[Math.max(0, Math.min(20, Math.round(v / 5)))];
};
const HEAT_RAMPS: Record<HeatOverlay, Ramp> = {
  pollution: quantized(alphaRamp('#A86B43')),
  crime: quantized(alphaRamp(UI.negative)),
  landValue: quantized(scoreRamp),
  happiness: quantized(scoreRamp),
  police: quantized(alphaRamp('#7FA3D6')),
  fire: quantized(alphaRamp('#E08A5A')),
  health: quantized(alphaRamp('#D08AAE')),
  education: quantized(alphaRamp(UI.gold)),
  park: quantized(alphaRamp('#86B89A')),
};
const trafficRamp = quantized(scoreRamp);

const isConsumer = (map: GameMap, i: number) => map.lotLevel[i] > 0 || map.building[i] !== NO_BUILDING;

/** Color con el que se tiñe cada casilla en una vista de datos (null = solo atenuada). */
function overlayColor(state: GameState, overlay: Overlay): ((i: number) => string | null) | null {
  const { map, layers } = state;
  if (overlay === 'none') return null;
  if (overlay === 'traffic') {
    return (i) => (map.road[i] ? trafficRamp(100 - Math.min(1, layers.traffic[i] / roadCapacity(map, i)) * 100) : null);
  }
  if (overlay === 'power') {
    return (i) => (!conductsPower(map, i) ? null : layers.powered[i] ? COLORS.served : COLORS.unserved);
  }
  if (overlay === 'water') {
    return (i) => (isConsumer(map, i) ? (layers.watered[i] ? COLORS.waterServed : COLORS.unserved) : layers.watered[i] ? COLORS.waterCovered : null);
  }
  const layer = overlay in layers.coverage ? layers.coverage[overlay as ServiceType] : layers[overlay as 'pollution' | 'crime' | 'landValue' | 'happiness'];
  const ramp = HEAT_RAMPS[overlay];
  return (i) => {
    if (map.terrain[i] === TERRAIN_WATER) return null;
    // La felicidad solo existe en lotes residenciales
    if (overlay === 'happiness' && !(map.zoneType[i] === ZONE_CODE.R && map.lotLevel[i])) return null;
    return ramp(layer[i]);
  };
}

export interface ViewState {
  hover: Point | null;
  selected: Point | null;
  preview: { tiles: Point[]; ok: boolean } | null;
  overlay: Overlay;
  /** Rejilla visible (mientras se usa una herramienta de construcción). */
  grid: boolean;
  /** Herramienta de terrenos activa: se marcan las parcelas comprables. */
  landTool?: boolean;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private tileImage = new TileImage();
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(state: GameState, cam: Camera, view: ViewState, timeMs: number): void {
    const { ctx } = this;
    const { map } = state;
    const s = cam.scale;
    const vis = cam.visibleTiles(map.width, map.height);
    // Posición redondeada a píxeles físicos (no CSS): con densidades como 1,5 se evitan costuras entre casillas
    const dpr = this.dpr;
    const px = (tx: number) => Math.round((tx - cam.x) * s * dpr) / dpr;
    const py = (ty: number) => Math.round((ty - cam.y) * s * dpr) / dpr;
    const detail = s >= DETAIL_MIN_SCALE;
    // En las vistas de datos los edificios se aplanan para que el mapa de calor se lea bien
    const flat = view.overlay !== 'none';
    const f: Frame = { ctx, state, vis, px, py, s, hs: flat || !detail ? 0 : s * HEIGHT_SCALE, time: timeMs / 1000, detail };
    const tint = overlayColor(state, view.overlay);

    this.drawTable(cam);
    drawPlinth(f);

    if (!detail) {
      this.tileImage.draw(f, tint, COLORS.dim);
    } else {
      drawGround(f);
      drawRoads(f);
      if (!flat) drawCars(f);
      if (view.grid) this.drawGrid(f);
      drawPowerLines(f, (i) => conductsPower(map, i));
      drawCity(f);
      if (tint) this.drawTint(f, tint);
      drawFires(f);
    }
    drawLand(f, !!view.landTool, view.hover);
    if (view.overlay === 'water') this.drawPipes(f);
    if (!flat) this.drawNoPowerMarks(f);

    // Previsualización de la herramienta
    if (view.preview) {
      ctx.fillStyle = view.preview.ok ? COLORS.previewOk : COLORS.previewBad;
      for (const t of view.preview.tiles) ctx.fillRect(px(t.x), py(t.y), px(t.x + 1) - px(t.x), py(t.y + 1) - py(t.y));
    }

    this.outlineTile(view.selected, COLORS.selected, px, py);
    this.outlineTile(view.hover, COLORS.hover, px, py);

  }

  /** La mesa sobre la que descansa la maqueta: Midnight Slate con una rejilla de plano muy tenue. */
  private drawTable(cam: Camera): void {
    const { ctx } = this;
    const s = cam.scale;
    ctx.fillStyle = COLORS.table;
    ctx.fillRect(0, 0, this.width, this.height);
    const step = TABLE_GRID * s;
    if (step < 12) return;
    ctx.strokeStyle = COLORS.tableGrid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const ox = (((-cam.x * s) % step) + step) % step;
    const oy = (((-cam.y * s) % step) + step) % step;
    for (let x = ox; x < this.width; x += step) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, this.height);
    }
    for (let y = oy; y < this.height; y += step) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(this.width, Math.round(y) + 0.5);
    }
    ctx.stroke();
  }

  private drawGrid(f: Frame): void {
    const { ctx, vis, px, py } = f;
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = vis.x0; x <= vis.x1 + 1; x++) {
      ctx.moveTo(px(x) + 0.5, py(vis.y0));
      ctx.lineTo(px(x) + 0.5, py(vis.y1 + 1));
    }
    for (let y = vis.y0; y <= vis.y1 + 1; y++) {
      ctx.moveTo(px(vis.x0), py(y) + 0.5);
      ctx.lineTo(px(vis.x1 + 1), py(y) + 0.5);
    }
    ctx.stroke();
  }

  /** Vista de datos detallada: atenuar todo de una vez y teñir casilla a casilla. */
  private drawTint(f: Frame, tint: (i: number) => string | null): void {
    const { ctx, state, vis, px, py } = f;
    const { map } = state;
    ctx.fillStyle = COLORS.dim;
    ctx.fillRect(px(vis.x0), py(vis.y0), px(vis.x1 + 1) - px(vis.x0), py(vis.y1 + 1) - py(vis.y0));
    for (let y = vis.y0; y <= vis.y1; y++) {
      for (let x = vis.x0; x <= vis.x1; x++) {
        const color = tint(y * map.width + x);
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(px(x), py(y), px(x + 1) - px(x), py(y + 1) - py(y));
      }
    }
  }

  /** Las tuberías son subterráneas: solo se ven en la vista de agua. */
  private drawPipes(f: Frame): void {
    const { ctx, state, vis, px, py, s } = f;
    const { map } = state;
    ctx.strokeStyle = COLORS.pipe;
    ctx.lineWidth = Math.max(2, s * 0.25);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let y = vis.y0; y <= vis.y1; y++) {
      for (let x = vis.x0; x <= vis.x1; x++) {
        if (!map.waterPipe[y * map.width + x]) continue;
        const cx = (px(x) + px(x + 1)) / 2;
        const cy = (py(y) + py(y + 1)) / 2;
        let linked = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height || !map.waterPipe[ny * map.width + nx]) continue;
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + (dx * s) / 2, cy + (dy * s) / 2);
          linked = true;
        }
        if (!linked) {
          ctx.moveTo(cx - s * 0.2, cy);
          ctx.lineTo(cx + s * 0.2, cy);
        }
      }
    }
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.lineWidth = 1;
  }

  /** Un rayo sobre el tejado de lotes y edificios que consumen electricidad y no la reciben. */
  private drawNoPowerMarks(f: Frame): void {
    const { ctx, state, vis, px, py, s } = f;
    const { map } = state;
    const { powered } = state.layers;
    if (s < 8) return;
    const mark = (x: number, y: number, i: number) => {
      const size = Math.max(6, s * 0.36);
      const cx = (px(x) + px(x + 1)) / 2;
      const cy = (py(y) + py(y + 1)) / 2 - tileTop(f, i) * f.hs - size * 0.9;
      ctx.fillStyle = COLORS.noPower;
      ctx.strokeStyle = '#3a2f00';
      ctx.lineWidth = Math.max(1, size * 0.08);
      ctx.beginPath();
      ctx.moveTo(cx + size * 0.1, cy - size * 0.5);
      ctx.lineTo(cx - size * 0.3, cy + size * 0.08);
      ctx.lineTo(cx - size * 0.02, cy + size * 0.08);
      ctx.lineTo(cx - size * 0.12, cy + size * 0.5);
      ctx.lineTo(cx + size * 0.3, cy - size * 0.1);
      ctx.lineTo(cx + size * 0.02, cy - size * 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 1;
    };
    for (let y = vis.y0; y <= vis.y1; y++) {
      for (let x = vis.x0; x <= vis.x1; x++) {
        const i = y * map.width + x;
        if (map.lotLevel[i] && !powered[i] && !map.fire[i]) mark(x, y, i); // el fuego ya dice bastante
      }
    }
    for (const b of state.buildings.values()) {
      if (b.x > vis.x1 || b.y > vis.y1 || b.x + b.w <= vis.x0 || b.y + b.h <= vis.y0) continue;
      const def = getBuildingDef(b.defId);
      const i = b.y * map.width + b.x;
      if (def?.power?.consumes && !powered[i]) mark(b.x + b.w - 1, b.y, i);
    }
  }

  private outlineTile(t: Point | null, color: string, px: (x: number) => number, py: (y: number) => number): void {
    if (!t) return;
    // Marco con esquinas marcadas, como las marcas de corte de un plano
    const { ctx } = this;
    const x0 = px(t.x);
    const y0 = py(t.y);
    const w = px(t.x + 1) - x0;
    const h = py(t.y + 1) - y0;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
    const c = Math.max(3, Math.round(w * 0.28));
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [cx, cy, dx, dy] of [[x0, y0, 1, 1], [x0 + w, y0, -1, 1], [x0, y0 + h, 1, -1], [x0 + w, y0 + h, -1, -1]] as const) {
      ctx.moveTo(cx + dx * c, cy + dy * 1);
      ctx.lineTo(cx + dx * 1, cy + dy * 1);
      ctx.lineTo(cx + dx * 1, cy + dy * c);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
  }
}
