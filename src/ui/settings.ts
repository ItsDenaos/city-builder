/**
 * Ajustes del jugador. Se guardan en este navegador y se aplican al momento.
 * Los valores son números para que todos se elijan con el mismo control segmentado (0/1 = no/sí).
 */
export interface Settings {
  /** Meses entre autoguardados (0 = nunca). */
  autosaveMonths: number;
  /** Mover la cámara al llevar el ratón al borde de la pantalla. */
  edgeScroll: number;
  /** Escala de la interfaz (no del mapa). */
  uiScale: number;
  reducedMotion: number;
  /** Consejos del asesor (los avisos graves salen siempre). */
  advisor: number;
  /** Volumen del sonido, 0-1 (fase 20). */
  volume: number;
  /** Ciclo de día y noche (fase 20); sin él, siempre es de día. */
  dayNight: number;
  /** Paleta para daltonismo (fase 21): 0 normal, 1 rojo-verde, 2 azul-amarillo. */
  colorVision: number;
  /** Idioma (fase 21): 0 español, 1 inglés. */
  language: number;
}

/** Paleta de cada valor del ajuste `colorVision`. */
export const COLOR_VISION_MODES = ['normal', 'redGreen', 'blueYellow'] as const;

export interface SettingField {
  key: keyof Settings;
  label: string;
  detail?: string;
  options: { value: number; label: string }[];
}

const NO_YES = [
  { value: 0, label: 'No' },
  { value: 1, label: 'Sí' },
];

export const SETTING_FIELDS: readonly SettingField[] = [
  {
    key: 'language',
    label: 'Idioma',
    options: [
      { value: 0, label: 'Español' },
      { value: 1, label: 'English' },
    ],
  },
  {
    key: 'autosaveMonths',
    label: 'Autoguardado',
    options: [
      { value: 0, label: 'Nunca' },
      { value: 1, label: '1 mes' },
      { value: 3, label: '3 meses' },
      { value: 6, label: '6 meses' },
      { value: 12, label: '1 año' },
    ],
  },
  { key: 'edgeScroll', label: 'Mover la cámara con los bordes de la pantalla', options: NO_YES },
  {
    key: 'uiScale',
    label: 'Tamaño de la interfaz',
    options: [
      { value: 0.9, label: '90 %' },
      { value: 1, label: '100 %' },
      { value: 1.1, label: '110 %' },
      { value: 1.25, label: '125 %' },
    ],
  },
  { key: 'reducedMotion', label: 'Reducir animaciones', options: NO_YES },
  { key: 'advisor', label: 'Consejos del asesor', detail: 'Los avisos graves (números rojos, bancarrota) se muestran siempre', options: NO_YES },
  {
    key: 'volume',
    label: 'Sonido',
    detail: 'Ambiente de la ciudad, tiempo y avisos, generados por el juego',
    options: [
      { value: 0, label: 'No' },
      { value: 0.25, label: '25 %' },
      { value: 0.5, label: '50 %' },
      { value: 0.75, label: '75 %' },
      { value: 1, label: '100 %' },
    ],
  },
  { key: 'dayNight', label: 'Ciclo de día y noche', detail: 'Un día dura unos 4 minutos de juego', options: NO_YES },
  {
    key: 'colorVision',
    label: 'Colores para daltonismo',
    detail: 'Zonas, estados y vistas de datos con colores que se distinguen',
    options: [
      { value: 0, label: 'Normales' },
      { value: 1, label: 'Rojo-verde' },
      { value: 2, label: 'Azul-amarillo' },
    ],
  },
];

const KEY = 'akropolis.settings';
const TUTORIAL_KEY = 'akropolis.tutorialDone';

function defaults(): Settings {
  let reduced = false;
  try {
    reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    // sin ventana (tests)
  }
  return { autosaveMonths: 3, edgeScroll: 0, uiScale: 1, reducedMotion: reduced ? 1 : 0, advisor: 1, volume: 0.5, dayNight: 1, colorVision: 0, language: 0 };
}

/** Ajustes guardados, con cada valor validado contra sus opciones (los que no valen toman el de serie). */
export function parseSettings(raw: unknown, base: Settings = defaults()): Settings {
  const out = { ...base };
  if (raw && typeof raw === 'object') {
    for (const f of SETTING_FIELDS) {
      const v = (raw as Record<string, unknown>)[f.key];
      if (typeof v === 'number' && f.options.some((o) => o.value === v)) out[f.key] = v;
    }
  }
  return out;
}

export function loadSettings(): Settings {
  try {
    return parseSettings(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return defaults();
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // almacenamiento lleno o bloqueado: los ajustes valen para esta sesión
  }
}

/** Lo que se ve en la página: escala de la interfaz y animaciones. */
export function applySettings(s: Settings): void {
  document.documentElement.style.setProperty('--ui-scale', String(s.uiScale));
  document.body.classList.toggle('reduce-motion', s.reducedMotion === 1);
}

export function tutorialDone(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_KEY) === '1';
  } catch {
    return false;
  }
}

export function markTutorialDone(): void {
  try {
    localStorage.setItem(TUTORIAL_KEY, '1');
  } catch {
    // sin almacenamiento: la guía se volverá a ofrecer
  }
}
