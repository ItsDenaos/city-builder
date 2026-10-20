import './styles/base.css';
import './styles/components.css';
import './styles/hud.css';
import './styles/panels.css';
import './styles/menu.css';
import { InputController } from './input/controller';
import { SELECT_TOOL, STRIP_DEPTHS, type Tool, type ToolOptions, toolCommand, toolOverlay, toolPreviewTiles } from './input/tools';
import { Camera } from './render/camera';
import { Renderer, type ViewState } from './render/renderer';
import { AutoPlayer } from './sim/autoplayer';
import { type Command, type CommandResult, applyCommand, previewCommand } from './sim/commands';
import { MS_PER_DAY } from './sim/config';
import { getIncident } from './sim/data/incidents';
import { RANKS } from './sim/data/progression';
import { getScenario } from './sim/data/scenarios';
import { landCenter } from './sim/land';
import { createScenario } from './sim/scenarios';
import { tick } from './sim/simulation';
import { type GameState, createGame, inBounds, tileIndex } from './sim/state';
import { UndoHistory } from './sim/undo';
import { roadStrip } from './sim/zoning';
import type { Point, SimEvent, Speed } from './sim/types';
import { applyTheme } from './theme';
import { Hud } from './ui/hud';
import { rankEmblemSVG } from './ui/brand';
import { commandLabel, formatMoney } from './ui/menus';
import { Menu } from './ui/menu';
import { Modal } from './ui/modal';
import { applySettings, loadSettings, markTutorialDone, saveSettings } from './ui/settings';
import { AUTOSAVE_SLOT, exportToFile, saveToSlot } from './ui/storage';
import { installTooltips } from './ui/tooltip';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** Ciudad de demostración del menú principal: siempre el mismo mapa, con lagos. */
const DEMO_SEED = 42;
/** Tiempo por fotograma que puede usar la demostración para simular (ms) y días como máximo. */
const DEMO_BUDGET_MS = 5;
const DEMO_MAX_DAYS_PER_FRAME = 12;

applyTheme();
const settings = loadSettings();
applySettings(settings);
const uiRoot = document.getElementById('ui')!;
installTooltips(uiRoot);

// ?seed=123 permite ver otro mapa de fondo al depurar
const seedParam = Number(new URLSearchParams(location.search).get('seed'));
let state: GameState = createGame({ seed: seedParam || DEMO_SEED, name: 'Demostración' });
/** Mientras hay demostración, un jugador automático levanta la ciudad detrás del menú principal. */
let demo: AutoPlayer | null = new AutoPlayer(state);

const canvas = document.getElementById('game') as HTMLCanvasElement;
const camera = new Camera(window.innerWidth, window.innerHeight);
const renderer = new Renderer(canvas);

let tool: Tool = SELECT_TOOL;
let selected: Point | null = null;
let speedBeforePause: Speed = 1;
const toolOptions: ToolOptions = { strip: 3 };
const history = new UndoHistory();

function run(cmd: Command): CommandResult {
  const result = demo ? applyCommand(state, cmd) : history.run(state, cmd);
  if (!result.ok && result.reason) hud.flash(result.reason);
  if (result.ok && cmd.type === 'buyPlot') hud.notify(`Parcela comprada por ${formatMoney(result.cost)}`, 'unlock');
  return result;
}

function undo(): void {
  const r = history.undo(state);
  if (!r.ok) return hud.flash(r.reason);
  const partial = r.restored < r.total ? ` (${r.restored} de ${r.total} casillas: el resto ya ha cambiado)` : '';
  hud.notify(`Deshecho: ${commandLabel(r.cmd)}${partial}${r.refund ? ` · ${formatMoney(r.refund)} devueltos` : ''}`);
}

function redo(): void {
  const r = history.redo(state);
  if (!r.ok) return hud.flash(r.reason);
  hud.notify(`Rehecho: ${commandLabel(r.cmd)}${r.result.cost && !state.sandbox ? ` · ${formatMoney(r.result.cost)}` : ''}`);
}

function cycleStrip(): void {
  const k = STRIP_DEPTHS.indexOf(toolOptions.strip as (typeof STRIP_DEPTHS)[number]);
  toolOptions.strip = STRIP_DEPTHS[(k + 1) % STRIP_DEPTHS.length];
  hud.notify(toolOptions.strip ? `Zonas en franja de ${toolOptions.strip} junto a las calles` : 'Zonas en el rectángulo entero');
}

function setSpeed(speed: Speed): void {
  if (speed !== 0) speedBeforePause = speed;
  run({ type: 'setSpeed', speed });
}

