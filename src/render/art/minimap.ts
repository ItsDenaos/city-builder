import { getBuildingDef } from '../../sim/data/buildings';
import { ROADS } from '../../sim/data/roads';
import { ZONE_BY_CODE, ZONE_CODE, getZoneDefByCode } from '../../sim/data/zones';
import { NO_BUILDING } from '../../sim/state';
import { TERRAIN_WATER } from '../../sim/types';
import { groundTone } from './ground';
import { MATERIALS, WORLD } from './palette';
import { type Frame, hash2 } from './util';

type RGBA = [number, number, number, number];

const parsed = new Map<string, RGBA>();

/** Convierte '#rrggbb', 'rgb(...)' o 'rgba(...)' en componentes (con caché). */
function rgba(color: string): RGBA {
  let c = parsed.get(color);
  if (c) return c;
  if (color.startsWith('#')) {
    const n = parseInt(color.slice(1), 16);
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  } else {
    const [r, g, b, a = 1] = color.replace(/[^\d.,]/g, '').split(',').map(Number);
    c = [r, g, b, a];
  }
  parsed.set(color, c);
  return c;
}

const ROOF_TONE: Record<number, readonly string[]> = {
  [ZONE_CODE.R]: MATERIALS.houseRoofs,
  [ZONE_CODE.C]: MATERIALS.glass,
  [ZONE_CODE.I]: MATERIALS.factoryRoofs,
};

/**
 * Con mucho zoom de alejamiento se dibuja un píxel por casilla en una imagen del tamaño del mapa
 * y se escala de una vez: dibujar 16.000 rectángulos por fotograma era demasiado lento.
 */
export class TileImage {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private image: ImageData | null = null;

  draw(f: Frame, overlay: ((i: number) => string | null) | null, dim: string): void {
    const { map, buildings } = f.state;
    const { width: w, height: h } = map;
    if (!this.image || this.image.width !== w || this.image.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.image = this.ctx.createImageData(w, h);
    }
    const data = this.image.data;
    const dimC = rgba(dim);
    for (let i = 0; i < w * h; i++) {
      const x = i % w;
      const y = (i - x) / w;
      let color: string;
      if (map.fire[i]) color = WORLD.fire;
      else if (map.road[i]) color = map.road[i] === ROADS.avenue.code ? WORLD.avenueLine : WORLD.street;
      else if (map.terrain[i] === TERRAIN_WATER) color = WORLD.water;
      else if (map.building[i] !== NO_BUILDING) color = getBuildingDef(buildings.get(map.building[i])!.defId)?.color ?? WORLD.pavement;
      else if (map.lotLevel[i]) {
        const tones = ROOF_TONE[map.zoneType[i]];
        color = tones[Math.floor(hash2(x, y, 1) * tones.length)];
      } else if (ZONE_BY_CODE[map.zoneType[i]]) color = getZoneDefByCode(map.zoneType[i], map.zoneDensity[i]).color;
      else color = groundTone(x, y);
      let [r, g, b] = rgba(color);
      if (map.zoneType[i] && !map.lotLevel[i]) {
        // Parcela vacía: mezcla suave del color de la zona con el césped
        const [gr, gg, gb] = rgba(groundTone(x, y));
        r = gr + (r - gr) * 0.4;
        g = gg + (g - gg) * 0.4;
        b = gb + (b - gb) * 0.4;
      }
      if (overlay) {
        // Igual que en el dibujo detallado: atenuar todo y teñir encima
        [r, g, b] = blend([r, g, b], dimC);
        const o = overlay(i);
        if (o) [r, g, b] = blend([r, g, b], rgba(o));
      }
      const k = i * 4;
      data[k] = r;
      data[k + 1] = g;
      data[k + 2] = b;
      data[k + 3] = 255;
    }
    this.ctx.putImageData(this.image, 0, 0);
    const { ctx, px, py } = f;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.canvas, px(0), py(0), px(w) - px(0), py(h) - py(0));
    ctx.imageSmoothingEnabled = true;
  }
}

function blend([r, g, b]: [number, number, number], [or, og, ob, a]: RGBA): [number, number, number] {
  return [r + (or - r) * a, g + (og - g) * a, b + (ob - b) * a];
}
