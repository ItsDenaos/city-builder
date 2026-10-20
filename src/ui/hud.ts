import { STRIP_DEPTHS, type Tool, sameTool } from '../input/tools';
import type { Overlay } from '../render/renderer';
import type { Command, CommandResult } from '../sim/commands';
import type { GameState } from '../sim/state';
import type { Point, Speed, ZoneType } from '../sim/types';
import { symbolSVG } from './brand';
import { BudgetPanel } from './budget';
import { type IconName, iconEl } from './icons';
import { type TileInfo, describeTile } from './info';
import { MENUS, type MenuCategory, formatMoney, toolItem } from './menus';
import { AgoraPanel } from './agora';
import { ProgressPanel } from './progress';
import { StatsPanel, createHelpPanel } from './stats';
import { TutorialCard } from './tutorial';
import { RANKS } from '../sim/data/progression';
import { tip } from './tooltip';

export interface HudActions {
  setTool(tool: Tool): void;
  setSpeed(speed: Speed): void;
  run(cmd: Command): void;
  openMenu(): void;
  quitToMenu(): void;
  clearSelection(): void;
  undo(): void;
  redo(): void;
  /** Qué se puede deshacer o rehacer ahora. */
  history(): { undo: boolean; redo: boolean };
  getStrip(): number;
  setStrip(depth: number): void;
  /** La guía de primeros pasos terminó o se saltó. */
  tutorialFinished(): void;
  /** Llevar la cámara a una casilla (botón «Ver» de los avisos). */
  focus(tile: Point): void;
}

export type ToastTone = 'info' | 'unlock' | 'warning' | 'negative';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const SPEEDS: { speed: Speed; icon: IconName; label: string; key: string }[] = [
  { speed: 0, icon: 'pause', label: 'Pausa', key: 'Espacio' },
  { speed: 1, icon: 'play', label: 'Velocidad normal', key: '1' },
  { speed: 2, icon: 'fast', label: 'Velocidad rápida', key: '2' },
  { speed: 3, icon: 'fastest', label: 'Velocidad muy rápida', key: '3' },
];
const OVERLAYS: { id: Overlay; label: string }[] = [
  { id: 'none', label: 'Ciudad' },
  { id: 'power', label: 'Electricidad' },
  { id: 'water', label: 'Agua' },
  { id: 'traffic', label: 'Tráfico' },
  { id: 'landValue', label: 'Valor del suelo' },
  { id: 'pollution', label: 'Contaminación' },
  { id: 'crime', label: 'Crimen' },
  { id: 'happiness', label: 'Felicidad' },
  { id: 'police', label: 'Cobertura: policía' },
  { id: 'fire', label: 'Cobertura: bomberos' },
  { id: 'health', label: 'Cobertura: salud' },
  { id: 'education', label: 'Cobertura: educación' },
  { id: 'park', label: 'Cobertura: parques' },
];
const TOAST_ICONS: Record<ToastTone, IconName> = { info: 'info', unlock: 'spark', warning: 'alert', negative: 'alert' };
// Grupos del dock: inspección | trazado | redes y servicios | demolición
const DOCK_BREAKS = new Set(['select', 'zones', 'parks']);
const DEMAND_GAIN = 2.5;
const FLASH_MS = 2500;
const TOAST_MS = 6500;
const INSPECTOR_REFRESH_MS = 250;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

/** Texto sólo si cambió, para no tocar el DOM en cada fotograma. */
function setText(e: HTMLElement, text: string): void {
  if (e.textContent !== text) e.textContent = text;
}

const n = (v: number) => Math.round(v).toLocaleString('es-ES');
const signed = (v: number, f: (x: number) => string = n) => `${v >= 0 ? '+' : '−'}${f(Math.abs(v))}`;

/** Indicador de la barra superior: icono, valor y una línea secundaria. */
class Metric {
  readonly el = el('div', 'metric');
  private value = el('span', 'metric-value');
  private sub = el('span', 'metric-sub');

  constructor(name: IconName, description: string) {
    const text = el('div', 'metric-text');
    text.append(this.value, this.sub);
    this.el.append(iconEl(name, 16), text);
    tip(this.el, description);
  }

