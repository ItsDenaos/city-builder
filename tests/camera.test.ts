import { describe, expect, it } from 'vitest';
import { Camera, MAX_ZOOM, MIN_ZOOM, TILE_SIZE } from '../src/render/camera';

describe('Camera', () => {
  it('convierte entre pantalla y casillas', () => {
    const cam = new Camera(800, 600);
    cam.x = 10;
    cam.y = 5;
    expect(cam.screenToTile(0, 0)).toEqual({ x: 10, y: 5 });
    expect(cam.screenToTile(TILE_SIZE * 3 + 1, TILE_SIZE + 1)).toEqual({ x: 13, y: 6 });
    expect(cam.tileToScreen(13, 6)).toEqual({ x: TILE_SIZE * 3, y: TILE_SIZE });
  });

  it('el zoom mantiene fijo el punto bajo el cursor', () => {
    const cam = new Camera(800, 600);
    cam.x = 20;
    cam.y = 20;
    const before = cam.screenToWorld(300, 200);
    cam.zoomAt(300, 200, 2);
    const after = cam.screenToWorld(300, 200);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('limita el zoom', () => {
    const cam = new Camera(800, 600);
    cam.zoomAt(0, 0, 1000);
    expect(cam.zoom).toBe(MAX_ZOOM);
    cam.zoomAt(0, 0, 0.0001);
    expect(cam.zoom).toBe(MIN_ZOOM);
  });

  it('centra la vista en una casilla', () => {
    const cam = new Camera(800, 600);
    cam.centerOn(64, 64);
    const c = cam.screenToWorld(400, 300);
    expect(c.x).toBeCloseTo(64);
    expect(c.y).toBeCloseTo(64);
  });
});
