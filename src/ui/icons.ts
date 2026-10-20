/**
 * Iconos de AKROPOLIS: una sola familia de trazo (1,6 px, esquinas rectas) en una rejilla de 20 × 20.
 * Usan currentColor, así que toman el color del texto que los rodea.
 */
const PATHS = {
  // Métricas
  money: '<rect x="2.5" y="5.5" width="15" height="9"/><circle cx="10" cy="10" r="2.2"/><path d="M5 8v4M15 8v4"/>',
  population: '<circle cx="7.5" cy="6.5" r="2.5"/><path d="M3 16.5v-1.5a4.5 4.5 0 0 1 9 0v1.5"/><circle cx="14" cy="7.5" r="2"/><path d="M13 12.3a3.3 3.3 0 0 1 4.5 3v1.2h-3.5"/>',
  happiness: '<circle cx="10" cy="10" r="7.5"/><path d="M6.8 11.6a3.8 3.8 0 0 0 6.4 0M7.5 7.6v1M12.5 7.6v1"/>',
  jobs: '<rect x="2.8" y="6.5" width="14.4" height="10"/><path d="M7.3 6.5V4h5.4v2.5M2.8 11h14.4"/>',
  traffic: '<path d="M3.5 13.5v-3.2l2-4.3h9l2 4.3v3.2z"/><path d="M3.5 10.3h13"/><circle cx="6.5" cy="15" r="1.4"/><circle cx="13.5" cy="15" r="1.4"/>',
  bolt: '<path d="M11.2 2.5L5 11h4.6l-1 6.5L15 9h-4.6z"/>',
  drop: '<path d="M10 2.8S4.8 9 4.8 12.2a5.2 5.2 0 0 0 10.4 0C15.2 9 10 2.8 10 2.8z"/>',
  calendar: '<rect x="3" y="4.5" width="14" height="12.5"/><path d="M3 8.5h14M7 2.5v4M13 2.5v4"/>',
  demand: '<path d="M4 16.5V9M10 16.5V4.5M16 16.5v-5"/>',
  // Tiempo
  pause: '<path d="M7 4.5v11M13 4.5v11"/>',
  play: '<path d="M6.5 4.5l8.5 5.5-8.5 5.5z"/>',
  fast: '<path d="M3 5l7 5-7 5zM10 5l7 5-7 5z"/>',
  fastest: '<path d="M2 6l5 4-5 4zM7.5 6l5 4-5 4zM13 6l5 4-5 4z"/>',
  // Gestión
  menu: '<path d="M3 5.5h14M3 10h14M3 14.5h14"/>',
  budget: '<rect x="4" y="2.8" width="12" height="14.4"/><path d="M7 7h6M7 10h6M7 13h3"/>',
  stats: '<path d="M3 17h14"/><path d="M4 13l4-4 3 2.5 5-6"/>',
  help: '<circle cx="10" cy="10" r="7.5"/><path d="M7.8 8a2.3 2.3 0 1 1 3.4 2c-.8.4-1.2.9-1.2 1.8"/><path d="M10 14.2v.6"/>',
  close: '<path d="M5 5l10 10M15 5L5 15"/>',
  layers: '<path d="M10 3l7 4-7 4-7-4z"/><path d="M3 10.5l7 4 7-4"/><path d="M3 14l7 4 7-4"/>',
  // Construcción
  inspect: '<circle cx="8.5" cy="8.5" r="5"/><path d="M12.2 12.2L17 17"/>',
  road: '<path d="M7 3L4 17M13 3l3 14M10 4v2M10 9v2M10 14v2"/>',
  zones: '<rect x="3" y="3" width="6" height="6"/><rect x="11" y="3" width="6" height="6"/><rect x="3" y="11" width="6" height="6"/><rect x="11" y="11" width="6" height="6"/>',
  pylon: '<path d="M10 2.5L6 17.5M10 2.5l4 15M6.6 7h6.8M5.5 11.5h9M7.4 14.8h5.2"/>',
  services: '<path d="M10 2.5l6 2.5v5c0 3.5-2.5 6-6 7.5-3.5-1.5-6-4-6-7.5V5z"/><path d="M10 7v6M7 10h6"/>',
  park: '<circle cx="10" cy="8" r="5"/><path d="M10 13v4.5M7 17.5h6"/>',
  demolish: '<path d="M4 6h12M8 6V3.8h4V6M5.5 6l1 11h7l1-11M8.5 9v5M11.5 9v5"/>',
  // Varios
  lock: '<rect x="5" y="9" width="10" height="8"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/>',
  plus: '<path d="M10 4.5v11M4.5 10h11"/>',
  minus: '<path d="M4.5 10h11"/>',
  save: '<path d="M4 3h9.5L16.5 6v11H4z"/><path d="M7 3v4h6V3M7 11h6v6H7z"/>',
  folder: '<path d="M3 5.5V16h14V7.5H9.5L8 5.5z"/>',
  download: '<path d="M10 3v10M6 9.5l4 4 4-4M4 17h12"/>',
  upload: '<path d="M10 13V3M6 6.5l4-4 4 4M4 17h12"/>',
  exit: '<path d="M8 4H4v12h4M12 6l4 4-4 4M16 10H7.5"/>',
  alert: '<path d="M10 3l7.5 13.5h-15z"/><path d="M10 8v4M10 14v.6"/>',
  info: '<circle cx="10" cy="10" r="7.5"/><path d="M10 9v5M10 6.2v.6"/>',
  spark: '<path d="M10 2.5l1.8 5.7 5.7 1.8-5.7 1.8L10 17.5l-1.8-5.7L2.5 10l5.7-1.8z"/>',
  check: '<path d="M4 10.5l4 4 8-9"/>',
  undo: '<path d="M7 4.5L3.5 8 7 11.5"/><path d="M3.5 8H12a4.5 4.5 0 0 1 0 9H8"/>',
  redo: '<path d="M13 4.5L16.5 8 13 11.5"/><path d="M16.5 8H8a4.5 4.5 0 0 0 0 9h4"/>',
  agora: '<path d="M3 4h14v9.5H9.5L5.5 17v-3.5H3z"/><path d="M6.5 7.5h7M6.5 10h4.5"/>',
  vote: '<path d="M3 10.5h14V17H3z"/><path d="M6.5 10.5V3.5h7v7"/><path d="M8.2 7.1l1.4 1.4 2.6-2.8"/>',
  sliders: '<path d="M3 5.5h3M10 5.5h7M3 10h9M16 10h1M3 14.5h1M8 14.5h9"/><rect x="6" y="4" width="4" height="3"/><rect x="12" y="8.5" width="4" height="3"/><rect x="4" y="13" width="4" height="3"/>',
  strip: '<path d="M3 10h14"/><rect x="3" y="3.5" width="14" height="4"/><rect x="3" y="12.5" width="14" height="4"/>',
  flag: '<path d="M5 17.5V3M5 4h10l-2.5 3.5L15 11H5"/>',
  plot: '<rect x="3.5" y="3.5" width="13" height="13"/><path d="M3.5 10h13M10 3.5v13" stroke-dasharray="2 2"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, size = 18): string {
  return `<svg class="icon" viewBox="0 0 20 20" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${PATHS[name]}</svg>`;
}

/** Elemento <span> con el icono dentro, para componer en el DOM. */
export function iconEl(name: IconName, size = 18, className = 'icon-wrap'): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className;
  span.innerHTML = icon(name, size);
  return span;
}