/** Cambia la partida en juego (nueva o cargada). */
function setState(next: GameState): void {
  state = next;
  demo = null;
  tool = SELECT_TOOL;
  selected = null;
  history.clear();
  decisionShown = false;
  camera.zoom = 2;
  const c = landCenter(state);
  camera.centerOn(c.x, c.y);
  if (state.time.speed === 0 && !state.economy.bankrupt) state.time.speed = 1;
  hud.reset();
  Object.assign(window, { game: { state, camera } });
}

function autosave(): void {
  if (demo || state.economy.bankrupt) return;
  const error = saveToSlot(AUTOSAVE_SLOT, state);
  if (error) hud.notify(error, 'warning');
}

const hud = new Hud(uiRoot, {
  setTool: (t) => (tool = t),
  setSpeed,
  run,
  openMenu: () => menu.openPause(),
  quitToMenu,
  clearSelection: () => (selected = null),
  undo,
  redo,
  history: () => ({ undo: history.canUndo, redo: history.canRedo }),
  getStrip: () => toolOptions.strip,
  setStrip: (depth) => (toolOptions.strip = depth),
  tutorialFinished: markTutorialDone,
  focus: (t) => {
    camera.centerOn(t.x + 0.5, t.y + 0.5);
    selected = t;
  },
});

const modal = new Modal();

const menu = new Menu({
  newGame: (s) =>
    setState(
      createGame({
        name: s.name,
        width: s.size,
        height: s.size,
        seed: s.seed,
        flat: s.flat,
        money: s.money,
        landPlots: s.landPlots,
        sandbox: s.sandbox,
        tutorial: s.tutorial,
        incidents: s.incidents,
        elections: s.elections && !s.sandbox,
      }),
    ),
  startScenario: (id) => setState(createScenario(id)),
  load: setState,
  save: (slot) => saveToSlot(slot, state),
  exportFile: () => exportToFile(state),
  quitToMenu,
  cityName: () => state.name,
  demoInfo: () => (demo ? { population: state.stats.population, year: state.time.year } : null),
  settings: () => settings,
  setSetting: (key, value) => {
    settings[key] = value;
    saveSettings(settings);
    applySettings(settings);
  },
});
uiRoot.append(modal.el, menu.el);

function quitToMenu(): void {
  autosave();
  menu.openMain();
}

const input = new InputController(canvas, camera, {
  getTool: () => tool,
  setTool: (t) => (tool = t),
  buildCommand: (start, end) => toolCommand(tool, start, end, toolOptions),
  command: (cmd) => run(cmd),
  undo,
  redo,
  cycleStrip,
  select: (t) => (selected = inBounds(state.map, t.x, t.y) ? t : null),
  togglePause: () => setSpeed(state.time.speed === 0 ? speedBeforePause : 0),
  setSpeed,
  toggleBudget: () => hud.toggleBudget(),
  toggleStats: () => hud.toggleStats(),
  toggleHelp: () => hud.toggleHelp(),
  toggleProgress: () => hud.toggleProgress(),
  toggleAgora: () => hud.toggleAgora(),
  blocked: () => menu.isOpen || modal.isOpen,
  edgeScroll: () => settings.edgeScroll === 1,
  // Esc: atrás en el menú → suelta la herramienta → quita la selección → abre el menú de pausa
  cancelTool: () => {
    if (modal.isOpen) modal.dismiss();
    else if (menu.isOpen) menu.back();
    else if (tool.kind !== 'select') tool = SELECT_TOOL;
    else if (selected) selected = null;
    else menu.openPause();
  },
});

/** Celebración de un nuevo rango: emblema de la escalinata, subvención, desbloqueos y siguiente meta. */
function celebrateRank(rank: number, grant: number, unlocks: string[]): void {
  const r = RANKS[rank];
  const next = RANKS[rank + 1];
  const rows = [
    grant ? `<div class="kv"><span>Subvención</span><span class="tone-positive">+${formatMoney(grant)}</span></div>` : '',
    unlocks.length ? `<div class="kv"><span>Desbloqueado</span><span>${unlocks.join(', ')}</span></div>` : '',
    state.land && RANKS[rank].maxPlots > RANKS[rank - 1].maxPlots
      ? `<div class="kv"><span>Terreno</span><span>Hasta ${RANKS[rank].maxPlots === Infinity ? 'todas las' : RANKS[rank].maxPlots} parcelas</span></div>`
      : '',
    next ? `<div class="kv"><span>Siguiente meta</span><span>${next.name} · ${next.population.toLocaleString('es-ES')} hab.</span></div>` : '',
  ].join('');
  modal.show({
    kicker: 'Nuevo rango',
    title: RANKS[rank].name,
    emblem: rankEmblemSVG(rank, RANKS.length, 132),
    body: `<p>${esc(state.name)} ya es ${r.article} ${r.id === 'akropolis' ? r.name : r.name.toLowerCase()}.</p>${rows}`,
    actions: [{ label: 'Continuar', primary: true }],
  });
}