  set(value: string, sub: string, tone?: 'warning' | 'negative', subTone?: 'positive' | 'negative'): void {
    setText(this.value, value);
    setText(this.sub, sub);
    this.el.classList.toggle('is-warning', tone === 'warning');
    this.el.classList.toggle('is-negative', tone === 'negative');
    this.sub.classList.toggle('tone-positive', subTone === 'positive');
    this.sub.classList.toggle('tone-negative', subTone === 'negative');
  }

  describe(text: string): void {
    this.el.dataset.tip = text;
  }
}

/**
 * HUD de AKROPOLIS. Cuatro zonas:
 * arriba el estado de la ciudad, abajo la construcción, a la izquierda el contexto (inspector)
 * y a la derecha la gestión (presupuesto, estadísticas, ayuda).
 */
export class Hud {
  /** Vista de datos elegida por el jugador (la herramienta activa puede imponer otra). */
  overlay: Overlay = 'none';

  private city = el('span', 'tb-city');
  private rankName = el('span', 'tb-rank-name');
  private rankFill = el('span', 'tb-rank-fill');
  private money = new Metric('money', 'Dinero de la ciudad y balance del último mes');
  private population = new Metric('population', 'Habitantes y cambio desde el último cierre de mes');
  private happiness = new Metric('happiness', 'Felicidad media de los habitantes');
  private approval = new Metric('vote', 'Aprobación del alcalde y próximas elecciones');
  private jobs = new Metric('jobs', 'Paro: población activa sin empleo');
  private power = new Metric('bolt', 'Electricidad: consumo / producción');
  private water = new Metric('drop', 'Agua: consumo / producción');
  private traffic = new Metric('traffic', 'Vías saturadas y trayecto medio al trabajo');
  private demandBars = new Map<ZoneType, HTMLElement>();
  private date = el('span', 'num');
  private speedButtons = new Map<Speed, HTMLButtonElement>();

  private railButtons: Record<'agora' | 'progress' | 'budget' | 'stats' | 'help', HTMLButtonElement>;
  private agora: AgoraPanel;
  private progress: ProgressPanel;
  private budget: BudgetPanel;
  private stats = new StatsPanel();
  private help: HTMLElement;

  private dockButtons = new Map<string, HTMLButtonElement>();
  private undoButton = el('button', 'dock-btn is-icon');
  private redoButton = el('button', 'dock-btn is-icon');
  private stripShown = -1;
  private sandbox = false;
  private flyout = el('div', 'panel flyout hidden');
  private status = el('div', 'status-chip');
  private overlaySelect = el('select');

  private inspector = el('div', 'panel inspector hidden');
  private tutorial: TutorialCard;
  private hinted: string | null = null;
  private toasts = el('div', 'toasts');
  private gameOver = el('div', 'panel gameover hidden');

  private openCategory: string | null = null;
  private peakPopulation = 0;
  private unlockedCount = -1;
  private activeTool: Tool | null = null;
  private flashText = '';
  private flashUntil = 0;
  private inspectorKey = '';
  private inspectorRefresh = 0;
  private statusKey = '';

  constructor(
    root: HTMLElement,
    private actions: HudActions,
  ) {
    this.budget = new BudgetPanel((cmd) => actions.run(cmd), () => this.toggleBudget(false));
    this.help = createHelpPanel(() => this.toggleHelp(false));
    this.progress = new ProgressPanel(() => this.toggleProgress(false));
    this.agora = new AgoraPanel(() => this.toggleAgora(false), (t) => actions.focus(t));
    this.tutorial = new TutorialCard(() => actions.tutorialFinished());
    const rail = this.buildRail();
    this.railButtons = rail.buttons;
    // A la izquierda, de arriba abajo: la guía (si la hay) y el inspector
    const left = el('div', 'left-stack');
    left.append(this.tutorial.el, this.inspector);
    root.append(
      this.buildTopbar(),
      rail.el,
      this.toasts,
      left,
      this.agora.el,
      this.progress.el,
      this.budget.el,
      this.stats.el,
      this.help,
      this.buildDock(),
      this.buildViews(),
      this.buildGameOver(),
    );
    this.stats.onClose = () => this.toggleStats(false);
  }

  // ---------- Construcción del DOM ----------

