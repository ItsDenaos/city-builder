import { type BuildingDef, getBuildingDef } from '../../sim/data/buildings';
import { ZONE_BY_CODE } from '../../sim/data/zones';
import { type BuildingInstance, NO_BUILDING } from '../../sim/state';
import { TERRAIN_WATER, type ZoneType } from '../../sim/types';
import { FONTS } from '../../theme';
import { CIVIC, MATERIALS, WORLD } from './palette';
import { type Frame, hash2, pick, shade, valueNoise } from './util';

/**
 * Edificios en "cenital con volumen": cada edificio es una o varias cajas.
 * Se ve el tejado desplazado hacia arriba según la altura y la fachada sur debajo,
 * con una sombra hacia el sureste. Las medidas van en casillas, relativas a la casilla origen.
 */
export interface Box {
  dx: number;
  dy: number;
  w: number;
  d: number;
  h: number;
  wall: string;
  roof: string;
  kind?: 'house' | 'flat' | 'glass' | 'crown' | 'shop' | 'factory' | 'chimney' | 'garage' | 'cross' | 'pool' | 'paving';
  /** Altura a la que empieza la caja (depósito de la torre de agua). */
  lift?: number;
  label?: string;
}

const M = MATERIALS;

/** Cajas de un edificio crecido en una zona, según tipo, densidad, nivel y dos números aleatorios estables. */
export function lotBoxes(type: ZoneType, density: number, level: number, r: number, r2: number): Box[] {
  const jitter = (r2 - 0.5) * 0.08;
  const centered = (size: number, h: number, wall: string, roof: string, kind: Box['kind']): Box => ({
    dx: (1 - size) / 2 + jitter,
    dy: (1 - size) / 2 - jitter,
    w: size,
    d: size,
    h,
    wall,
    roof,
    kind,
  });
  if (type === 'R') {
    if (density === 0) {
      const house = centered(0.5 + 0.1 * level, 0.35 + 0.12 * (level - 1), pick(M.houseWalls, r2), pick(M.houseRoofs, r), 'house');
      if (level < 3) return [house];
      return [{ dx: 0.08, dy: 0.08, w: 0.26, d: 0.18, h: 0, wall: M.pool, roof: M.pool, kind: 'pool' }, { ...house, dx: house.dx + 0.08, dy: house.dy + 0.06, w: 0.72, d: 0.72 }];
    }
    if (density === 1) return [centered(0.82, 0.9 + 0.45 * (level - 1) + r * 0.2, pick(M.aptWalls, r2), pick(M.aptRoofs, r), 'flat')];
    // Torre: cuerpo y coronación retranqueada
    const tower = centered(0.7 + 0.05 * level, 1.8 + 0.8 * (level - 1) + r * 0.6, pick(M.towerWalls, r2), M.towerRoof, 'flat');
    return [tower, { ...tower, dx: tower.dx + tower.w * 0.2, dy: tower.dy + tower.d * 0.2, w: tower.w * 0.6, d: tower.d * 0.6, h: tower.h + 0.35, kind: 'flat' }];
  }
  if (type === 'C') {
    if (density === 0) {
      return [{ dx: 0.1 + jitter, dy: 0.25, w: 0.8, d: 0.62, h: 0.35 + 0.1 * level, wall: pick(M.shopWalls, r2), roof: M.shopRoof, kind: 'shop', label: pick(M.awnings, r) }];
    }
    if (density === 1) return [centered(0.85, 1.0 + 0.5 * (level - 1) + r * 0.3, pick(M.glass, r2), M.officeRoof, 'glass')];
    const office = centered(0.75, 2.4 + 0.9 * (level - 1) + r * 0.8, pick(M.glass, r2), M.officeTowerRoof, 'glass');
    // Remate con el canto de oro solo en las torres más altas: los hitos del horizonte
    return [office, { ...office, dx: office.dx + 0.15, dy: office.dy + 0.15, w: office.w - 0.3, d: office.d - 0.3, h: office.h + 0.3, kind: level === 3 ? 'crown' : 'glass' }];
  }
  // Industria
  const wall = pick(M.factoryWalls, r2);
  const roof = pick(M.factoryRoofs, r);
  if (density === 0) return [centered(0.8, 0.35 + 0.08 * level, wall, roof, 'factory')];
  const main: Box = { dx: 0.06, dy: 0.24, w: 0.88, d: 0.7, h: 0.55 + 0.15 * level, wall, roof, kind: 'factory' };
  const chimney = (dx: number): Box => ({ dx, dy: 0.06, w: 0.16, d: 0.16, h: 1.3 + 0.2 * level, wall: M.chimneyWall, roof: M.chimneyRoof, kind: 'chimney' });
  return density === 1 ? [chimney(0.72), main] : [chimney(0.62), chimney(0.82), main];
}

