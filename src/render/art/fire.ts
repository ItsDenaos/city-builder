import { tileTop } from './buildings';
import { WORLD } from './palette';
import { type Frame, hash2, withAlpha } from './util';

/**
 * Edificios en llamas: el volumen se ennegrece según los días que lleva ardiendo, un resplandor
 * ámbar lo envuelve, tres lenguas de fuego titilan en lo alto y una columna de humo sube con el viento.
 */
export function drawFires(f: Frame): void {
  const { ctx, state, vis, s, time } = f;
  const { map } = state;
  if (!state.incidents.burning) return;
  const extraRows = f.hs ? Math.ceil((4.5 * f.hs) / s) : 0;
  const y1 = Math.min(map.height - 1, vis.y1 + extraRows);
  for (let y = vis.y0; y <= y1; y++) {
    for (let x = vis.x0; x <= vis.x1; x++) {
      const i = y * map.width + x;
      const days = map.fire[i];
      if (days) drawFire(f, x, y, i, days, time);
    }
  }
  ctx.globalAlpha = 1;
}

function drawFire(f: Frame, x: number, y: number, i: number, days: number, time: number): void {
  const { ctx, s } = f;
  const X = f.px(x);
  const Y = f.py(y);
  const top = tileTop(f, i) * f.hs;
  const seed = hash2(x, y, 31);
  const cx = X + s / 2;
  const base = Y + s * 0.55 - top;

  // Carbonizado: más oscuro cuanto más tiempo lleva ardiendo
  ctx.fillStyle = withAlpha(WORLD.char, Math.min(0.55, 0.14 + days * 0.07));
  ctx.fillRect(X + s * 0.08, Y - top, s * 0.84, s * 0.92 + top);

  // Resplandor
  const flicker = 0.75 + 0.25 * Math.sin(time * 11 + seed * 20);
  const glow = ctx.createRadialGradient(cx, base, 0, cx, base, s * 0.95);
  glow.addColorStop(0, withAlpha(WORLD.fire, 0.5 * flicker));
  glow.addColorStop(1, withAlpha(WORLD.fire, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(cx - s, base - s, s * 2, s * 2);

  // Lenguas de fuego (exterior ámbar, núcleo claro)
  for (let k = 0; k < 3; k++) {
    const fx = X + s * (0.28 + 0.22 * k);
    const h = s * (0.32 + 0.16 * Math.sin(time * 9 + seed * 7 + k * 2.1) + 0.08 * (k === 1 ? 1 : 0));
    const w = s * 0.11;
    tongue(ctx, fx, base, w, h, WORLD.fire);
    tongue(ctx, fx, base, w * 0.5, h * 0.55, WORLD.fireCore);
  }

  // Humo: tres bocanadas que suben y se desvanecen
  if (s < 8) return;
  for (let k = 0; k < 3; k++) {
    const phase = (time * 0.32 + seed + k / 3) % 1;
    const r = s * (0.16 + phase * 0.32);
    ctx.globalAlpha = 0.38 * (1 - phase);
    ctx.fillStyle = WORLD.smoke;
    ctx.beginPath();
    ctx.arc(cx + phase * s * 0.7 + Math.sin(time + k) * s * 0.06, base - s * 0.45 - phase * s * 1.7, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function tongue(ctx: CanvasRenderingContext2D, x: number, base: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - w, base);
  ctx.quadraticCurveTo(x - w, base - h * 0.55, x, base - h);
  ctx.quadraticCurveTo(x + w, base - h * 0.55, x + w, base);
  ctx.closePath();
  ctx.fill();
}