  private buildTopbar(): HTMLElement {
    const top = el('header', 'topbar');
    const brand = el('div', 'tb-brand');
    brand.innerHTML = symbolSVG('light', 22, 'AKROPOLIS');
    const cityBlock = el('div', 'tb-city-block');
    const rank = el('div', 'tb-rank');
    const track = el('span', 'tb-rank-track');
    track.append(this.rankFill);
    rank.append(this.rankName, track);
    cityBlock.append(this.city, rank);
    tip(cityBlock, 'Rango de la ciudad y avance hacia el siguiente', 'L');
    cityBlock.onclick = () => this.toggleProgress();
    brand.append(cityBlock);

    const metrics = el('div', 'tb-metrics');
    const demand = el('div', 'demand');
    const bars = el('div', 'demand-bars');
    for (const z of ['R', 'C', 'I'] as const) {
      const item = el('div', 'demand-item');
      const col = el('div', 'demand-col');
      const bar = el('div', `demand-bar demand-bar--${z}`);
      col.append(bar);
      item.append(col, el('span', 'demand-letter', z));
      this.demandBars.set(z, bar);
      bars.append(item);
    }
    demand.append(bars);
    tip(demand, 'Demanda residencial, comercial e industrial');
    this.approval.el.onclick = () => this.toggleAgora();
    this.approval.el.classList.add('is-button');
    metrics.append(this.money.el, this.population.el, this.happiness.el, this.approval.el, this.jobs.el, demand, this.power.el, this.water.el, this.traffic.el);

    const time = el('div', 'tb-time');
    const date = el('div', 'tb-date');
    date.append(iconEl('calendar', 16), this.date);
    const speeds = el('div', 'segmented');
    speeds.setAttribute('role', 'radiogroup');
    speeds.setAttribute('aria-label', 'Velocidad de la simulación');
    for (const sp of SPEEDS) {
      const b = el('button');
      b.append(iconEl(sp.icon, 14));
      b.setAttribute('role', 'radio');
      tip(b, sp.label, sp.key);
      b.setAttribute('aria-label', sp.label);
      b.onclick = () => this.actions.setSpeed(sp.speed);
      this.speedButtons.set(sp.speed, b);
      speeds.append(b);
    }
    time.append(date, speeds);
    top.append(brand, metrics, time);
    return top;
  }

  private buildRail() {
    const rail = el('nav', 'panel rail');
    rail.setAttribute('aria-label', 'Gestión de la ciudad');
    const button = (name: IconName, label: string, key: string, onclick: () => void) => {
      const b = el('button', 'icon-btn');
      b.append(iconEl(name, 18));
      tip(b, label, key);
      b.onclick = onclick;
      return b;
    };
    const buttons = {
      agora: button('agora', 'Ágora: vecinos, peticiones y elecciones', 'G', () => this.toggleAgora()),
      progress: button('flag', 'Progreso: rango, terreno y logros', 'L', () => this.toggleProgress()),
      budget: button('budget', 'Presupuesto', 'P', () => this.toggleBudget()),
      stats: button('stats', 'Estadísticas', 'E', () => this.toggleStats()),
      help: button('help', 'Controles', 'H', () => this.toggleHelp()),
    };
    rail.append(button('menu', 'Menú: guardar, cargar o salir', 'Esc', () => this.actions.openMenu()), el('div', 'rail-sep'), buttons.agora, buttons.progress, buttons.budget, buttons.stats, buttons.help);
    return { el: rail, buttons };
  }

  private buildDock(): HTMLElement {
    const dock = el('div', 'dock');
    const bar = el('nav', 'panel dock-bar');
    bar.setAttribute('aria-label', 'Construcción');
    for (const c of MENUS) {
      const b = el('button', 'dock-btn');
      b.append(iconEl(c.icon, 20), el('span', '', c.label));
      tip(b, c.items.length === 1 ? c.label : `${c.label}: ${c.items.length} herramientas`, c.key);
      b.onclick = () => this.onCategory(c);
      this.dockButtons.set(c.id, b);
      bar.append(b);
      if (DOCK_BREAKS.has(c.id)) bar.append(el('div', 'dock-sep'));
    }
    const history = (b: HTMLButtonElement, name: IconName, label: string, key: string, onclick: () => void) => {
      b.append(iconEl(name, 18));
      b.setAttribute('aria-label', label);
      tip(b, label, key);
      b.onclick = onclick;
    };
    history(this.undoButton, 'undo', 'Deshacer', 'Ctrl+Z', () => this.actions.undo());
    history(this.redoButton, 'redo', 'Rehacer', 'Ctrl+Y', () => this.actions.redo());
    bar.append(el('div', 'dock-sep'), this.undoButton, this.redoButton);
    dock.append(this.status, this.flyout, bar);
    return dock;
  }

