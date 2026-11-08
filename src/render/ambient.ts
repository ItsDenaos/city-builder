import type { WeatherKind } from '../sim/data/weather';
import { WORLD } from './art/palette';
import { type Frame, hash2 } from './art/util';

/**
 * Ambiente (fase 20): hora del día y tiempo, solo en el dibujo. La hora la lleva main.ts con un reloj propio
 * (una vuelta cada pocos minutos reales, parado en pausa); el tiempo viene de la simulación (state.weather).
 * Orden de dibujo: ciudad → oscuridad, nubes y luces (drawDarkness) → fuego → lluvia, nieve, niebla y
 * relámpagos (drawWeather).
 */
export interface Ambient {
  /** Hora del día, 0-1: 0 es medianoche y 0,5 mediodía. */
  hour: number;
  weather: WeatherKind;
  /** Sin partículas ni relámpagos (ajuste «Reducir animaciones»). */
  still: boolean;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Luz del día (0 de noche, 1 a pleno sol) y cuánto tiene de amanecer o atardecer (0-1). */
export function daylight(hour: number): { light: number; warm: number } {
  const light = clamp01(smoothstep(0.21, 0.29, hour) - smoothstep(0.76, 0.84, hour));
  const bump = (center: number) => Math.max(0, 1 - Math.abs(hour - center) / 0.05);
  return { light, warm: Math.min(1, bump(0.255) + bump(0.8)) };
}

/** Fracción de ventanas encendidas: se encienden al anochecer y muchas se apagan de madrugada. */
export function litShare(hour: number): number {
  const night = 1 - daylight(hour).light;
  const lateNight = hour > 0.04 && hour < 0.22 ? 1 : 0;
  return night * (lateNight ? 0.3 : 0.7);
}

/** «21:30» para una hora del día en 0-1. */
export function hourLabel(hour: number): string {
  const minutes = Math.floor(((hour % 1) + 1) % 1 * 24 * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Brillo de un relámpago (0-1) en este instante, solo en tormenta: dos destellos seguidos cada unos 9 s. */
export function lightning(ambient: Ambient, time: number): number {
  if (ambient.weather !== 'storm' || ambient.still) return 0;
  const phase = (time / 9.3) % 1;
  if (phase < 0.012) return 1 - phase / 0.012;
  if (phase > 0.02 && phase < 0.028) return 0.6 * (1 - (phase - 0.02) / 0.008);
  return 0;
}

/** Cuánto oscurece el tiempo (multiplicando por gris). */
const WEATHER_DIM: Record<WeatherKind, number> = { clear: 0, clouds: 0.18, rain: 0.3, storm: 0.45, fog: 0.12, snow: 0.08 };
/** Sombras de nubes que pasan: cuántas. */
const CLOUD_SHADOWS: Record<WeatherKind, number> = { clear: 2, clouds: 6, rain: 7, storm: 8, fog: 0, snow: 4 };

/** Rellena la pantalla con un color en modo multiplicar (oscurece sin apagar los colores). */
function multiply(f: Frame, w: number, h: number, color: string, alpha: number): void {
  if (alpha <= 0.005) return;
  const { ctx } = f;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** Oscuridad de la noche, tono del atardecer, nubes y luces de la ciudad (ventanas, farolas y faros). */
export function drawDarkness(f: Frame, ambient: Ambient, w: number, h: number): void {
  const { ctx, time, s } = f;
  const { light, warm } = daylight(ambient.hour);
  const night = 1 - light;

  // Nubes que pasan: sombras suaves que cruzan el mapa despacio (en pantalla)
  const clouds = ambient.still ? 0 : CLOUD_SHADOWS[ambient.weather];
  for (let k = 0; k < clouds; k++) {
    const r = Math.max(w, h) * (0.18 + hash2(k, 1, 91) * 0.16);
    const cx = (((hash2(k, 2, 91) + time * (0.006 + hash2(k, 3, 91) * 0.006)) % 1.4) - 0.2) * w;
    const cy = hash2(k, 4, 91) * h;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    const a = (ambient.weather === 'clear' ? 0.06 : 0.14) * (0.4 + light * 0.6);
    g.addColorStop(0, `rgba(${WORLD.cloudShadow}, ${a.toFixed(3)})`);
    g.addColorStop(1, `rgba(${WORLD.cloudShadow}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  multiply(f, w, h, WORLD.weatherDim, WEATHER_DIM[ambient.weather]);
  multiply(f, w, h, WORLD.duskTint, warm * 0.45);
  multiply(f, w, h, WORLD.nightTint, night * 0.78);

  if (night < 0.05) return;
  // Luces: por encima de la oscuridad, para que brillen
  ctx.save();
  ctx.globalAlpha = Math.min(1, night * 1.3);
  ctx.fillStyle = WORLD.windowLight;
  const L = f.lights;
  for (let k = 0; k < L.length; k += 4) ctx.fillRect(L[k], L[k + 1], L[k + 2], L[k + 3]);
  ctx.fillStyle = WORLD.headlight;
  const H = f.headlights;
  for (let k = 0; k < H.length; k += 4) ctx.fillRect(H[k], H[k + 1], H[k + 2], H[k + 3]);
  ctx.restore();

  // Farolas: en una de cada tres casillas de calle, repartidas sin patrón, con un halo que suma luz
  if (!f.detail || s < 12) return;
  const { map } = f.state;
  const halo = glowSprite();
  const size = s * 1.1;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = night;
  for (let y = f.vis.y0; y <= f.vis.y1; y++) {
    for (let x = f.vis.x0; x <= f.vis.x1; x++) {
      if (!map.road[y * map.width + x] || hash2(x, y, 31) > 0.33) continue;
      const lx = f.px(x) + s * 0.12;
      const ly = f.py(y) + s * 0.12;
      ctx.drawImage(halo, lx - size / 2, ly - size / 2, size, size);
    }
  }
  ctx.restore();
}

let glow: HTMLCanvasElement | null = null;

/** Halo de farola, dibujado una vez y reutilizado: núcleo claro que se apaga hacia fuera. */
function glowSprite(): HTMLCanvasElement {
  if (glow) return glow;
  glow = document.createElement('canvas');
  glow.width = glow.height = 64;
  const g = glow.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `rgba(${WORLD.lampGlow}, 1)`);
  grad.addColorStop(0.08, `rgba(${WORLD.lampGlow}, 0.9)`);
  grad.addColorStop(0.25, `rgba(${WORLD.lampGlow}, 0.28)`);
  grad.addColorStop(1, `rgba(${WORLD.lampGlow}, 0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return glow;
}

/** Lluvia, nieve, niebla y relámpagos, por encima de todo el mapa. */
export function drawWeather(f: Frame, ambient: Ambient, w: number, h: number): void {
  const { ctx, time } = f;
  const kind = ambient.weather;
  if (kind === 'fog') {
    // La niebla es clara de día y apenas se ve de noche (no la ilumina nada)
    ctx.save();
    ctx.globalAlpha = 0.3 + 0.7 * daylight(ambient.hour).light;
    ctx.fillStyle = WORLD.fog;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  if (ambient.still) return;
  if (kind === 'rain' || kind === 'storm') {
    const n = Math.round(((w * h) / 6000) * (kind === 'storm' ? 1.8 : 1));
    ctx.strokeStyle = WORLD.rain;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k < n; k++) {
      const x = hash2(k, 1, 57) * (w + 40);
      const y = ((hash2(k, 2, 57) + time * (1.1 + hash2(k, 3, 57) * 0.4)) % 1) * (h + 40) - 20;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 4, y + 14);
    }
    ctx.stroke();
  }
  if (kind === 'snow') {
    const n = Math.round((w * h) / 4500);
    ctx.fillStyle = WORLD.snow;
    for (let k = 0; k < n; k++) {
      const x = hash2(k, 1, 73) * w + Math.sin(time * 0.8 + k) * 8;
      const y = ((hash2(k, 2, 73) + time * (0.05 + hash2(k, 3, 73) * 0.05)) % 1) * h;
      const r = 1 + hash2(k, 4, 73) * 1.5;
      ctx.fillRect(x, y, r, r);
    }
  }
  const flash = lightning(ambient, time);
  if (flash > 0) {
    ctx.fillStyle = `rgba(${WORLD.lightning}, ${(flash * 0.45).toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
  }
}
