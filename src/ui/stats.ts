import type { GameState, StatsSample } from '../sim/state';
import { DATA, FONTS, UI } from '../theme';
import { icon } from './icons';
import { formatMoney } from './menus';

interface Series {
  label: string;
  color: string;
  value: (s: StatsSample) => number;
}

interface Chart {
  id: string;
  label: string;
  series: Series[];
  format: (v: number) => string;
  /** Forzar que el eje vertical incluya el cero. */
  zero?: boolean;
}

const pct = (v: number) => `${Math.round(v)} %`;

const CHARTS: Chart[] = [
  { id: 'population', label: 'Población', zero: true, format: (v) => Math.round(v).toLocaleString('es-ES'), series: [{ label: 'Habitantes', color: DATA.population, value: (s) => s.population }] },
  { id: 'money', label: 'Dinero', zero: true, format: formatMoney, series: [{ label: 'Dinero', color: UI.gold, value: (s) => s.money }] },
  {
    id: 'budget',
    label: 'Ingresos y gastos',
    zero: true,
    format: formatMoney,
    series: [
      { label: 'Ingresos', color: DATA.income, value: (s) => s.income },
      { label: 'Gastos', color: DATA.expense, value: (s) => s.expenses },
    ],
  },
  { id: 'happiness', label: 'Felicidad', zero: true, format: pct, series: [{ label: 'Felicidad', color: DATA.happiness, value: (s) => s.happiness }] },
  {
    id: 'demand',
    label: 'Demanda',
    zero: true,
    format: (v) => `${v > 0 ? '+' : ''}${Math.round(v)}`,
    series: [
      { label: 'Residencial', color: DATA.zoneR, value: (s) => s.demand.R * 100 },
      { label: 'Comercial', color: DATA.zoneC, value: (s) => s.demand.C * 100 },
      { label: 'Industrial', color: DATA.zoneI, value: (s) => s.demand.I * 100 },
    ],
  },
  { id: 'unemployment', label: 'Paro', zero: true, format: pct, series: [{ label: 'Paro', color: DATA.unemployment, value: (s) => s.unemployment * 100 }] },
  { id: 'commute', label: 'Trayecto', zero: true, format: (v) => v.toFixed(0), series: [{ label: 'Trayecto medio al trabajo', color: DATA.commute, value: (s) => s.commute }] },
];

const RANGES = [
  { months: 24, label: '2 años' },
  { months: 120, label: '10 años' },
  { months: Infinity, label: 'Todo' },
];
const REFRESH_MS = 500;

function panelHead(kicker: string, title: string, closeKey: string, onClose: () => void): HTMLElement {
  const head = document.createElement('div');
  head.className = 'panel-head';
  head.innerHTML = `<div><span class="kicker">${kicker}</span><h2 class="title">${title}</h2></div>`;
  const close = document.createElement('button');
  close.className = 'icon-btn';
  close.innerHTML = icon('close', 16);
  close.dataset.tip = 'Cerrar';
  close.dataset.key = closeKey;
  close.setAttribute('aria-label', 'Cerrar');
  close.onclick = onClose;
  head.append(close);
  return head;
}

/** Gráficas de la evolución de la ciudad, una muestra por mes. */
export class StatsPanel {
  readonly el = document.createElement('section');
  onClose: () => void = () => this.toggle(false);
  private tabs = document.createElement('div');
  private ranges = document.createElement('div');
  private canvas = document.createElement('canvas');
  private legend = document.createElement('div');
  private chart = CHARTS[0];
  private range = RANGES[1];
  private lastKey = '';
  private lastRefresh = 0;

  constructor() {
    this.el.className = 'panel side-panel stats hidden';
    this.el.setAttribute('aria-label', 'Estadísticas');
    this.tabs.className = 'tabs';
    this.tabs.setAttribute('role', 'tablist');
    for (const c of CHARTS) {
      const b = document.createElement('button');
      b.textContent = c.label;
      b.setAttribute('role', 'tab');
      b.onclick = () => this.select(c, this.range);
      b.dataset.id = c.id;
      this.tabs.append(b);
    }
    this.ranges.className = 'segmented';
    for (const r of RANGES) {
      const b = document.createElement('button');
      b.textContent = r.label;
      b.onclick = () => this.select(this.chart, r);
      b.dataset.id = r.label;
      this.ranges.append(b);
    }
    this.canvas.width = 640; // a doble resolución para que se vea nítido
    this.canvas.height = 340;
    this.canvas.className = 'stats-chart';
    this.legend.className = 'stats-legend';
    const body = document.createElement('div');
    body.className = 'panel-body';
    const foot = document.createElement('div');
    foot.className = 'stats-foot';
    foot.append(this.legend, this.ranges);
    body.append(this.tabs, this.canvas, foot);
    this.el.append(panelHead('Gestión', 'Estadísticas', 'E', () => this.onClose()), body);
    this.select(this.chart, this.range);
  }

  get open(): boolean {
    return !this.el.classList.contains('hidden');
  }

  toggle(force?: boolean): void {
    this.el.classList.toggle('hidden', !(force ?? !this.open));
    this.lastKey = '';
  }

