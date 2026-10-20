import { SCENARIOS } from '../sim/data/scenarios';
import type { SaveMeta } from '../sim/save';
import type { GameState } from '../sim/state';
import { lockupHTML, symbolSVG } from './brand';
import { type IconName, icon } from './icons';
import { formatMoney } from './menus';
import { SETTING_FIELDS, type Settings, tutorialDone } from './settings';
import { AUTOSAVE_SLOT, MANUAL_SLOTS, deleteSlot, importFromFile, listSlots, loadFromSlot } from './storage';

export interface NewGameSettings {
  name: string;
  size: number;
  seed: number;
  flat: boolean;
  money: number;
  /** Terreno por parcelas (rangos y compra de terreno) o el mapa entero desde el principio. */
  landPlots: boolean;
  /** Modo libre: dinero ilimitado y todo desbloqueado. */
  sandbox: boolean;
  /** Empezar con la guía de primeros pasos. */
  tutorial: boolean;
  /** Eventos y desastres: 0 ninguno … 3 muchos. */
  incidents: number;
  /** Elecciones cada cuatro años. */
  elections: boolean;
}

export interface MenuActions {
  newGame(settings: NewGameSettings): void;
  startScenario(id: string): void;
  load(state: GameState): void;
  /** Devuelve un mensaje de error o null. */
  save(slot: string): string | null;
  exportFile(): void;
  quitToMenu(): void;
  cityName(): string;
  /** Datos reales de la ciudad de demostración que se ve de fondo (null si no la hay). */
  demoInfo(): { population: number; year: number } | null;
  settings(): Settings;
  setSetting(key: keyof Settings, value: number): void;
}

type Screen = 'home' | 'new' | 'load' | 'save' | 'scenarios' | 'settings';

const MAP_SIZES = [
  { value: 64, label: 'Pequeño', detail: '64 × 64' },
  { value: 128, label: 'Mediano', detail: '128 × 128' },
  { value: 192, label: 'Grande', detail: '192 × 192' },
];
const TERRAINS = [
  { value: 0, label: 'Con lagos' },
  { value: 1, label: 'Llano' },
];
const GAME_MODES = [
  { value: 0, label: 'Carrera', detail: 'Dinero limitado, rangos, logros y desbloqueos por población' },
  { value: 1, label: 'Libre', detail: 'Dinero ilimitado y todo desbloqueado desde el principio, sin logros' },
];
const INCIDENT_LEVELS = [
  { value: 0, label: 'Ninguno', detail: 'Sin incendios, averías ni eventos' },
  { value: 1, label: 'Pocos' },
  { value: 2, label: 'Normales', detail: 'Incendios, averías y un par de eventos con decisión al año' },
  { value: 3, label: 'Muchos' },
];
const ELECTION_MODES = [
  { value: 1, label: 'Cada 4 años', detail: 'Si la aprobación no llega al 50 %, pierdes la alcaldía' },
  { value: 0, label: 'Sin elecciones' },
];
const TUTORIAL_MODES = [
  { value: 1, label: 'Con guía', detail: 'Objetivos paso a paso para la primera ciudad' },
  { value: 0, label: 'Sin guía' },
];
const LAND_MODES = [
  { value: 1, label: 'Por parcelas', detail: 'Empiezas con 4 parcelas y compras más al subir de rango' },
  { value: 0, label: 'Mapa entero', detail: 'Todo el terreno es tuyo desde el principio' },
];
const DIFFICULTIES = [
  { value: 100_000, label: 'Fácil' },
  { value: 50_000, label: 'Normal' },
  { value: 25_000, label: 'Difícil' },
];
const SLOT_LABEL: Record<string, string> = { [AUTOSAVE_SLOT]: 'Autoguardado', '1': 'Ranura 1', '2': 'Ranura 2', '3': 'Ranura 3' };
const CAPTION_REFRESH_MS = 500;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const n = (v: number) => v.toLocaleString('es-ES');

