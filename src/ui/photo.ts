import { icon } from './icons';
import { tip } from './tooltip';

/**
 * Modo foto (fase 20): oculta la interfaz, deja elegir la hora y el desenfoque de maqueta, y guarda lo que
 * se ve del mapa como imagen PNG. La interfaz no sale en la foto: es HTML, no forma parte del lienzo.
 */
export type PhotoHour = 'now' | 'day' | 'dusk' | 'night';

/** Hora del día (0-1) de cada opción; «now» deja la del reloj. */
export const PHOTO_HOURS: Record<PhotoHour, number | null> = { now: null, day: 0.5, dusk: 0.795, night: 0.95 };
const HOUR_LABELS: Record<PhotoHour, string> = { now: 'Ahora', day: 'Día', dusk: 'Atardecer', night: 'Noche' };

export class PhotoBar {
  readonly el = document.createElement('div');
  hour: PhotoHour = 'now';
  tiltShift = true;
  private hourButtons = new Map<PhotoHour, HTMLButtonElement>();
  private tiltButton = document.createElement('button');

  constructor(
    private capture: () => void,
    private exit: () => void,
  ) {
    this.el.className = 'panel photo-bar hidden';
    this.el.setAttribute('aria-label', 'Modo foto');
    const shot = document.createElement('button');
    shot.className = 'btn btn--primary';
    shot.innerHTML = `${icon('camera', 16)}<span>Guardar foto</span>`;
    shot.onclick = () => this.capture();
    tip(shot, 'Guardar lo que se ve como imagen PNG');

    const hours = document.createElement('div');
    hours.className = 'segmented';
    hours.setAttribute('role', 'radiogroup');
    hours.setAttribute('aria-label', 'Hora de la foto');
    for (const h of Object.keys(HOUR_LABELS) as PhotoHour[]) {
      const b = document.createElement('button');
      b.textContent = HOUR_LABELS[h];
      b.setAttribute('role', 'radio');
      b.onclick = () => {
        this.hour = h;
        this.render();
      };
      this.hourButtons.set(h, b);
      hours.append(b);
    }

    this.tiltButton.className = 'btn';
    this.tiltButton.textContent = 'Maqueta';
    tip(this.tiltButton, 'Desenfoque arriba y abajo, como una foto de maqueta');
    this.tiltButton.onclick = () => {
      this.tiltShift = !this.tiltShift;
      this.render();
    };

    const close = document.createElement('button');
    close.className = 'icon-btn';
    close.innerHTML = icon('close', 16);
    close.setAttribute('aria-label', 'Salir del modo foto');
    tip(close, 'Salir del modo foto', 'Esc');
    close.onclick = () => this.exit();

    const label = document.createElement('span');
    label.className = 'kicker';
    label.textContent = 'Modo foto';
    this.el.append(label, hours, this.tiltButton, shot, close);
    this.render();
  }

  get open(): boolean {
    return !this.el.classList.contains('hidden');
  }

  toggle(force?: boolean): void {
    this.el.classList.toggle('hidden', !(force ?? !this.open));
  }

  private render(): void {
    for (const [h, b] of this.hourButtons) b.setAttribute('aria-checked', String(h === this.hour));
    this.tiltButton.classList.toggle('is-active', this.tiltShift);
    this.tiltButton.setAttribute('aria-pressed', String(this.tiltShift));
  }
}

/** Guarda el lienzo como PNG con un nombre que dice qué ciudad y qué fecha es. */
export function downloadCanvas(canvas: HTMLCanvasElement, city: string, year: number, month: number): void {
  const slug = city
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'ciudad';
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `akropolis-${slug}-${year}-${String(month).padStart(2, '0')}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }, 'image/png');
}