/** Cajas de los edificios colocados por el jugador (centrales, servicios...). */
function placedBoxes(def: BuildingDef): Box[] {
  switch (def.id) {
    case 'coal_plant':
      return [
        { dx: 2.9, dy: 0.45, w: 0.5, d: 0.5, h: 3.0, wall: M.chimneyWall, roof: M.chimneyRoof, kind: 'chimney' },
        { dx: 2.9, dy: 1.35, w: 0.5, d: 0.5, h: 3.0, wall: M.chimneyWall, roof: M.chimneyRoof, kind: 'chimney' },
        { dx: 0.25, dy: 1.0, w: 2.45, d: 2.7, h: 1.0, wall: CIVIC.coalWall, roof: CIVIC.coalRoof, kind: 'factory' },
      ];
    case 'water_pump':
      return [
        { dx: 0.2, dy: 0.3, w: 1.55, d: 1.3, h: 0.45, wall: CIVIC.pumpWall, roof: CIVIC.pumpRoof, kind: 'flat' },
        { dx: 1.55, dy: 1.45, w: 0.3, d: 0.3, h: 0.25, wall: CIVIC.towerLegs, roof: M.chimneyRoof },
      ];
    case 'water_tower':
      return [{ dx: 0.18, dy: 0.25, w: 0.64, d: 0.5, h: 0.5, lift: 0.9, wall: CIVIC.towerTank, roof: CIVIC.towerTankRoof, kind: 'flat' }];
    case 'police_station':
      return [{ dx: 0.15, dy: 0.2, w: 1.7, d: 1.5, h: 0.75, wall: CIVIC.policeWall, roof: CIVIC.policeRoof, kind: 'flat', label: def.short }];
    case 'fire_station':
      return [{ dx: 0.15, dy: 0.2, w: 1.7, d: 1.5, h: 0.75, wall: CIVIC.fireWall, roof: CIVIC.fireRoof, kind: 'garage', label: def.short }];
    case 'clinic':
      return [{ dx: 0.2, dy: 0.2, w: 1.6, d: 1.5, h: 0.7, wall: CIVIC.clinicWall, roof: CIVIC.clinicRoof, kind: 'cross' }];
    case 'hospital':
      return [{ dx: 0.2, dy: 0.25, w: 2.6, d: 2.4, h: 1.6, wall: CIVIC.clinicWall, roof: CIVIC.clinicRoof, kind: 'cross' }];
    case 'elementary_school':
      return [{ dx: 0.1, dy: 0.15, w: 1.9, d: 1.4, h: 0.7, wall: CIVIC.schoolWall, roof: CIVIC.schoolRoof, kind: 'flat', label: def.short }];
    case 'high_school':
      return [{ dx: 0.15, dy: 0.2, w: 2.7, d: 2.0, h: 1.0, wall: CIVIC.schoolWall, roof: shade(CIVIC.schoolRoof, 0.9), kind: 'flat', label: def.short }];
    case 'plaza':
      return [
        { dx: 0.1, dy: 0.1, w: 1.8, d: 1.8, h: 0, wall: CIVIC.plaza, roof: CIVIC.plaza, kind: 'paving' },
        { dx: 0.75, dy: 0.75, w: 0.5, d: 0.5, h: 0, wall: CIVIC.fountain, roof: CIVIC.fountain, kind: 'pool' },
      ];
    case 'park_small':
    case 'wind_turbine':
      return [];
    default:
      return [{ dx: 0.12, dy: 0.12, w: def.size.w - 0.24, d: def.size.h - 0.24, h: 0.6, wall: def.color, roof: shade(def.color, 0.8), kind: 'flat', label: def.short }];
  }
}

