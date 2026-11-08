import { afterAll, describe, expect, it } from 'vitest';
import { getZoneDef } from '../src/sim/data/zones';
import { type ColorVision, DATA, UI, VISION_PALETTES, setColorVision } from '../src/theme';

/** Matrices de Machado, Oliveira y Fernandes (2009) para cada deficiencia, con severidad completa. */
const MACHADO = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
} as const;
type Deficiency = keyof typeof MACHADO;

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** Cómo ve un color una persona con esa deficiencia (componentes 0-255). */
function simulate(hex: string, d: Deficiency): number[] {
  const rgb = [1, 3, 5].map((k) => toLinear(parseInt(hex.slice(k, k + 2), 16) / 255));
  return MACHADO[d].map((row) => Math.round(255 * toSrgb(Math.max(0, Math.min(1, row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2])))));
}

const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** La menor distancia entre dos colores cualesquiera de la lista, vistos con esa deficiencia. */
function minDistance(colors: string[], d: Deficiency): number {
  let min = Infinity;
  for (let i = 0; i < colors.length; i++) for (let j = i + 1; j < colors.length; j++) min = Math.min(min, distance(simulate(colors[i], d), simulate(colors[j], d)));
  return min;
}

const zonesOf = (mode: ColorVision) => (['R', 'C', 'I'] as const).map((z) => VISION_PALETTES[mode].zones[z].medium);
const statusOf = (mode: ColorVision) => [VISION_PALETTES[mode].positive, VISION_PALETTES[mode].negative];

describe('paletas para daltonismo', () => {
  afterAll(() => setColorVision('normal'));

  it('con la paleta rojo-verde, las zonas y los estados se distinguen con protanopía y deuteranopía', () => {
    for (const d of ['protanopia', 'deuteranopia'] as const) {
      expect(minDistance(zonesOf('redGreen'), d)).toBeGreaterThan(70);
      expect(minDistance(statusOf('redGreen'), d)).toBeGreaterThan(90);
    }
  });

  it('con la paleta azul-amarillo, se distinguen con tritanopía', () => {
    expect(minDistance(zonesOf('blueYellow'), 'tritanopia')).toBeGreaterThan(70);
    expect(minDistance(statusOf('blueYellow'), 'tritanopia')).toBeGreaterThan(90);
  });

  it('la paleta rojo-verde mejora a la normal para quien no distingue el rojo del verde', () => {
    for (const d of ['protanopia', 'deuteranopia'] as const) {
      expect(minDistance(zonesOf('redGreen'), d)).toBeGreaterThan(minDistance(zonesOf('normal'), d));
      expect(minDistance(statusOf('redGreen'), d)).toBeGreaterThan(minDistance(statusOf('normal'), d));
    }
  });

  it('cambiar la paleta cambia los tokens y las zonas, y se puede volver a la normal', () => {
    const normalR = getZoneDef('R', 'medium').color;
    setColorVision('redGreen');
    expect(DATA.zoneR).toBe(VISION_PALETTES.redGreen.zones.R.medium);
    expect(UI.negative).toBe(VISION_PALETTES.redGreen.negative);
    expect(getZoneDef('I', 'high').color).toBe(VISION_PALETTES.redGreen.zones.I.high);
    setColorVision('normal');
    expect(getZoneDef('R', 'medium').color).toBe(normalR);
    expect(UI.positive).toBe(VISION_PALETTES.normal.positive);
  });
});
