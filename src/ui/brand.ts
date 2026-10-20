import { BRAND } from '../theme';

/**
 * Marca de AKROPOLIS.
 *
 * Símbolo: tres niveles escalonados que ascienden hacia un centro elevado (la "ciudad en alto"),
 * partidos por un eje vertical (la avenida que sube al centro) y coronados por un punto de oro.
 * Funciona a 16 px porque la silueta no depende de los detalles.
 */
export type MarkTone = 'light' | 'dark' | 'mono';

const STEPS = [
  // Nivel 1 (base) y nivel 2, partidos por la avenida central
  'M4 28h15v5H4z',
  'M21 28h15v5H21z',
  'M9 20h10v5H9z',
  'M21 20h10v5H21z',
  // Nivel 3: la plataforma superior, entera
  'M14 12h12v5H14z',
];
const APEX = 'M18 4h4v4h-4z';

/** Símbolo en SVG. light = para fondos oscuros, dark = para fondos claros, mono = currentColor. */
export function symbolSVG(tone: MarkTone = 'light', size = 32, title?: string): string {
  const steps = tone === 'light' ? BRAND.marble : tone === 'dark' ? BRAND.slate : 'currentColor';
  const apex = tone === 'mono' ? 'currentColor' : BRAND.gold;
  const label = title ? `<title>${title}</title>` : '';
  return `<svg class="brand-symbol" viewBox="0 0 40 40" width="${size}" height="${size}" role="${title ? 'img' : 'presentation'}" ${title ? '' : 'aria-hidden="true"'}>${label}<path fill="${steps}" d="${STEPS.join('')}"/><path fill="${apex}" d="${APEX}"/></svg>`;
}

/**
 * Emblema de rango: una escalinata con un peldaño por rango. Los alcanzados en mármol,
 * el actual en oro y los que faltan solo dibujados. Es el símbolo de la marca contado en rangos.
 */
export function rankEmblemSVG(rank: number, total: number, width = 120): string {
  const step = 84 / total;
  const bars = Array.from({ length: total }, (_, k) => {
    const w = 112 - (k * 96) / Math.max(1, total - 1);
    const x = (120 - w) / 2;
    const y = 84 - (k + 1) * step + 1.5;
    const h = step - 3;
    if (k < rank) return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${BRAND.marble}"/>`;
    if (k === rank) return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${BRAND.gold}"/>`;
    return `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" fill="none" stroke="rgba(234,230,220,0.28)"/>`;
  }).join('');
  return `<svg viewBox="0 0 120 84" width="${width}" height="${(width * 84) / 120}" aria-hidden="true">${bars}</svg>`;
}

/** Logotipo: símbolo + palabra AKROPOLIS (y el lema, si se pide). Las variantes se controlan con clases CSS. */
export function lockupHTML(opts: { tone?: MarkTone; size?: 'small' | 'large'; tagline?: boolean } = {}): string {
  const { tone = 'light', size = 'large', tagline = false } = opts;
  const symbol = symbolSVG(tone, size === 'large' ? 56 : 24);
  return `<div class="lockup lockup--${size} lockup--${tone}">
    ${symbol}
    <div class="lockup-text">
      <span class="wordmark">AKROPOLIS</span>
      ${tagline ? '<span class="tagline">BUILD BEYOND.</span>' : ''}
    </div>
  </div>`;
}