/** Un evento espera decisión: ventana con sus opciones (la partida queda detenida hasta elegir). */
let decisionShown = false;
function showDecision(): void {
  const pending = state.incidents.pending;
  if (!pending || decisionShown || demo) return;
  const def = getIncident(pending.id);
  if (!def) {
    state.incidents.pending = null;
    return;
  }
  decisionShown = true;
  modal.show({
    kicker: def.kicker,
    title: def.title,
    tone: def.kicker === 'Desastre' || def.kicker === 'Avería' ? 'negative' : 'gold',
    body: `<p>${def.body(state, pending.data)}</p>`,
    dismissable: false,
    actions: [],
    choices: def.choices.map((c, k) => {
      const cost = c.cost?.(state, pending.data) ?? 0;
      const check = previewCommand(state, { type: 'decide', choice: k });
      return {
        label: c.label,
        detail: c.detail(state, pending.data),
        cost: cost && !state.sandbox ? formatMoney(cost) : '',
        blocked: check.ok ? undefined : check.reason,
        onClick: () => {
          decisionShown = false;
          const r = run({ type: 'decide', choice: k });
          if (r.ok && r.message) hud.notify(r.message, 'warning');
        },
      };
    }),
  });
}

function electionResult(won: boolean, share: number, year: number): void {
  modal.show({
    kicker: `Elecciones de ${year}`,
    title: won ? 'Reelegido' : 'Has perdido la alcaldía',
    tone: won ? 'gold' : 'negative',
    body: won
      ? `<p>Los vecinos de ${esc(state.name)} renuevan su confianza con un ${share} % de los votos. Próximas elecciones en ${year + 4}.</p>`
      : `<p>Con un ${share} % de los votos, la oposición gana el ayuntamiento de ${esc(state.name)}. Puedes seguir jugando con esta ciudad, ya sin elecciones.</p>`,
    actions: won ? [{ label: 'Continuar', primary: true }] : [{ label: 'Seguir jugando', primary: true }, { label: 'Menú principal', onClick: quitToMenu }],
  });
}

function scenarioEnded(id: string, won: boolean): void {
  const def = getScenario(id);
  modal.show({
    kicker: won ? 'Escenario completado' : 'Se acabó el plazo',
    title: def?.name ?? 'Escenario',
    tone: won ? 'gold' : 'negative',
    body: won ? '<p>Has cumplido todos los objetivos. Puedes seguir jugando con esta ciudad.</p>' : '<p>No se cumplieron los objetivos a tiempo. Puedes seguir jugando sin plazo o volver al menú.</p>',
    actions: [{ label: 'Seguir jugando', primary: true }, { label: 'Menú principal', onClick: quitToMenu }],
  });
}

function onEvents(events: SimEvent[]): void {
  // Los desbloqueos de un nuevo rango ya salen en su ventana: no repetirlos como avisos
  const rankUp = events.some((e) => e.type === 'rankUp');
  for (const e of events) {
    if (e.type === 'newYear') hud.notify(`Comienza el año ${e.year}`);
    else if (e.type === 'rankUp') celebrateRank(e.rank, e.grant, e.unlocks);
    else if (e.type === 'achievement') hud.notify(`Logro: ${e.name}`, 'unlock');
    else if (e.type === 'scenarioEnd') scenarioEnded(e.id, e.won);
    else if (e.type === 'decision') showDecision();
    else if (e.type === 'fire') {
      hud.notify(e.covered ? 'Incendio: los bomberos ya van de camino' : 'Incendio sin cobertura de bomberos: se propagará', 'negative', { x: e.x, y: e.y });
    } else if (e.type === 'fireOver') {
      hud.notify(e.destroyed ? `Incendio apagado: ${e.destroyed} ${e.destroyed === 1 ? 'edificio destruido' : 'edificios destruidos'}` : 'Incendio apagado sin daños', e.destroyed ? 'warning' : 'info');
    } else if (e.type === 'effectEnded') hud.notify(`Termina: ${e.label}`);
    else if (e.type === 'repaired') hud.notify(`${e.name}: reparada`);
    else if (e.type === 'petitionNew') hud.notify(`Nueva petición vecinal: ${e.title}`, 'info', { x: e.x, y: e.y });
    else if (e.type === 'petition') hud.notify(e.done ? `Petición cumplida: ${e.title}` : `Petición sin cumplir: ${e.title}`, e.done ? 'unlock' : 'warning');
    else if (e.type === 'electionSoon') {
      hud.notify(`${e.months === 1 ? 'Elecciones el mes que viene' : 'Quedan 6 meses para las elecciones'}: aprobación del ${e.approval} %`, e.approval < 50 ? 'warning' : 'info');
    } else if (e.type === 'election') electionResult(e.won, e.share, e.year);
    else if (e.type === 'unlock' && !rankUp) hud.notify(`Desbloqueado: ${e.name} (${e.population.toLocaleString('es-ES')} habitantes)`, 'unlock');
    else if (e.type === 'advice') {
      // Los avisos graves salen aunque los consejos estén desactivados
      const serious = /rojos|bancarrota|pierdes/i.test(e.text);
      if (serious || settings.advisor) hud.notify(e.text, serious ? 'warning' : 'info');
    }
    else if (e.type === 'loanPaidOff') hud.notify(`Préstamo de ${e.amount.toLocaleString('es-ES')} $ pagado por completo`);
    else if (e.type === 'bankrupt') hud.notify('La ciudad ha quebrado.', 'negative');
    else if (e.type === 'newMonth' && settings.autosaveMonths && (e.month - 1) % settings.autosaveMonths === 0) autosave();
  }
}

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.resize(w, h, window.devicePixelRatio || 1);
  camera.resize(w, h);
}
window.addEventListener('resize', resize);
resize();

