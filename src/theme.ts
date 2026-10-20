import { getZoneDef } from './sim/data/zones';

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
} as const;

export const FONTS = {
  display: "'Sora', 'Segoe UI', system-ui, sans-serif",
  body: "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif",
} as const;

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