/** Árboles de un edificio o de una casilla libre, en casillas relativas al origen. */
function placedTrees(def: BuildingDef): [number, number, number][] {
  if (def.id === 'park_small') return [[0.3, 0.35, 0.22], [0.7, 0.55, 0.2], [0.35, 0.75, 0.16]];
  if (def.id === 'plaza') return [[0.35, 0.35, 0.2], [1.65, 0.35, 0.2], [0.35, 1.65, 0.2], [1.65, 1.65, 0.2]];
  return [];
}

/** Árboles silvestres agrupados en arboledas: donde el ruido es alto hay bosquetes; fuera, árboles sueltos. */
function wildTrees(x: number, y: number): [number, number, number][] {
  const grove = valueNoise(x, y, 7, 5);
  const chance = grove > 0.68 ? 0.75 : grove > 0.55 ? 0.25 : 0.015;
  const r = hash2(x, y, 3) / chance;
  if (r > 1) return [];
  const trees: [number, number, number][] = [[0.25 + hash2(x, y, 4) * 0.5, 0.25 + hash2(x, y, 5) * 0.5, 0.2 + hash2(x, y, 6) * 0.1]];
  if (r < 0.45) trees.push([0.2 + hash2(x, y, 8) * 0.6, 0.2 + hash2(x, y, 9) * 0.6, 0.15 + hash2(x, y, 10) * 0.08]);
  return trees;
}

// ---- Dibujo ----

function boxShadow(f: Frame, X: number, Y: number, b: Box): void {
  if (b.h <= 0 || !f.hs) return;
  const { ctx, s } = f;
  const W = b.w * s;
  const D = b.d * s;
  const o = (b.h + (b.lift ?? 0)) * f.hs * 0.6;
  const x = X + b.dx * s;
  const y = Y + b.dy * s;
  ctx.beginPath();
  ctx.moveTo(x + W, y);
  ctx.lineTo(x + W + o, y + o * 0.45);
  ctx.lineTo(x + W + o, y + D + o * 0.45);
  ctx.lineTo(x + o, y + D + o * 0.45);
  ctx.lineTo(x, y + D);
  ctx.closePath();
  ctx.fill();
}

function windows(f: Frame, x: number, top: number, w: number, h: number, color: string): void {
  const { ctx, s } = f;
  const size = s * 0.09;
  const stepX = s * 0.19;
  const stepY = s * 0.22;
  ctx.fillStyle = color;
  for (let wy = top + s * 0.1; wy + size < top + h - s * 0.06; wy += stepY) {
    for (let wx = x + s * 0.07; wx + size < x + w - s * 0.04; wx += stepX) ctx.fillRect(wx, wy, size, size);
  }
}