  private select(chart: Chart, range: (typeof RANGES)[number]): void {
    this.chart = chart;
    this.range = range;
    for (const b of this.tabs.children) {
      const active = (b as HTMLElement).dataset.id === chart.id;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', String(active));
    }
    for (const b of this.ranges.children) b.classList.toggle('is-active', (b as HTMLElement).dataset.id === range.label);
    this.legend.replaceChildren(
      ...chart.series.map((s) => {
        const item = document.createElement('span');
        item.innerHTML = `<i style="background:${s.color}"></i>${s.label}`;
        return item;
      }),
    );
    this.lastKey = '';
  }

  update(state: GameState): void {
    if (!this.open || performance.now() - this.lastRefresh < REFRESH_MS) return;
    this.lastRefresh = performance.now();
    const last = state.history.at(-1);
    const key = `${state.history.length}:${last?.month}/${last?.year}:${this.chart.id}:${this.range.label}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.draw(state.history.slice(-Math.min(this.range.months, state.history.length)));
  }

  private draw(samples: StatsSample[]): void {
    const ctx = this.canvas.getContext('2d')!;
    const { width: w, height: h } = this.canvas;
    const left = 116;
    const right = 16;
    const top = 18;
    const bottom = 44;
    ctx.clearRect(0, 0, w, h);
    ctx.font = `22px ${FONTS.body}`;
    ctx.fillStyle = UI.textMuted;
    if (samples.length < 2) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Las gráficas aparecen al cerrar el segundo mes.', w / 2, h / 2);
      return;
    }

    const values = this.chart.series.flatMap((s) => samples.map(s.value));
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (this.chart.zero) {
      min = Math.min(0, min);
      max = Math.max(0, max);
    }
    if (max - min < 1e-6) max = min + 1;
    const x = (i: number) => left + (i / (samples.length - 1)) * (w - left - right);
    const y = (v: number) => top + (1 - (v - min) / (max - min)) * (h - top - bottom);

    // Rejilla de cuatro líneas, con sus valores
    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let k = 0; k <= 3; k++) {
      const v = min + ((max - min) * k) / 3;
      ctx.strokeStyle = UI.line;
      ctx.beginPath();
      ctx.moveTo(left, Math.round(y(v)) + 0.5);
      ctx.lineTo(w - right, Math.round(y(v)) + 0.5);
      ctx.stroke();
      ctx.fillText(this.chart.format(v), left - 12, y(v));
    }
    if (min < 0 && max > 0) {
      ctx.strokeStyle = UI.lineStrong;
      ctx.beginPath();
      ctx.moveTo(left, y(0));
      ctx.lineTo(w - right, y(0));
      ctx.stroke();
    }
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const date = (s: StatsSample) => `${s.month}/${s.year}`;
    ctx.fillText(date(samples[0]), left, h - bottom + 12);
    ctx.textAlign = 'right';
    ctx.fillText(date(samples[samples.length - 1]), w - right, h - bottom + 12);

    for (const s of this.chart.series) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      samples.forEach((p, i) => (i ? ctx.lineTo(x(i), y(s.value(p))) : ctx.moveTo(x(i), y(s.value(p)))));
      ctx.stroke();
      // Punto final: el valor actual
      const lastV = s.value(samples[samples.length - 1]);
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(x(samples.length - 1), y(lastV), 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineWidth = 1;
  }
}

/** Panel con los controles del juego. */
export function createHelpPanel(onClose: () => void): HTMLElement {
  const el = document.createElement('section');
  el.className = 'panel side-panel help hidden';
  el.setAttribute('aria-label', 'Controles');
  const groups: [string, [string, string][]][] = [
    ['Cámara', [['Arrastre derecho o central', 'Mover'], ['W A S D / flechas', 'Mover'], ['Rueda', 'Zoom']]],
    ['Construcción', [['Clic / arrastrar', 'Usar la herramienta'], ['Q', 'Inspeccionar'], ['R', 'Calle'], ['B', 'Demoler'], ['F', 'Franja de zonas junto a calles'], ['Ctrl+Z', 'Deshacer'], ['Ctrl+Y', 'Rehacer'], ['Esc', 'Soltar la herramienta']]],
    ['Tiempo', [['Espacio', 'Pausa'], ['1 2 3', 'Velocidad']]],
    ['Gestión', [['G', 'Ágora'], ['L', 'Progreso'], ['P', 'Presupuesto'], ['E', 'Estadísticas'], ['H', 'Controles'], ['Esc', 'Menú de pausa']]],
  ];
  const body = document.createElement('div');
  body.className = 'panel-body';
  body.innerHTML = groups
    .map(
      ([title, rows]) =>
        `<div class="section-title"><span class="kicker">${title}</span></div><div>${rows
          .map(([k, v]) => `<div class="kv"><span>${v}</span><span>${k
            .split(' / ')
            .map((part) => `<kbd>${part}</kbd>`)
            .join(' ')}</span></div>`)
          .join('')}</div>`,
    )
    .join('');
  el.append(panelHead('Ayuda', 'Controles', 'H', onClose), body);
  return el;
}