  private buildViews(): HTMLElement {
    const views = el('div', 'panel views');
    this.overlaySelect.id = 'view-select';
    this.overlaySelect.setAttribute('aria-label', 'Vista de datos');
    for (const o of OVERLAYS) {
      const opt = el('option', '', o.label);
      opt.value = o.id;
      this.overlaySelect.append(opt);
    }
    this.overlaySelect.onchange = () => {
      this.overlay = this.overlaySelect.value as Overlay;
      this.overlaySelect.blur(); // que las teclas vuelvan al juego
    };
    const label = iconEl('layers', 16);
    tip(views, 'Vista de datos sobre el mapa');
    views.append(label, this.overlaySelect);
    return views;
  }

  private buildGameOver(): HTMLElement {
    const head = el('div', 'panel-head');
    const titles = el('div');
    titles.append(el('span', 'kicker tone-negative', 'Bancarrota'), el('h2', 'title', 'La ciudad ha quebrado'));
    head.append(titles);
    const body = el('div', 'panel-body');
    body.append(el('p', '', 'Ha pasado demasiado tiempo en números rojos y los acreedores se han quedado con la ciudad.'));
    const restart = el('button', 'btn btn--primary', 'Volver al menú principal');
    restart.onclick = () => this.actions.quitToMenu();
    body.append(restart);
    this.gameOver.setAttribute('role', 'alertdialog');
    this.gameOver.append(head, body);
    return this.gameOver;
  }

  // ---------- Herramientas ----------

  private onCategory(c: MenuCategory): void {
    if (c.items.length === 1) {
      this.openCategory = null;
      this.actions.setTool(c.items[0].tool);
    } else {
      this.openCategory = this.openCategory === c.id ? null : c.id;
    }
    this.renderDock();
  }

  private renderDock(): void {
    for (const [id, b] of this.dockButtons) {
      const c = MENUS.find((m) => m.id === id)!;
      b.classList.toggle('is-open', this.openCategory === id);
      b.classList.toggle('is-active', !!this.activeTool && c.items.some((i) => sameTool(i.tool, this.activeTool!)));
    }
    const c = MENUS.find((m) => m.id === this.openCategory);
    this.flyout.classList.toggle('hidden', !c);
    if (!c) return;
    const head = el('div', 'flyout-head');
    head.append(el('span', 'kicker', c.label));
    const tools = el('div', 'flyout-tools');
    for (const item of c.items) {
      const b = el('button', 'tool');
      const locked = this.peakPopulation < item.unlockAtPopulation;
      if (locked) b.append(iconEl('lock', 14));
      else if (item.color) {
        const sw = el('span', 'swatch');
        sw.style.background = item.color;
        b.append(sw);
      } else if (item.icon) b.append(iconEl(item.icon, 14));
      b.append(el('span', 'tool-name', item.label));
      if (item.detail) b.append(el('span', 'tool-cost', item.detail));
      if (item.cost) b.append(el('span', 'tool-cost', item.cost));
      b.disabled = locked;
      if (locked) tip(b, `Se desbloquea con ${n(item.unlockAtPopulation)} habitantes`);
      if (this.activeTool && sameTool(item.tool, this.activeTool)) b.classList.add('is-active');
      b.onclick = () => this.actions.setTool(item.tool);
      tools.append(b);
    }
    this.flyout.replaceChildren(head, tools);
    if (c.id === 'zones') this.flyout.append(this.stripControl());
  }