function smoke(f: Frame, cx: number, top: number, seed: number): void {
  const { ctx, s, time } = f;
  for (let k = 0; k < 3; k++) {
    const t = (time * 0.35 + k / 3 + seed) % 1;
    ctx.fillStyle = `rgba(${CIVIC.smoke}, ${(0.5 * (1 - t)).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(cx + t * s * 0.35, top - t * s * 1.1, s * (0.1 + 0.16 * t), 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawBox(f: Frame, X: number, Y: number, b: Box, seed = 0): void {
  const { ctx, s, hs, detail } = f;
  const x = X + b.dx * s;
  const y = Y + b.dy * s;
  const W = b.w * s;
  const D = b.d * s;
  if (b.kind === 'pool' || b.kind === 'paving' || b.h <= 0) {
    ctx.fillStyle = b.roof;
    ctx.fillRect(x, y, W, D);
    if (b.kind === 'pool' && detail && s >= 10) {
      ctx.strokeStyle = M.poolEdge;
      ctx.lineWidth = Math.max(1, s * 0.04);
      ctx.strokeRect(x, y, W, D);
      ctx.lineWidth = 1;
    }
    return;
  }
  const lift = (b.lift ?? 0) * hs;
  const H = b.h * hs;
  const roofY = y - H - lift;

  // Patas del depósito elevado
  if (lift > 0) {
    ctx.fillStyle = CIVIC.towerLegs;
    const lw = Math.max(1, s * 0.05);
    ctx.fillRect(x + W * 0.15, y + D - lift, lw, lift);
    ctx.fillRect(x + W * 0.85 - lw, y + D - lift, lw, lift);
  }

  // Fachada sur
  if (H >= 1) {
    const faceY = y + D - H - lift;
    ctx.fillStyle = shade(b.wall, 0.82);
    ctx.fillRect(x, faceY, W, H);
    if (detail && s >= 14 && H >= s * 0.3) {
      if (b.kind === 'glass' || b.kind === 'crown') windows(f, x, faceY, W, H, M.windowGlass);
      else if (b.kind === 'flat' || b.kind === 'house') windows(f, x, faceY, W, H, M.window);
      else if (b.kind === 'shop') {
        ctx.fillStyle = b.label ?? '#d9534f';
        ctx.fillRect(x, faceY, W, Math.max(2, H * 0.3)); // toldo
        ctx.fillStyle = '#9fc3dc';
        ctx.fillRect(x + W * 0.15, faceY + H * 0.45, W * 0.7, H * 0.4); // escaparate
      } else if (b.kind === 'garage') {
        ctx.fillStyle = CIVIC.garage;
        for (let k = 0; k < 3; k++) ctx.fillRect(x + W * (0.1 + k * 0.3), faceY + H * 0.35, W * 0.22, H * 0.65);
      }
    }
    // Oclusión ambiental: la base de la fachada, en contacto con el suelo, más oscura
    if (detail && !lift) {
      ctx.fillStyle = 'rgba(23, 43, 58, 0.22)';
      ctx.fillRect(x, y + D - Math.max(1, Math.min(H * 0.18, s * 0.08)), W, Math.max(1, Math.min(H * 0.18, s * 0.08)));
    }
  }

  // Tejado, con el canto norte iluminado (la luz viene del noroeste)
  ctx.fillStyle = b.roof;
  ctx.fillRect(x, roofY, W, D);
  if (!detail || s < 8) return;
  const edge = Math.max(1, Math.round(s * 0.03));
  ctx.fillStyle = shade(b.roof, 1.14);
  ctx.fillRect(x, roofY, W, edge);
  ctx.fillRect(x, roofY, edge, D);
  if (b.kind === 'crown') {
    ctx.fillStyle = WORLD.selected; // canto de oro de los grandes hitos
    ctx.fillRect(x, roofY, W, edge);
    ctx.fillRect(x, roofY + D - edge, W, edge);
  }
  if (b.kind === 'house') {
    // Tejado a dos aguas: mitad norte más clara y cumbrera
    ctx.fillStyle = shade(b.roof, 1.15);
    ctx.fillRect(x, roofY, W, D / 2);
    ctx.fillStyle = shade(b.roof, 0.75);
    ctx.fillRect(x, roofY + D / 2 - Math.max(1, s * 0.02), W, Math.max(1, s * 0.04));
  } else if (b.kind === 'flat' || b.kind === 'glass') {
    ctx.fillStyle = shade(b.roof, 0.88);
    ctx.fillRect(x + W * 0.2, roofY + D * 0.2, W * 0.25, D * 0.25); // maquinaria
  } else if (b.kind === 'factory') {
    ctx.fillStyle = shade(b.roof, 0.8);
    const n = Math.max(2, Math.round(b.w * 3));
    for (let k = 1; k < n; k++) ctx.fillRect(x + (W * k) / n, roofY, Math.max(1, s * 0.04), D); // dientes de sierra
  } else if (b.kind === 'cross') {
    ctx.fillStyle = WORLD.cross;
    const c = Math.min(W, D) * 0.45;
    const t = c / 3;
    ctx.fillRect(x + W / 2 - c / 2, roofY + D / 2 - t / 2, c, t);
    ctx.fillRect(x + W / 2 - t / 2, roofY + D / 2 - c / 2, t, c);
  }
  if (b.label && b.kind !== 'shop' && s >= 14) {
    // Emblema de servicio público: inicial en oro dentro de un marco fino
    const size = Math.min(W, D) * 0.46;
    ctx.strokeStyle = WORLD.emblem;
    ctx.lineWidth = Math.max(1, s * 0.035);
    ctx.strokeRect(x + W / 2 - size / 2, roofY + D / 2 - size / 2, size, size);
    ctx.lineWidth = 1;
    ctx.fillStyle = WORLD.emblem;
    ctx.font = `600 ${Math.round(size * 0.62)}px ${FONTS.display}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.label, x + W / 2, roofY + D / 2 + size * 0.04);
  }
  if (b.kind === 'chimney' && hs) smoke(f, x + W / 2, roofY, seed);
}

