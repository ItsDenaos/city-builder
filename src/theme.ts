import { ZONE_COLORS, getZoneDef, setZoneColors } from './sim/data/zones';

/**
 * Sistema de diseño de AKROPOLIS: única fuente de colores, tipografía y medidas.
 * La interfaz (CSS) los recibe como variables con applyTheme(); el canvas los importa directamente.
 */

/** Los cuatro colores de marca. */
export const BRAND = {
  slate: '#172B3A', // Midnight Slate: fondos y superficies de marca
  gold: '#D2AE70', // Aegean Gold: acentos con significado (selección, hitos, avenidas)
  marble: '#EAE6DC', // Marble: texto sobre oscuro y superficies claras
  olive: '#577A70', // Olive Grove: naturaleza, parques, sostenibilidad
} as const;

/** Paleta de soporte para la interfaz. */
export const UI = {
  // Superficies, de la más profunda a la más elevada
  surface0: '#0E1D28',
  surface1: BRAND.slate,
  surface2: '#1E3546',
  surface3: '#284356',
  surface4: '#345369',
  panel: 'rgba(17, 33, 45, 0.95)',
  scrim: 'rgba(11, 22, 31, 0.72)',
  line: 'rgba(234, 230, 220, 0.10)',
  lineStrong: 'rgba(234, 230, 220, 0.22)',

  text: BRAND.marble,
  textSecondary: '#BAC3C5',
  textMuted: '#96A7B1',
  textInverse: BRAND.slate,

  gold: BRAND.gold,
  goldStrong: '#E6C892',
  goldSoft: 'rgba(210, 174, 112, 0.16)',
  olive: BRAND.olive,
  oliveLight: '#86A79C',

  // Estados
  positive: '#7DC4A0',
  warning: '#E8B45A',
  negative: '#E5806F',
  info: '#86B4D8',
  focus: BRAND.gold,
} as const;

/**
 * Colores de información de juego. Mantienen sus significados habituales
 * (verde residencial, azul comercial, amarillo industrial...) en tonos que conviven con la marca.
 * Los de zona salen del catálogo de zonas para que mapa, menús y barras de demanda coincidan.
 */
export const DATA = {
  zoneR: getZoneDef('R', 'medium').color,
  zoneC: getZoneDef('C', 'medium').color,
  zoneI: getZoneDef('I', 'medium').color,
  power: '#E8C547',
  water: '#5AB3D9',
  income: UI.positive,
  expense: UI.negative,
  population: '#9CC3B4',
  happiness: '#E6C892',
  unemployment: UI.negative,
  commute: UI.info,
  transit: '#D9895B',
  garbage: '#A68A5B',
  wellness: '#8CC7A8',
  // Edades y estudios (fase 15)
  children: '#E6C892',
  adults: '#86B4D8',
  elderly: '#B9A3C9',
  eduNone: '#E5806F',
  eduBasic: '#E8B45A',
  eduHigher: '#7DC4A0',
  tourism: '#D2AE70',
} as const;

export const FONTS = {
  display: "'Sora', 'Segoe UI', system-ui, sans-serif",
  body: "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif",
} as const;

/**
 * Paletas para daltonismo (fase 21). Cambian los colores con significado: zonas (y con ellas las barras de
 * demanda), estados (bien, aviso, mal) y las rampas de las vistas de datos. Basadas en la paleta de Okabe e Ito.
 * - redGreen: protanopía y deuteranopía (no distinguen rojo de verde): azul, bermellón y gris claro.
 * - blueYellow: tritanopía (no distinguen azul de amarillo): verde azulado, rosa y pardo.
 */
export type ColorVision = 'normal' | 'redGreen' | 'blueYellow';

type Shades = Record<'low' | 'medium' | 'high', string>;
interface VisionPalette {
  zones: Record<'R' | 'C' | 'I', Shades>;
  positive: string;
  warning: string;
  negative: string;
}

const NORMAL_ZONES = structuredClone(ZONE_COLORS);
export const VISION_PALETTES: Record<ColorVision, VisionPalette> = {
  normal: { zones: NORMAL_ZONES, positive: '#7DC4A0', warning: '#E8B45A', negative: '#E5806F' },
  // Azul, bermellón y gris claro: la terna de Okabe-Ito más separada con protanopía y deuteranopía
  // (tests/colorvision.test.ts lo comprueba simulando la visión de cada deficiencia)
  redGreen: {
    zones: {
      R: { low: '#4A9BD1', medium: '#0072B2', high: '#005A8C' },
      C: { low: '#E68A4D', medium: '#D55E00', high: '#A84A00' },
      I: { low: '#E6E1D8', medium: '#D8D2C8', high: '#B9B2A6' },
    },
    positive: '#56B4E9',
    warning: '#F0E442',
    negative: '#E07B2A',
  },
  blueYellow: {
    zones: {
      R: { low: '#8FD6C0', medium: '#3FB08F', high: '#1F8A6C' },
      C: { low: '#F2A3B0', medium: '#E0707A', high: '#B84A56' },
      I: { low: '#CBBBAA', medium: '#A88F7A', high: '#7F6A57' },
    },
    positive: '#3FB08F',
    warning: '#E8D8D0',
    negative: '#E0707A',
  },
};

/** Aplica una paleta a los tokens (y los vuelve a publicar como variables CSS si hay página). */
export function setColorVision(mode: ColorVision): void {
  const p = VISION_PALETTES[mode];
  const ui = UI as { -readonly [K in keyof typeof UI]: string };
  const data = DATA as { -readonly [K in keyof typeof DATA]: string };
  ui.positive = p.positive;
  ui.warning = p.warning;
  ui.negative = p.negative;
  data.zoneR = p.zones.R.medium;
  data.zoneC = p.zones.C.medium;
  data.zoneI = p.zones.I.medium;
  data.income = p.positive;
  data.expense = p.negative;
  data.unemployment = p.negative;
  setZoneColors(p.zones);
  if (typeof document !== 'undefined') applyTheme();
}

/** Escala de espaciado (px) y radios: esquinas casi rectas, aspecto de herramienta técnica. */
export const SPACE = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32 } as const;
export const RADIUS = { control: 3, panel: 4 } as const;

/** surface0 → surface-0, goldStrong → gold-strong, '1' → '1'. */
const kebab = (s: string) => s.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase();

/** Publica todos los tokens como variables CSS en :root (--ui-surface-1, --data-zone-r, --font-display...). */
export function applyTheme(root: HTMLElement = document.documentElement): void {
  const set = (prefix: string, obj: Record<string, string | number>, unit = '') => {
    for (const [k, v] of Object.entries(obj)) root.style.setProperty(`--${prefix}-${kebab(k)}`, `${v}${unit}`);
  };
  set('brand', BRAND);
  set('ui', UI);
  set('data', DATA);
  set('font', FONTS);
  set('space', SPACE, 'px');
  set('radius', RADIUS, 'px');
}
