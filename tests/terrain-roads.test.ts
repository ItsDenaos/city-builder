import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands';
import { TERRAFORM_DIG_COST, TERRAFORM_FILL_COST } from '../src/sim/config';
import { curvePath, roadPath } from '../src/sim/geometry';
import { type GameState, createGame, tileIndex } from '../src/sim/state';
import { TERRAIN_LAND, TERRAIN_WATER, type Point } from '../src/sim/types';
import { UndoHistory } from '../src/sim/undo';

const idx = (s: GameState, x: number, y: number) => tileIndex(s.map, x, y);
const game = () => createGame({ width: 32, height: 32, flat: true, money: 100_000 });

describe('editor de terreno', () => {
  it('excava agua y rellena tierra, pagando por casilla', () => {
    const s = game();
    const money = s.economy.money;
    const dig = applyCommand(s, { type: 'terraform', rect: { x0: 2, y0: 2, x1: 4, y1: 3 }, to: 'water' });
    expect(dig).toMatchObject({ ok: true, cost: 6 * TERRAFORM_DIG_COST, affected: 6 });
    expect(s.map.terrain[idx(s, 3, 3)]).toBe(TERRAIN_WATER);
    const fill = applyCommand(s, { type: 'terraform', rect: { x0: 2, y0: 2, x1: 2, y1: 3 }, to: 'land' });
    expect(fill).toMatchObject({ ok: true, cost: 2 * TERRAFORM_FILL_COST });
    expect(s.map.terrain[idx(s, 2, 2)]).toBe(TERRAIN_LAND);
    expect(s.economy.money).toBe(money - 6 * TERRAFORM_DIG_COST - 2 * TERRAFORM_FILL_COST);
  });

  it('no toca lo construido: calles y edificios se quedan, y si no hay nada más, falla', () => {
    const s = game();
    applyCommand(s, { type: 'buildRoad', from: { x: 5, y: 5 }, to: { x: 10, y: 5 } });
    applyCommand(s, { type: 'placeBuilding', defId: 'police_station', at: { x: 5, y: 7 } });
    const r = applyCommand(s, { type: 'terraform', rect: { x0: 5, y0: 5, x1: 6, y1: 8 }, to: 'water' });
    expect(r.ok).toBe(true);
    expect(s.map.terrain[idx(s, 5, 5)]).toBe(TERRAIN_LAND); // la calle
    expect(s.map.terrain[idx(s, 5, 7)]).toBe(TERRAIN_LAND); // la comisaría
    expect(s.map.terrain[idx(s, 5, 6)]).toBe(TERRAIN_WATER);
    expect(applyCommand(s, { type: 'terraform', rect: { x0: 5, y0: 5, x1: 6, y1: 5 }, to: 'water' }).reason).toMatch(/demuél/);
    expect(applyCommand(s, { type: 'terraform', rect: { x0: 5, y0: 6, x1: 6, y1: 6 }, to: 'water' }).reason).toMatch(/Ya es agua/);
  });

  it('excavar quita la zona y el tendido; las tuberías, bajo tierra, se quedan', () => {
    const s = game();
    applyCommand(s, { type: 'zone', rect: { x0: 12, y0: 12, x1: 12, y1: 12 }, zone: 'R', density: 'low' });
    applyCommand(s, { type: 'buildPowerLine', from: { x: 13, y: 12 }, to: { x: 13, y: 12 } });
    applyCommand(s, { type: 'buildPipe', from: { x: 12, y: 12 }, to: { x: 13, y: 12 } });
    applyCommand(s, { type: 'terraform', rect: { x0: 12, y0: 12, x1: 13, y1: 12 }, to: 'water' });
    expect(s.map.zoneType[idx(s, 12, 12)]).toBe(0);
    expect(s.map.powerLine[idx(s, 13, 12)]).toBe(0);
    expect(s.map.waterPipe[idx(s, 12, 12)]).toBe(1);
  });

  it('se puede deshacer', () => {
    const s = game();
    const h = new UndoHistory();
    h.run(s, { type: 'terraform', rect: { x0: 1, y0: 1, x1: 3, y1: 3 }, to: 'water' });
    expect(s.map.terrain[idx(s, 2, 2)]).toBe(TERRAIN_WATER);
    expect(h.undo(s).ok).toBe(true);
    expect(s.map.terrain.every((t) => t === TERRAIN_LAND)).toBe(true);
  });
});

describe('carreteras curvas', () => {
  const connected = (path: Point[]) => path.every((p, k) => k === 0 || Math.abs(p.x - path[k - 1].x) + Math.abs(p.y - path[k - 1].y) === 1);
  const unique = (path: Point[]) => new Set(path.map((p) => `${p.x},${p.y}`)).size === path.length;

  it('van de una casilla a la otra por casillas unidas por un lado, sin repetir', () => {
    for (const [from, to] of [
      [{ x: 0, y: 0 }, { x: 10, y: 6 }],
      [{ x: 12, y: 3 }, { x: 2, y: 9 }],
      [{ x: 5, y: 20 }, { x: 8, y: 2 }],
      [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    ] as const) {
      const path = curvePath(from, to);
      expect(path[0]).toEqual(from);
      expect(path[path.length - 1]).toEqual(to);
      expect(connected(path)).toBe(true);
      expect(unique(path)).toBe(true);
    }
  });

  it('se curvan: no siguen el codo en «L», pero en una misma fila son rectas', () => {
    const curve = curvePath({ x: 0, y: 0 }, { x: 10, y: 10 });
    const corner = roadPath({ x: 0, y: 0 }, { x: 10, y: 10 });
    expect(curve).not.toEqual(corner);
    // El codo de la «L» queda lejos de la curva
    expect(curve.some((p) => p.x === 10 && p.y === 0)).toBe(false);
    expect(curvePath({ x: 0, y: 4 }, { x: 9, y: 4 })).toEqual(roadPath({ x: 0, y: 4 }, { x: 9, y: 4 }));
  });

  it('el comando las construye y cuestan lo que sus casillas', () => {
    const s = game();
    const r = applyCommand(s, { type: 'buildRoad', from: { x: 0, y: 0 }, to: { x: 8, y: 8 }, curve: true });
    const path = curvePath({ x: 0, y: 0 }, { x: 8, y: 8 });
    expect(r).toMatchObject({ ok: true, affected: path.length, cost: path.length * 10 });
    for (const p of path) expect(s.map.road[idx(s, p.x, p.y)]).toBe(1);
  });
});
