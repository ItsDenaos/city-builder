import { RANKS } from '../sim/data/progression';
import type { GameState } from '../sim/state';
import { TUTORIAL, advanceTutorial } from '../sim/tutorial';
import { icon } from './icons';

const REFRESH_MS = 250;

/**
 * Tarjeta de primeros pasos (arriba a la izquierda): el objetivo en curso, cómo cumplirlo
 * y una escalinata de segmentos con lo hecho. Se cierra sola al terminar o con «Saltar».
 */
export class TutorialCard {
  readonly el = document.createElement('section');
  /** Categoría del dock que pide resaltar el paso en curso. */
  highlight: string | null = null;
  private lastKey = '';
  private lastRefresh = 0;
  private state: GameState | null = null;

  constructor(private onFinish: () => void) {
    this.el.className = 'panel tutorial hidden';
    this.el.setAttribute('aria-label', 'Primeros pasos');
    this.el.setAttribute('aria-live', 'polite');
    this.el.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
      if ((action === 'skip' || action === 'finish') && this.state) {
        this.state.tutorial = null;
        this.lastKey = '';
        this.onFinish();
      }
    });
  }

  update(state: GameState): void {
    this.state = state;
    const t = state.tutorial;
    if (!t) {
      this.highlight = null;
      if (this.lastKey) this.render('', '');
      return;
    }
    if (performance.now() - this.lastRefresh < REFRESH_MS) return;
    this.lastRefresh = performance.now();
    const advanced = advanceTutorial(state) !== null;
    const step = TUTORIAL[t.step];
    this.highlight = step?.highlight ?? null;
    const key = `${t.step}`;
    if (key === this.lastKey) return;
    const segments = TUTORIAL.map((_, k) => `<span class="${k < t.step ? 'is-done' : k === t.step ? 'is-current' : ''}"></span>`).join('');
    const html = step
      ? `<div class="tutorial-head"><span class="kicker">Primeros pasos · ${t.step + 1} de ${TUTORIAL.length}</span>
          <button class="icon-btn" data-action="skip" data-tip="Saltar los primeros pasos" aria-label="Saltar los primeros pasos">${icon('close', 14)}</button></div>
        <div class="tutorial-steps" aria-hidden="true">${segments}</div>
        <h3 class="tutorial-title">${step.title}</h3>
        <p class="tutorial-hint">${step.hint}</p>`
      : `<div class="tutorial-head"><span class="kicker">Primeros pasos · completado</span></div>
        <div class="tutorial-steps" aria-hidden="true">${segments}</div>
        <h3 class="tutorial-title">Ya sabes lo básico</h3>
        <p class="tutorial-hint">Siguiente meta: ${RANKS[1].name.toLowerCase()} de ${RANKS[1].population.toLocaleString('es-ES')} habitantes. El panel Progreso (tecla L) muestra los rangos, el terreno y los logros.</p>
        <div class="tutorial-actions"><button class="btn btn--primary" data-action="finish">Entendido</button></div>`;
    this.render(key, html, advanced);
  }

  private render(key: string, html: string, advanced = false): void {
    this.lastKey = key;
    this.el.classList.toggle('hidden', !html);
    this.el.innerHTML = html;
    if (advanced) {
      // Un destello dorado cuando se cumple un paso
      this.el.classList.remove('is-advanced');
      void this.el.offsetWidth;
      this.el.classList.add('is-advanced');
    }
  }
}
