import { type Command, canDragPlace } from '../sim/commands';
import { getBuildingDef } from '../sim/data/buildings';
import { gridPositions, normalizeRect, rectPoints, roadPath } from '../sim/geometry';
import type { RoadKind } from '../sim/data/roads';
import type { Density, Point, ZoneType } from '../sim/types';

export type Tool =
  | { kind: 'select' }
  | { kind: 'road'; road: RoadKind }
  | { kind: 'powerLine' }
  | { kind: 'pipe' }
  | { kind: 'removePipe' }
  | { kind: 'zone'; zone: ZoneType; density: Density }
  | { kind: 'dezone' }
  | { kind: 'bulldoze' }
  | { kind: 'building'; defId: string }
  /** Comprar parcelas de terreno. */
  | { kind: 'land' };

export const SELECT_TOOL: Tool = { kind: 'select' };

/** Ajustes de las herramientas que no forman parte de la herramienta en sí. */
export interface ToolOptions {
  /** Zonificar solo a esta distancia de una calle (0 = el rectángulo entero). */
  strip: number;
}

/** Profundidades de franja que se pueden elegir; 0 es el rectángulo entero. */
export const STRIP_DEPTHS = [0, 1, 2, 3] as const;

/** Vista de red que conviene mostrar mientras se usa la herramienta. */
export function toolOverlay(tool: Tool): 'power' | 'water' | 'traffic' | null {
  if (tool.kind === 'road' && tool.road === 'avenue') return 'traffic';
  if (tool.kind === 'powerLine') return 'power';
  if (tool.kind === 'pipe' || tool.kind === 'removePipe') return 'water';
  if (tool.kind === 'building') {
    const category = getBuildingDef(tool.defId)?.category;
    if (category === 'power') return 'power';
    if (category === 'water') return 'water';
  }
  return null;
}

export const sameTool = (a: Tool, b: Tool) => JSON.stringify(a) === JSON.stringify(b);

const isClick = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

/** Traduce un arrastre (o clic: start === end) de la herramienta a un comando. */
export function toolCommand(tool: Tool, start: Point, end: Point, opts: ToolOptions = { strip: 0 }): Command | null {
  switch (tool.kind) {
    case 'select':
      return null;
    case 'road':
      return { type: 'buildRoad', from: start, to: end, road: tool.road };
    case 'powerLine':
      return { type: 'buildPowerLine', from: start, to: end };
    case 'pipe':
      return { type: 'buildPipe', from: start, to: end };
    case 'removePipe':
      return { type: 'removePipe', rect: normalizeRect(start, end) };
    case 'zone':
      return { type: 'zone', rect: normalizeRect(start, end), zone: tool.zone, density: tool.density, ...(opts.strip ? { strip: opts.strip } : {}) };
    case 'dezone':
      return { type: 'dezone', rect: normalizeRect(start, end) };
    case 'bulldoze':
      return { type: 'bulldoze', rect: normalizeRect(start, end) };
    case 'building': {
      // Los parques y los edificios de una casilla se colocan en serie arrastrando
      const def = getBuildingDef(tool.defId);
      if (def && canDragPlace(def) && !isClick(start, end)) return { type: 'placeBuilding', defId: tool.defId, at: start, to: end };
      return { type: 'placeBuilding', defId: tool.defId, at: end };
    }
    case 'land':
      return { type: 'buyPlot', at: end };
  }
}

/** Casillas a resaltar bajo el cursor mientras se usa la herramienta. */
export function toolPreviewTiles(tool: Tool, start: Point | null, hover: Point): Point[] {
  const from = start ?? hover;
  switch (tool.kind) {
    case 'select':
      return [];
    case 'road':
    case 'powerLine':
    case 'pipe':
      return roadPath(from, hover);
    case 'removePipe':
    case 'zone':
    case 'dezone':
    case 'bulldoze':
      return rectPoints(normalizeRect(from, hover));
    case 'building': {
      const def = getBuildingDef(tool.defId);
      if (!def) return [];
      const { w, h } = def.size;
      const spots = start && canDragPlace(def) && !isClick(start, hover) ? gridPositions(normalizeRect(start, hover), w, h) : [hover];
      return spots.flatMap((p) => rectPoints({ x0: p.x, y0: p.y, x1: p.x + w - 1, y1: p.y + h - 1 }));
    }
    case 'land':
      return []; // la parcela bajo el cursor la resalta el propio dibujo del terreno
  }
}
