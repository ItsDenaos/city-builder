import type { Point, Rect } from '../sim/types';

export const TILE_SIZE = 16; // px por casilla con zoom 1
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Cámara cenital. (x, y) es la esquina superior izquierda de la vista, en casillas. */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;

  constructor(
    public viewWidth: number,
    public viewHeight: number,
  ) {}

  get scale(): number {
    return TILE_SIZE * this.zoom;
  }

  resize(width: number, height: number): void {
    // Mantiene el centro de la vista al redimensionar
    const cx = this.x + this.viewWidth / this.scale / 2;
    const cy = this.y + this.viewHeight / this.scale / 2;
    this.viewWidth = width;
    this.viewHeight = height;
    this.centerOn(cx, cy);
  }

  screenToWorld(sx: number, sy: number): Point {
    return { x: sx / this.scale + this.x, y: sy / this.scale + this.y };
  }

  screenToTile(sx: number, sy: number): Point {
    const w = this.screenToWorld(sx, sy);
    return { x: Math.floor(w.x), y: Math.floor(w.y) };
  }

  tileToScreen(tx: number, ty: number): Point {
    return { x: (tx - this.x) * this.scale, y: (ty - this.y) * this.scale };
  }

  panByScreen(dx: number, dy: number): void {
    this.x -= dx / this.scale;
    this.y -= dy / this.scale;
  }

  /** Zoom manteniendo fijo el punto del mundo que está bajo (sx, sy). */
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.screenToWorld(sx, sy);
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }

  centerOn(tx: number, ty: number): void {
    this.x = tx - this.viewWidth / this.scale / 2;
    this.y = ty - this.viewHeight / this.scale / 2;
  }

  /** Impide alejarse del mapa más de media pantalla. */
  clampTo(mapWidth: number, mapHeight: number): void {
    const vw = this.viewWidth / this.scale;
    const vh = this.viewHeight / this.scale;
    this.x = clamp(this.x, -vw / 2, mapWidth - vw / 2);
    this.y = clamp(this.y, -vh / 2, mapHeight - vh / 2);
  }

  visibleTiles(mapWidth: number, mapHeight: number): Rect {
    return {
      x0: Math.max(0, Math.floor(this.x)),
      y0: Math.max(0, Math.floor(this.y)),
      x1: Math.min(mapWidth - 1, Math.ceil(this.x + this.viewWidth / this.scale)),
      y1: Math.min(mapHeight - 1, Math.ceil(this.y + this.viewHeight / this.scale)),
    };
  }
}