function metaLine(meta: SaveMeta): string {
  const saved = new Date(meta.savedAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  return `${meta.date.month}/${meta.date.year} · ${n(meta.population)} hab. · ${meta.sandbox ? 'modo libre' : formatMoney(meta.money)} · guardada el ${saved}`;
}

function item(action: string, label: string, iconName: IconName, opts: { meta?: string; cls?: string; slot?: string } = {}): string {
  return `<button class="menu-item ${opts.cls ?? ''}" data-action="${action}" ${opts.slot ? `data-slot="${opts.slot}"` : ''}>
    <span class="icon-wrap">${icon(iconName, 18)}</span>
    <span class="menu-item-text"><span class="menu-item-label">${label}</span>${opts.meta ? `<span class="menu-item-meta">${esc(opts.meta)}</span>` : ''}</span>
  </button>`;
}

function segmented(group: string, options: { value: number; label: string; detail?: string }[], selected: number, label: string, attrs = ''): string {
  return `<div class="field" ${attrs}><span class="kicker" id="lbl-${group}">${label}</span>
    <div class="segmented" role="radiogroup" aria-labelledby="lbl-${group}" data-group="${group}">
      ${options
        .map(
          (o) =>
            `<button type="button" role="radio" aria-checked="${o.value === selected}" data-value="${o.value}" ${o.detail ? `data-tip="${o.detail}"` : ''}>${o.label}</button>`,
        )
        .join('')}
    </div></div>`;
}

/**
 * Menús de AKROPOLIS:
 * - principal (al abrir el juego o al salir de una partida): logotipo, lema y la ciudad viva de fondo;
 * - pausa (Esc o botón Menú): ventana sobre la partida, que se detiene mientras está abierta.
 */
export class Menu {
  readonly el = document.createElement('div');
  private content = document.createElement('div');
  private caption = document.createElement('div');
  private fileInput = document.createElement('input');
  private mode: 'closed' | 'main' | 'pause' = 'closed';
  private screen: Screen = 'home';
  private message = '';
  private confirmDelete: string | null = null;
  private captionRefresh = 0;

  constructor(private actions: MenuActions) {
    this.el.className = 'menu-backdrop hidden';
    this.caption.className = 'demo-caption';
    this.fileInput.type = 'file';
    this.fileInput.accept = '.json,application/json';
    this.fileInput.hidden = true;
    this.fileInput.onchange = () => this.onImport();
    this.el.append(this.content, this.caption, this.fileInput);
    this.el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const radio = target.closest<HTMLElement>('[role="radio"]');
      if (radio?.parentElement?.dataset.group) {
        for (const r of radio.parentElement.children) r.setAttribute('aria-checked', String(r === radio));
        // En el modo libre sobran el suelo por parcelas y el dinero inicial
        if (radio.parentElement.dataset.group === 'mode') {
          for (const f of this.el.querySelectorAll<HTMLElement>('[data-career]')) f.hidden = radio.dataset.value === '1';
        }
        if (this.screen === 'settings') this.actions.setSetting(radio.parentElement.dataset.group as keyof Settings, Number(radio.dataset.value));
        return;
      }
      const b = target.closest('button');
      if (b?.dataset.action) this.onAction(b.dataset.action, b.dataset.slot);
    });
    this.el.addEventListener('submit', (e) => {
      e.preventDefault();
      this.startNewGame();
    });
  }

  get isOpen(): boolean {
    return this.mode !== 'closed';
  }

  get isPause(): boolean {
    return this.mode === 'pause';
  }

  get isMain(): boolean {
    return this.mode === 'main';
  }

  openMain(): void {
    this.open('main');
  }

  openPause(): void {
    this.open('pause');
  }

  close(): void {
    this.mode = 'closed';
    this.el.classList.add('hidden');
    document.body.classList.remove('attract');
  }

  /** Esc: vuelve a la pantalla anterior; en la pausa, cierra. */
  back(): void {
    if (this.screen !== 'home') this.go('home');
    else if (this.mode === 'pause') this.close();
  }

  /** Refresca el pie con los datos de la ciudad de demostración. */
  tick(): void {
    if (this.mode !== 'main' || performance.now() - this.captionRefresh < CAPTION_REFRESH_MS) return;
    this.captionRefresh = performance.now();
    const demo = this.actions.demoInfo();
    this.caption.hidden = !demo;
    if (demo) {
      const html = `<span class="kicker">Ciudad de demostración · año ${demo.year}</span><span class="value">${n(demo.population)} habitantes</span>`;
      if (this.caption.innerHTML !== html) this.caption.innerHTML = html;
    }
  }

  private open(mode: 'main' | 'pause'): void {
    this.mode = mode;
    this.screen = 'home';
    this.message = '';
    this.confirmDelete = null;
    this.el.classList.remove('hidden');
    this.el.classList.toggle('is-main', mode === 'main');
    this.el.classList.toggle('is-pause', mode === 'pause');
    document.body.classList.toggle('attract', mode === 'main');
    this.caption.hidden = true;
    this.captionRefresh = 0;
    this.render();
  }

  private go(screen: Screen): void {
    this.screen = screen;
    this.message = '';
    this.confirmDelete = null;
    this.render();
  }

  private onAction(action: string, slot?: string): void {
    switch (action) {
      case 'continue-auto':
        return this.loadSlot(AUTOSAVE_SLOT);
      case 'resume':
        return this.close();
      case 'new':
      case 'load':
      case 'save':
      case 'home':
      case 'scenarios':
      case 'settings':
        return this.go(action);
      case 'start-scenario':
        this.message = 'Preparando el escenario…';
        this.render();
        // Dejar que se pinte el mensaje antes de generar el mapa
        setTimeout(() => {
          this.actions.startScenario(slot!);
          this.close();
        }, 30);
        return;
      case 'import':
        this.fileInput.value = '';
        return this.fileInput.click();
      case 'export':
        this.actions.exportFile();
        this.message = 'Partida descargada como archivo.';
        return this.render();
      case 'quit':
        return this.actions.quitToMenu();
      case 'random-seed': {
        const seed = this.el.querySelector<HTMLInputElement>('#new-seed');
        if (seed) seed.value = String(Math.floor(Math.random() * 1_000_000));
        return;
      }
      case 'load-slot':
        return this.loadSlot(slot!);
      case 'delete-slot':
        if (this.confirmDelete !== slot) {
          this.confirmDelete = slot!;
        } else {
          deleteSlot(slot!);
          this.confirmDelete = null;
          this.message = `${SLOT_LABEL[slot!]} borrada.`;
        }
        return this.render();
      case 'save-slot': {
        const error = this.actions.save(slot!);
        this.message = error ?? `Partida guardada en ${SLOT_LABEL[slot!].toLowerCase()}.`;
        return this.render();
      }
    }
  }

  private loadSlot(slot: string): void {
    try {
      this.actions.load(loadFromSlot(slot));
      this.close();
    } catch (e) {
      this.message = (e as Error).message;
      this.render();
    }
  }

  private async onImport(): Promise<void> {
    const file = this.fileInput.files?.[0];
    if (!file) return;
    try {
      this.actions.load(await importFromFile(file));
      this.close();
    } catch (e) {
      this.message = (e as Error).message;
      this.render();
    }
  }

  private startNewGame(): void {
    const value = (group: string) => Number(this.el.querySelector(`[data-group="${group}"] [aria-checked="true"]`)?.getAttribute('data-value'));
    const name = this.el.querySelector<HTMLInputElement>('#new-name')!.value.trim();
    const seed = Number(this.el.querySelector<HTMLInputElement>('#new-seed')!.value);
    this.actions.newGame({
      name: name || 'Ciudad nueva',
      size: value('size'),
      seed: Number.isFinite(seed) && seed > 0 ? Math.floor(seed) : Math.floor(Math.random() * 1_000_000),
      flat: value('terrain') === 1,
      money: value('money'),
      landPlots: value('land') === 1,
      sandbox: value('mode') === 1,
      tutorial: value('tutorial') === 1,
      incidents: value('incidents'),
      elections: value('elections') === 1,
    });
    this.close();
  }

  // ---------- Pantallas ----------

  private render(): void {
    const msg = this.message ? `<p class="menu-message" role="status">${esc(this.message)}</p>` : '';
    const html = this.mode === 'main' ? this.renderMain(msg) : this.renderPause(msg);
    this.content.className = this.mode === 'main' ? 'menu-main' : 'panel menu-modal';
    this.content.innerHTML = html;
    this.content.querySelector<HTMLElement>('.menu-item, input, button')?.focus();
  }

  private renderMain(msg: string): string {
    const brand = lockupHTML({ tagline: true });
    let body = '';
    if (this.screen === 'home') {
      const auto = listSlots([AUTOSAVE_SLOT])[0].meta;
      body = `<div class="menu-list">
        ${auto ? item('continue-auto', `Continuar · ${esc(auto.name)}`, 'play', { meta: metaLine(auto), cls: 'is-primary' }) : ''}
        ${item('new', 'Nueva partida', 'spark', { cls: auto ? '' : 'is-primary' })}
        ${item('scenarios', 'Escenarios', 'flag', { meta: 'Objetivos con plazo' })}
        ${item('load', 'Cargar partida', 'folder')}
        ${item('import', 'Abrir archivo', 'upload')}
        ${item('settings', 'Ajustes', 'sliders')}
      </div>`;
    } else if (this.screen === 'new') {
      body = this.renderNewGame();
    } else if (this.screen === 'scenarios') {
      body = this.renderScenarios();
    } else if (this.screen === 'settings') {
      body = this.renderSettings();
    } else {
      body = this.renderSlots('load');
    }
    return `${brand}<div class="menu-rule"></div>
      <div class="menu-content">${body}${msg}</div>
      <div class="menu-footer"><span>Las partidas se guardan en este navegador. También puedes descargarlas como archivo.</span></div>`;
  }

  private renderPause(msg: string): string {
    const head = `<div class="panel-head">
      <div class="pause-brand">${symbolSVG('light', 28)}<div class="pause-titles"><span class="kicker">En pausa</span><h2 class="title">${esc(this.actions.cityName())}</h2></div></div>
    </div>`;
    let body = '';
    if (this.screen === 'home') {
      body = `<div class="menu-list">
        ${item('resume', 'Seguir jugando', 'play', { cls: 'is-primary' })}
        ${item('save', 'Guardar partida', 'save')}
        ${item('load', 'Cargar partida', 'folder')}
        ${item('export', 'Descargar como archivo', 'download')}
        ${item('settings', 'Ajustes', 'sliders')}
        ${item('quit', 'Salir al menú principal', 'exit', { cls: 'is-danger' })}
      </div>`;
      return `${head}${body}${msg ? `<div class="panel-body">${msg}</div>` : ''}`;
    }
    body = this.screen === 'settings' ? this.renderSettings() : this.renderSlots(this.screen === 'save' ? 'save' : 'load');
    return `${head}<div class="panel-body">${body}${msg}</div>`;
  }

  private renderNewGame(): string {
    return `<div class="menu-heading"><span class="kicker">Nueva partida</span><h2 class="title">Funda tu ciudad</h2></div>
      <form class="menu-form">
        <div class="field"><label class="kicker" for="new-name">Nombre de la ciudad</label><input id="new-name" maxlength="40" value="Ciudad nueva" /></div>
        ${segmented('size', MAP_SIZES, 128, 'Tamaño del mapa')}
        ${segmented('terrain', TERRAINS, 0, 'Terreno')}
        ${segmented('mode', GAME_MODES, 0, 'Modo de juego')}
        ${segmented('tutorial', TUTORIAL_MODES, tutorialDone() ? 0 : 1, 'Primeros pasos')}
        ${segmented('land', LAND_MODES, 1, 'Suelo disponible', 'data-career')}
        ${segmented('money', DIFFICULTIES.map((d) => ({ ...d, detail: `Empiezas con ${formatMoney(d.value)}` })), 50_000, 'Dificultad', 'data-career')}
        ${segmented('incidents', INCIDENT_LEVELS, 2, 'Eventos y desastres')}
        ${segmented('elections', ELECTION_MODES, 1, 'Elecciones', 'data-career')}
        <div class="field"><label class="kicker" for="new-seed">Semilla del mapa</label>
          <span class="seed-row"><input id="new-seed" type="number" min="1" value="${Math.floor(Math.random() * 1_000_000)}" /><button type="button" class="btn" data-action="random-seed">Otra</button></span></div>
        <div class="menu-actions"><button type="button" class="btn" data-action="home">Volver</button><button type="submit" class="btn btn--primary">Fundar la ciudad</button></div>
      </form>`;
  }

  private renderSettings(): string {
    const s = this.actions.settings();
    const fields = SETTING_FIELDS.map((f) => segmented(f.key, f.options, s[f.key], f.label)).join('');
    return `<div class="menu-heading"><span class="kicker">Juego</span><h2 class="title">Ajustes</h2></div>
      <div class="menu-form">${fields}<p class="muted">Se guardan en este navegador y se aplican al momento.</p></div>
      <div class="menu-actions"><button class="btn" data-action="home">Volver</button></div>`;
  }

  private renderScenarios(): string {
    const cards = SCENARIOS.map(
      (s) => `<div class="slot"><div class="slot-info"><span class="slot-name">${s.name}</span>
        <span class="slot-meta">${esc(s.summary)}</span>
        <span class="slot-meta">Plazo: ${s.years} años · ${s.goals.map((g) => g.label).join(' · ')}</span></div>
        <div class="slot-actions"><button class="btn btn--primary" data-action="start-scenario" data-slot="${s.id}">Empezar</button></div></div>`,
    ).join('');
    return `<div class="menu-heading"><span class="kicker">Desafíos</span><h2 class="title">Escenarios</h2></div><div>${cards}</div>
      <div class="menu-actions"><button class="btn" data-action="home">Volver</button></div>`;
  }

  private renderSlots(kind: 'load' | 'save'): string {
    const slots = kind === 'save' ? listSlots(MANUAL_SLOTS) : listSlots();
    const rows = slots
      .map(({ slot, meta }) => {
        let actions = '';
        if (kind === 'save') {
          actions = `<button class="btn ${meta ? '' : 'btn--primary'}" data-action="save-slot" data-slot="${slot}">${meta ? 'Sobrescribir' : 'Guardar aquí'}</button>`;
        } else if (meta) {
          actions = `<button class="btn btn--primary" data-action="load-slot" data-slot="${slot}">Cargar</button>
            <button class="btn btn--danger" data-action="delete-slot" data-slot="${slot}">${this.confirmDelete === slot ? '¿Borrar?' : 'Borrar'}</button>`;
        }
        return `<div class="slot"><div class="slot-info"><span class="slot-name">${meta ? esc(meta.name) : SLOT_LABEL[slot]}</span>
          <span class="slot-meta">${meta ? `${SLOT_LABEL[slot]} · ${metaLine(meta)}` : 'Vacía'}</span></div><div class="slot-actions">${actions}</div></div>`;
      })
      .join('');
    const title = kind === 'save' ? 'Guardar partida' : 'Cargar partida';
    const every = this.actions.settings().autosaveMonths;
    const auto = every === 0 ? 'El autoguardado está desactivado en Ajustes.' : `La partida también se guarda sola ${every === 1 ? 'cada mes' : every === 12 ? 'cada año' : `cada ${every} meses`} en «Autoguardado».`;
    const note = kind === 'save' ? `<p class="muted">${auto}</p>` : '';
    return `<div class="menu-heading"><span class="kicker">Partidas</span><h2 class="title">${title}</h2></div>${note}<div>${rows}</div>
      <div class="menu-actions"><button class="btn" data-action="home">Volver</button></div>`;
  }
}