/** Árboles de maqueta: copa redonda (olivo) o ciprés, la vegetación mediterránea que da nombre a Olive Grove. */
function tree(f: Frame, cx: number, cy: number, r: number, mode: 'shadow' | 'draw', cypress = false): void {
  const { ctx, s, hs } = f;
  const R = r * s;
  const lift = hs * (cypress ? 0.2 : 0.35);
  if (mode === 'shadow') {
    if (!hs) return;
    ctx.beginPath();
    if (cypress) ctx.ellipse(cx + R * 1.1, cy + R * 0.35, R * 1.3, R * 0.45, 0.35, 0, Math.PI * 2);
    else ctx.ellipse(cx + R * 0.6, cy + R * 0.3, R, R * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.fillStyle = WORLD.trunk;
  if (lift) ctx.fillRect(cx - R * 0.12, cy - lift, R * 0.24, lift);
  if (cypress) {
    ctx.fillStyle = WORLD.treeDark;
    ctx.beginPath();
    ctx.ellipse(cx, cy - lift - R * 0.9, R * 0.55, R * 1.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = WORLD.tree;
    ctx.beginPath();
    ctx.ellipse(cx - R * 0.18, cy - lift - R * 1.1, R * 0.22, R * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.fillStyle = WORLD.tree;
  ctx.beginPath();
  ctx.arc(cx, cy - lift, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = WORLD.treeLight;
  ctx.beginPath();
  ctx.arc(cx - R * 0.3, cy - lift - R * 0.3, R * 0.45, 0, Math.PI * 2);
  ctx.fill();
}

function turbine(f: Frame, X: number, Y: number, seed: number, mode: 'shadow' | 'draw'): void {
  const { ctx, s, hs, time } = f;
  const cx = X + s * 0.5;
  const base = Y + s * 0.62;
  const H = Math.max(hs * 1.9, s * 0.05);
  if (mode === 'shadow') {
    if (!hs) return;
    ctx.fillRect(cx, base - s * 0.03, H * 0.6, s * 0.06);
    return;
  }
  ctx.fillStyle = CIVIC.turbine;
  ctx.fillRect(cx - s * 0.03, base - H, s * 0.06, H);
  const hubY = base - H;
  const angle = time * 2.2 + seed * 6.28;
  ctx.strokeStyle = CIVIC.turbine;
  ctx.lineWidth = Math.max(1, s * 0.06);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let k = 0; k < 3; k++) {
    const a = angle + (k * Math.PI * 2) / 3;
    ctx.moveTo(cx, hubY);
    ctx.lineTo(cx + Math.cos(a) * s * 0.42, hubY + Math.sin(a) * s * 0.42);
  }
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.lineWidth = 1;
  ctx.fillStyle = CIVIC.turbineHub;
  ctx.beginPath();
  ctx.arc(cx, hubY, s * 0.06, 0, Math.PI * 2);
  ctx.fill();
}

/** Altura (en casillas) del punto más alto de lo que hay en la casilla, para colocar avisos encima. */
export function tileTop(f: Frame, i: number): number {
  const { map, buildings } = f.state;
  if (map.lotLevel[i]) {
    const x = i % map.width;
    const y = (i - x) / map.width;
    const type = ZONE_BY_CODE[map.zoneType[i]]!;
    return Math.max(...lotBoxes(type, map.zoneDensity[i], map.lotLevel[i], hash2(x, y, 1), hash2(x, y, 2)).map((b) => b.h + (b.lift ?? 0)));
  }
  const id = map.building[i];
  if (id === NO_BUILDING) return 0;
  const def = getBuildingDef(buildings.get(id)!.defId);
  if (!def) return 0;
  if (def.id === 'wind_turbine') return 1.9;
  return Math.max(0, ...placedBoxes(def).map((b) => b.h + (b.lift ?? 0)));
}

function drawPlaced(f: Frame, b: BuildingInstance, def: BuildingDef, mode: 'shadow' | 'draw'): void {
  const X = f.px(b.x);
  const Y = f.py(b.y);
  const seed = hash2(b.x, b.y, 11);
  if (def.id === 'wind_turbine') return turbine(f, X, Y, seed, mode);
  for (const box of placedBoxes(def)) (mode === 'shadow' ? boxShadow(f, X, Y, box) : drawBox(f, X, Y, box, seed));
  for (const [tx, ty, r] of placedTrees(def)) tree(f, X + tx * f.s, Y + ty * f.s, r, mode);
}

/**
 * Dibuja sombras y luego edificios y árboles de norte a sur, para que lo de delante tape a lo de detrás.
 * Recorre algunas filas más al sur de lo visible porque los edificios altos asoman hacia arriba.
 */
export function drawCity(f: Frame): void {
  const { ctx, state, vis, s } = f;
  const { map, buildings } = state;
  const extraRows = f.hs ? Math.ceil((4.5 * f.hs) / s) : 0;
  const y1 = Math.min(map.height - 1, vis.y1 + extraRows);
  const x0 = Math.max(0, vis.x0 - 2);

  const visit = (mode: 'shadow' | 'draw') => {
    for (let y = vis.y0; y <= y1; y++) {
      for (let x = x0; x <= vis.x1; x++) {
        const i = y * map.width + x;
        if (map.lotLevel[i]) {
          const type = ZONE_BY_CODE[map.zoneType[i]]!;
          const boxes = lotBoxes(type, map.zoneDensity[i], map.lotLevel[i], hash2(x, y, 1), hash2(x, y, 2));
          const X = f.px(x);
          const Y = f.py(y);
          for (const box of boxes) (mode === 'shadow' ? boxShadow(f, X, Y, box) : drawBox(f, X, Y, box, hash2(x, y, 12)));
        } else if (map.building[i] !== NO_BUILDING) {
          const b = buildings.get(map.building[i])!;
          // Cada edificio se dibuja una vez, en su casilla inferior izquierda
          if (x !== b.x || y !== b.y + b.h - 1) continue;
          const def = getBuildingDef(b.defId);
          if (def) drawPlaced(f, b, def, mode);
        } else if (f.detail && s >= 12 && !map.road[i] && !map.zoneType[i] && !map.powerLine[i] && map.terrain[i] !== TERRAIN_WATER) {
          const cypress = hash2(x, y, 13) < 0.3;
          for (const [tx, ty, r] of wildTrees(x, y)) tree(f, f.px(x) + tx * s, f.py(y) + ty * s, r * (cypress ? 0.75 : 1), mode, cypress);
        }
      }
    }
  };

  ctx.fillStyle = WORLD.shadow;
  visit('shadow');
  visit('draw');
}
