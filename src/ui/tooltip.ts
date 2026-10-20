/**
 * Descripciones emergentes de la interfaz: cualquier elemento con data-tip (y opcionalmente data-key
 * con su atajo de teclado) muestra una al pasar el ratón o al recibir el foco con el teclado.
 * Sustituyen al title nativo para que tengan el estilo de AKROPOLIS; aria-label sigue en los botones.
 */
const DELAY_MS = 350;
const GAP = 8;

export function installTooltips(root: HTMLElement): void {
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  root.append(tip);
  let timer = 0;
  let current: HTMLElement | null = null;

  const show = (target: HTMLElement) => {
    const text = target.dataset.tip;
    if (!text) return;
    tip.replaceChildren(document.createTextNode(text));
    if (target.dataset.key) {
      const kbd = document.createElement('kbd');
      kbd.textContent = target.dataset.key;
      tip.append(kbd);
    }
    tip.hidden = false;
    const r = target.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    // Debajo si cabe; si no, encima. Siempre dentro de la ventana.
    const below = r.bottom + GAP + t.height < window.innerHeight;
    const top = below ? r.bottom + GAP : r.top - GAP - t.height;
    const left = Math.min(window.innerWidth - t.width - GAP, Math.max(GAP, r.left + r.width / 2 - t.width / 2));
    // La interfaz puede estar escalada (ajuste «Tamaño de la interfaz»): pasar a sus coordenadas
    const scale = root.getBoundingClientRect().width / (root.offsetWidth || 1) || 1;
    tip.style.transform = `translate(${Math.round(left / scale)}px, ${Math.round(top / scale)}px)`;
  };
  const hide = () => {
    clearTimeout(timer);
    current = null;
    tip.hidden = true;
  };
  const enter = (e: Event) => {
    const target = (e.target as HTMLElement).closest?.<HTMLElement>('[data-tip]');
    if (!target || target === current) return;
    hide();
    current = target;
    timer = window.setTimeout(() => current === target && show(target), DELAY_MS);
  };
  document.addEventListener('pointerover', enter);
  document.addEventListener('focusin', enter);
  document.addEventListener('pointerout', (e) => {
    if (current && !current.contains(e.relatedTarget as Node)) hide();
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', hide);
}

/** Atajo para poner descripción (y accesibilidad) a un elemento. */
export function tip<T extends HTMLElement>(el: T, text: string, key?: string): T {
  el.dataset.tip = text;
  if (key) el.dataset.key = key;
  if (el instanceof HTMLButtonElement && !el.textContent?.trim()) el.setAttribute('aria-label', text);
  return el;
}
