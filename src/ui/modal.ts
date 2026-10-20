export interface ModalAction {
  label: string;
  primary?: boolean;
  onClick?: () => void;
}

/** Opción de un evento: etiqueta, coste y lo que pasará. */
export interface ModalChoice {
  label: string;
  detail: string;
  cost?: string;
  /** Motivo por el que no se puede elegir (p. ej. «Fondos insuficientes»). */
  blocked?: string;
  onClick: () => void;
}

export interface ModalOptions {
  kicker: string;
  title: string;
  /** HTML de una ilustración opcional (emblema de rango...). */
  emblem?: string;
  /** HTML del cuerpo. */
  body: string;
  tone?: 'gold' | 'negative';
  actions: ModalAction[];
  /** Decisiones: una lista de opciones en lugar de botones. */
  choices?: ModalChoice[];
  /** false: Esc no la cierra (hay que elegir). */
  dismissable?: boolean;
}

/**
 * Ventana de aviso importante (subida de rango, fin de escenario).
 * Mientras está abierta la partida se detiene; las ventanas se encolan si llegan varias a la vez.
 */
export class Modal {
  readonly el = document.createElement('div');
  private queue: ModalOptions[] = [];

  constructor() {
    this.el.className = 'modal-backdrop hidden';
  }

  get isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }

  show(opts: ModalOptions): void {
    this.queue.push(opts);
    if (!this.isOpen) this.next();
  }

  /** Esc o clic fuera: equivale a la primera acción (salvo en las decisiones, que hay que tomar). */
  dismiss(): void {
    if (this.isOpen && this.current?.dismissable !== false) this.close(this.current?.actions[0]);
  }

  private current: ModalOptions | null = null;

  private next(): void {
    const opts = this.queue.shift();
    this.current = opts ?? null;
    this.el.classList.toggle('hidden', !opts);
    if (!opts) return;
    const panel = document.createElement('div');
    panel.className = `panel modal modal--${opts.tone ?? 'gold'}`;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.innerHTML = `
      ${opts.emblem ? `<div class="modal-emblem">${opts.emblem}</div>` : ''}
      <div class="modal-titles"><span class="kicker modal-kicker">${opts.kicker}</span><h2 class="title modal-title">${opts.title}</h2></div>
      <div class="modal-body">${opts.body}</div>`;
    if (opts.choices?.length) {
      const list = document.createElement('div');
      list.className = 'modal-choices';
      for (const c of opts.choices) {
        const b = document.createElement('button');
        b.className = 'choice';
        b.disabled = !!c.blocked;
        b.innerHTML = `<span class="choice-head"><span class="choice-label">${c.label}</span>${c.cost ? `<span class="choice-cost num">${c.cost}</span>` : '<span class="choice-cost muted">Gratis</span>'}</span>
          <span class="choice-detail">${c.blocked ?? c.detail}</span>`;
        b.onclick = () => {
          c.onClick();
          this.next();
        };
        list.append(b);
      }
      panel.append(list);
    }
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    for (const a of opts.actions) {
      const b = document.createElement('button');
      b.className = `btn ${a.primary ? 'btn--primary' : ''}`;
      b.textContent = a.label;
      b.onclick = () => this.close(a);
      actions.append(b);
    }
    if (opts.actions.length) panel.append(actions);
    this.el.replaceChildren(panel);
    panel.querySelector<HTMLElement>('.choice:not(:disabled), .btn--primary, .btn')?.focus();
  }

  private close(action?: ModalAction): void {
    action?.onClick?.();
    this.next();
  }
}