  /** Pie del menú de zonas: zonificar el rectángulo entero o solo la franja junto a las calles. */
  private stripControl(): HTMLElement {
    const foot = el('div', 'flyout-foot');
    const seg = el('div', 'segmented');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', 'Franja de zonificación junto a las calles');
    const current = this.actions.getStrip();
    for (const d of STRIP_DEPTHS) {
      const b = el('button', '', d ? String(d) : 'Todo');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(d === current));
      tip(b, d ? `Solo las casillas a ${d} o menos de una calle` : 'El rectángulo entero, haya calle o no', 'F');
      b.onclick = () => {
        this.actions.setStrip(d);
        this.renderDock();
      };
      seg.append(b);
    }
    this.stripShown = current;
    foot.append(iconEl('strip', 14), el('span', 'kicker', 'Franja junto a calles'), seg);
    return foot;
  }

  // ---------- Actualización por fotograma ----------

  update(state: GameState, tool: Tool, preview: CommandResult | null, selected: Point | null, overlay: Overlay): void {
    const { economy, stats: st, utilities, time: t } = state;
    this.sandbox = state.sandbox;
    setText(this.city, state.name);
    const pr = state.progress;
    const rank = RANKS[pr.rank];
    const next = RANKS[pr.rank + 1];
    setText(this.rankName, rank.name);
    this.rankFill.style.width = next ? `${Math.min(100, ((pr.peakPopulation - rank.population) / (next.population - rank.population)) * 100)}%` : '100%';
    this.dockButtons.get('land')?.classList.toggle('hidden', !state.land);

    const net = economy.lastMonth?.net;
    if (state.sandbox) this.money.set('Ilimitado', 'modo libre');
    else {
      this.money.set(
        formatMoney(economy.money),
        net === undefined ? 'sin cierre de mes' : `${signed(net, formatMoney)} / mes`,
        economy.money < 0 ? 'negative' : undefined,
        net === undefined ? undefined : net >= 0 ? 'positive' : 'negative',
      );
    }
    const h = this.actions.history();
    this.undoButton.disabled = !h.undo;
    this.redoButton.disabled = !h.redo;
    const last = state.history.at(-1);
    const delta = last ? st.population - last.population : 0;
    this.population.set(n(st.population), last ? `${signed(delta)} este mes` : 'habitantes');
    this.happiness.set(`${Math.round(st.happiness)} %`, 'felicidad', st.population > 0 && st.happiness < 40 ? 'warning' : undefined);
    const ag = state.agora;
    const appr = Math.round(ag.approval);
    this.approval.set(`${appr} %`, ag.elections ? `elecciones ${ag.nextElection}` : 'aprobación', ag.elections && appr < 50 ? 'negative' : ag.elections && appr < 55 ? 'warning' : undefined);
    const unemployment = st.workforce ? ((st.workforce - st.employed) / st.workforce) * 100 : 0;
    this.jobs.set(`${Math.round(unemployment)} %`, 'paro', unemployment > 15 ? 'warning' : undefined);
    this.jobs.describe(`Paro: ${n(st.workforce - st.employed)} de ${n(st.workforce)} personas en edad de trabajar no tienen empleo`);
    this.power.set(`${n(utilities.power.demand)} / ${n(utilities.power.production)}`, 'MW', utilities.power.demand > utilities.power.production ? 'negative' : undefined);
    this.water.set(`${n(utilities.water.demand)} / ${n(utilities.water.production)}`, 'agua', utilities.water.demand > utilities.water.production ? 'negative' : undefined);
    const tr = st.traffic;
    this.traffic.set(`${Math.round(tr.congestedShare * 100)} %`, `trayecto ${n(tr.avgCommute)}`, tr.congestedShare > 0.1 ? 'warning' : undefined);
    for (const [z, bar] of this.demandBars) {
      // Hacia arriba con demanda positiva, hacia abajo con negativa. La demanda habitual ronda 0,1-0,3:
      // se amplía para que se lea, y a partir de 0,4 la media barra queda llena.
      const d = st.demand[z];
      const h = Math.min(1, Math.abs(d) * DEMAND_GAIN) * 50;
      bar.style.height = `${h}%`;
      bar.style.bottom = d >= 0 ? '50%' : `${50 - h}%`;
      bar.style.opacity = d >= 0 ? '1' : '0.45';
    }
    setText(this.date, `${t.day} ${MONTHS[t.month - 1]} ${t.year}`);
    for (const [s, b] of this.speedButtons) b.setAttribute('aria-checked', String(s === t.speed));
    if (this.overlaySelect.value !== overlay) this.overlaySelect.value = overlay;
    this.gameOver.classList.toggle('hidden', !economy.bankrupt);
    this.budget.update(state);
    this.stats.update(state);
    this.progress.update(state);
    this.agora.update(state);

    // Rehacer el dock solo cuando cambia la herramienta o se desbloquea algo
    const toolChanged = !this.activeTool || !sameTool(tool, this.activeTool);
    this.peakPopulation = state.sandbox ? Infinity : state.progress.peakPopulation;
    const unlocked = MENUS.reduce((k, c) => k + c.items.filter((i) => i.unlockAtPopulation <= this.peakPopulation).length, 0);
    const stripChanged = this.openCategory === 'zones' && this.stripShown !== this.actions.getStrip();
    if (toolChanged || unlocked !== this.unlockedCount || stripChanged) {
      this.activeTool = tool;
      this.unlockedCount = unlocked;
      this.renderDock();
    }

    this.updateStatus(tool, preview);
    this.updateInspector(state, selected);
    this.tutorial.update(state);
    if (this.tutorial.highlight !== this.hinted) {
      this.dockButtons.get(this.hinted ?? '')?.classList.remove('is-hint');
      this.hinted = this.tutorial.highlight;
      this.dockButtons.get(this.hinted ?? '')?.classList.add('is-hint');
    }
  }

  private updateStatus(tool: Tool, preview: CommandResult | null): void {
    const flashing = performance.now() < this.flashUntil;
    const item = toolItem(tool);
    let detail = '';
    let error = false;
    if (flashing) {
      detail = this.flashText;
      error = true;
    } else if (preview) {
      error = !preview.ok;
      // En el modo libre no se cobra nada
      const cost = preview.cost && !this.sandbox ? `Coste ${formatMoney(preview.cost)}` : '';
      detail = preview.ok ? cost : (preview.reason ?? '');
    }
    // Con una zona, la etiqueta dice también la forma (franja junto a calles o rectángulo)
    const strip = this.actions.getStrip();
    const label = tool.kind === 'zone' ? `${item?.label ?? ''} · ${strip ? `franja de ${strip}` : 'rectángulo'}` : (item?.label ?? '');
    const key = `${label}|${detail}|${error}`;
    if (key === this.statusKey) return;
    this.statusKey = key;
    this.status.classList.toggle('is-error', error);
    // Con la herramienta de inspeccionar y nada que decir, el chip desaparece
    if (tool.kind === 'select' && !detail) {
      this.status.replaceChildren();
      return;
    }
    const parts: Node[] = [];
    if (item?.icon) parts.push(iconEl(item.icon, 14));
    parts.push(el('span', '', label));
    if (detail) parts.push(el('span', 'sep'), el('span', '', detail));
    this.status.replaceChildren(...parts);
  }

  private updateInspector(state: GameState, selected: Point | null): void {
    const now = performance.now();
    if (now - this.inspectorRefresh < INSPECTOR_REFRESH_MS && selected) return;
    this.inspectorRefresh = now;
    const info = selected ? describeTile(state, selected) : null;
    const key = info ? JSON.stringify([selected, info.kicker, info.title, info.rows, info.meters.map((m) => Math.round(m.value))]) : '';
    if (key === this.inspectorKey) return;
    this.inspectorKey = key;
    this.inspector.classList.toggle('hidden', !info);
    if (info && selected) this.renderInspector(info, selected);
  }

  private renderInspector(info: TileInfo, p: Point): void {
    const head = el('div', 'panel-head');
    const titles = el('div');
    titles.append(el('span', 'kicker', info.kicker), el('h2', 'title', info.title), el('span', 'coord', `Casilla ${p.x}, ${p.y}`));
    const close = el('button', 'icon-btn');
    close.append(iconEl('close', 16));
    tip(close, 'Cerrar', 'Esc');
    close.onclick = () => this.actions.clearSelection();
    head.append(titles, close);

    const body = el('div', 'panel-body');
    if (info.rows.length) {
      const rows = el('div');
      for (const r of info.rows) {
        const row = el('div', 'kv');
        const value = el('span', r.tone ? `tone-${r.tone}` : '', r.value);
        row.append(el('span', '', r.label), value);
        rows.append(row);
      }
      body.append(rows);
    }
    if (info.meters.length) {
      const meters = el('div', 'inspector-meters');
      meters.append(el('span', 'kicker', 'Entorno'));
      for (const m of info.meters) {
        const v = Math.max(0, Math.min(100, m.value));
        const good = m.higherIsBetter ? v : 100 - v;
        const row = el('div', 'meter');
        const track = el('div', 'meter-track');
        const fill = el('div', 'meter-fill');
        fill.style.width = `${v}%`;
        // Color por lo bueno o malo que es el valor, no por su tamaño
        fill.style.background = good >= 60 ? 'var(--ui-positive)' : good >= 35 ? 'var(--ui-warning)' : 'var(--ui-negative)';
        track.append(fill);
        row.append(el('span', '', m.label), track, el('span', '', String(Math.round(v))));
        meters.append(row);
      }
      body.append(meters);
    }
    this.inspector.replaceChildren(head, body);
  }

  // ---------- Paneles de gestión: ocupan el mismo sitio, abrir uno cierra los demás ----------

  toggleAgora(force?: boolean): void {
    const open = force ?? !this.agora.open;
    this.closeSidePanels();
    this.agora.toggle(open);
    this.railButtons.agora.classList.toggle('is-active', open);
  }

  toggleProgress(force?: boolean): void {
    const open = force ?? !this.progress.open;
    this.closeSidePanels();
    this.progress.toggle(open);
    this.railButtons.progress.classList.toggle('is-active', open);
  }

  toggleBudget(force?: boolean): void {
    const open = force ?? !this.budget.open;
    this.closeSidePanels();
    this.budget.toggle(open);
    this.railButtons.budget.classList.toggle('is-active', open);
  }

  toggleStats(force?: boolean): void {
    const open = force ?? !this.stats.open;
    this.closeSidePanels();
    this.stats.toggle(open);
    this.railButtons.stats.classList.toggle('is-active', open);
  }

  toggleHelp(force?: boolean): void {
    const open = force ?? this.help.classList.contains('hidden');
    this.closeSidePanels();
    this.help.classList.toggle('hidden', !open);
    this.railButtons.help.classList.toggle('is-active', open);
  }

  private closeSidePanels(): void {
    this.agora.toggle(false);
    this.progress.toggle(false);
    this.budget.toggle(false);
    this.stats.toggle(false);
    this.help.classList.add('hidden');
    for (const b of Object.values(this.railButtons)) b.classList.remove('is-active');
  }

  /** Al cambiar de partida: cerrar paneles y olvidar avisos de la anterior. */
  reset(): void {
    this.closeSidePanels();
    this.toasts.replaceChildren();
    this.flashUntil = 0;
    this.inspectorKey = '';
    this.openCategory = null;
    this.renderDock();
  }

  /** Mensaje temporal en el chip de herramienta (errores de comandos). */
  flash(text: string): void {
    this.flashText = text;
    this.flashUntil = performance.now() + FLASH_MS;
  }

  notify(text: string, tone: ToastTone = 'info', at?: Point): void {
    // No repetir un aviso que sigue en pantalla (los consejos mensuales suelen repetirse)
    if ([...this.toasts.children].some((c) => c.firstElementChild?.nextElementSibling?.textContent === text)) return;
    const toast = el('div', `toast toast--${tone}`);
    toast.setAttribute('role', tone === 'negative' ? 'alert' : 'status');
    toast.append(iconEl(TOAST_ICONS[tone], 15), el('span', '', text));
    if (at) {
      const go = el('button', 'toast-action', 'Ver');
      go.onclick = () => this.actions.focus(at);
      toast.append(go);
    }
    this.toasts.prepend(toast);
    while (this.toasts.children.length > 4) this.toasts.lastChild!.remove();
    setTimeout(() => {
      toast.classList.add('is-leaving');
      setTimeout(() => toast.remove(), 320);
    }, TOAST_MS);
  }
}