/** La demostración avanza dentro de un presupuesto de tiempo y la cámara la recorre despacio. */
function runDemo(now: number): void {
  if (!demo) return;
  const start = performance.now();
  for (let d = 0; d < DEMO_MAX_DAYS_PER_FRAME && performance.now() - start < DEMO_BUDGET_MS; d++) demo.run(1);
  const c = demo.center;
  const a = settings.reducedMotion ? 0 : now / 1000 / 40; // una vuelta cada ~4 minutos
  camera.zoom = 1.35;
  // Encuadre desplazado a la derecha: a la izquierda está el texto del menú
  camera.centerOn(c.x - camera.viewWidth / camera.scale / 6 + Math.cos(a) * 7, c.y + Math.sin(a) * 5);
}

// Bucle: la simulación avanza en pasos fijos (1 día) y el dibujo va a la velocidad del navegador.
// Con un menú abierto la partida se detiene.
let last = performance.now();
let accumulator = 0;

function frame(now: number): void {
  const dt = Math.min(now - last, 250);
  last = now;

  if (menu.isMain) runDemo(now);
  // Una decisión pendiente (por ejemplo, al cargar una partida) vuelve a mostrarse
  if (!menu.isOpen && state.incidents.pending && !decisionShown) showDecision();
  const paused = menu.isOpen || modal.isOpen;
  if (!paused) input.update(dt);
  if (!demo) camera.clampTo(state.map.width, state.map.height);

  const msPerDay = MS_PER_DAY[state.time.speed];
  if (Number.isFinite(msPerDay) && !paused) {
    accumulator += dt;
    while (accumulator >= msPerDay) {
      accumulator -= msPerDay;
      onEvents(tick(state));
    }
  } else {
    accumulator = 0;
  }

  // Previsualización de la herramienta bajo el cursor
  let preview: CommandResult | null = null;
  const view: ViewState = {
    hover: menu.isOpen ? null : input.hover,
    selected,
    preview: null,
    overlay: toolOverlay(tool) ?? hud.overlay,
    grid: tool.kind !== 'select' && tool.kind !== 'land',
    landTool: tool.kind === 'land',
  };
  if (input.hover && tool.kind !== 'select' && !menu.isOpen) {
    const start = input.dragStart ?? input.hover;
    const cmd = toolCommand(tool, start, input.hover, toolOptions);
    if (cmd) preview = previewCommand(state, cmd);
    let tiles = toolPreviewTiles(tool, input.dragStart, input.hover);
    // En franja solo se resaltan las casillas junto a las calles (si no hay ninguna, el rectángulo en rojo)
    if (cmd?.type === 'zone' && cmd.strip) {
      const near = roadStrip(state, cmd.rect, cmd.strip);
      const strip = tiles.filter((p) => inBounds(state.map, p.x, p.y) && near.has(tileIndex(state.map, p.x, p.y)));
      if (strip.length) tiles = strip;
    }
    view.preview = { tiles, ok: preview?.ok ?? false };
  }

  renderer.draw(state, camera, view, now);
  hud.update(state, tool, preview, selected, view.overlay);
  menu.tick();
  requestAnimationFrame(frame);
}

menu.openMain();
requestAnimationFrame(frame);

// Acceso desde la consola del navegador para depurar (game.demo es la demostración del menú principal)
Object.assign(window, { game: { state, camera, demo } });
