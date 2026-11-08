import './styles/base.css';
import './styles/components.css';
import './styles/hud.css';
import './styles/panels.css';
import './styles/menu.css';
import { InputController } from './input/controller';
import { SELECT_TOOL, STRIP_DEPTHS, type Tool, type ToolOptions, toolCommand, toolOverlay, toolPreviewTiles } from './input/tools';
import { Camera } from './render/camera';
import { Renderer, type ViewState, rebuildRamps } from './render/renderer';
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
import { applyTheme, setColorVision } from './theme';
import { Hud } from './ui/hud';
import { rankEmblemSVG } from './ui/brand';
import { commandLabel, formatMoney } from './ui/menus';
import { Menu } from './ui/menu';
import { Modal } from './ui/modal';
import { COLOR_VISION_MODES, applySettings, loadSettings, markTutorialDone, saveSettings } from './ui/settings';
import { AUTOSAVE_SLOT, exportToFile, saveToSlot } from './ui/storage';
import { installTooltips } from './ui/tooltip';
import { setLanguage } from './ui/i18n';
import { type Ambient, daylight, hourLabel, lightning } from './render/ambient';
import { SEASON_LABEL, WEATHER, type WeatherKind, seasonOf } from './sim/data/weather';
import { Sound } from './ui/audio';
import { type Citizen, FollowCard, citizenPosition, pickCitizen } from './ui/follow';
import type { IconName } from './ui/icons';
import { PHOTO_HOURS, PhotoBar, downloadCanvas } from './ui/photo';
import { SimClient, type StateUpdate, createSimWorker } from './simClient';
import type { RedoOutcome, UndoOutcome } from './sim/undo';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** Ciudad de demostración del menú principal: siempre el mismo mapa, con lagos. */
const DEMO_SEED = 42;
/** Tiempo por fotograma que puede usar la demostración para simular (ms) y días como máximo. */
const DEMO_BUDGET_MS = 5;
const DEMO_MAX_DAYS_PER_FRAME = 12;
/** Un día del reloj de ambiente (fase 20) dura esto en tiempo real, a cualquier velocidad; se para en pausa. */
const DAY_CYCLE_MS = 240_000;
/** Días que se piden de una vez al worker de la simulación como mucho (fase 21). */
const MAX_DAYS_PER_REQUEST = 5;
const WEATHER_ICON: Record<WeatherKind, IconName> = { clear: 'sun', clouds: 'cloud', rain: 'rain', storm: 'storm', fog: 'fog', snow: 'snow' };
const BUILD_CUES = new Set<Command['type']>(['buildRoad', 'zone', 'placeBuilding', 'buildPowerLine', 'buildPipe', 'buildMetro', 'createDistrict', 'buyPlot', 'terraform']);
const DEMOLISH_CUES = new Set<Command['type']>(['bulldoze', 'dezone', 'removePipe', 'removeMetro']);

applyTheme();
const settings = loadSettings();
applySettings(settings);
setColorVision(COLOR_VISION_MODES[settings.colorVision] ?? 'normal');
setLanguage(settings.language === 1 ? 'en' : 'es');
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
/** Simulación en segundo plano (fase 21); null si el navegador no puede o si falló: entonces corre aquí. */
let sim: SimClient | null = null;
/** Hora del día (0-1) del reloj de ambiente: empieza por la mañana. */
let dayClock = 0.35;
let lastFlash = 0;
/** Vecino al que sigue la cámara (fase 20). */
let citizen: Citizen | null = null;
const sound = new Sound();
sound.setVolume(settings.volume);
// Los navegadores solo dejan sonar algo después de que el jugador toque la página
window.addEventListener('pointerdown', () => sound.unlock());
window.addEventListener('keydown', () => sound.unlock());

function run(cmd: Command): CommandResult {
  // Con la simulación en segundo plano, la orden se aplica aquí al momento y también allí (con su deshacer)
  let result: CommandResult;
  if (demo) result = applyCommand(state, cmd);
  else if (sim) {
    result = applyCommand(state, cmd);
    if (result.ok) sim.command(cmd);
  } else result = history.run(state, cmd);
  if (!result.ok && result.reason) hud.flash(result.reason);
  if (!demo) {
    if (result.ok && BUILD_CUES.has(cmd.type)) sound.play('build');
    else if (result.ok && DEMOLISH_CUES.has(cmd.type)) sound.play('demolish');
    else if (!result.ok && result.reason) sound.play('error');
  }
  if (result.ok && cmd.type === 'buyPlot') hud.notify(`Parcela comprada por ${formatMoney(result.cost)}`, 'unlock');
  return result;
}

function undo(): void {
  if (sim) sim.undo();
  else reportUndo(history.undo(state));
}

function redo(): void {
  if (sim) sim.redo();
  else reportRedo(history.redo(state));
}

function reportUndo(r: UndoOutcome): void {
  if (!r.ok) return hud.flash(r.reason);
  const partial = r.restored < r.total ? ` (${r.restored} de ${r.total} casillas: el resto ya ha cambiado)` : '';
  hud.notify(`Deshecho: ${commandLabel(r.cmd)}${partial}${r.refund ? ` · ${formatMoney(r.refund)} devueltos` : ''}`);
}

function reportRedo(r: RedoOutcome): void {
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
  stopFollow();
  setPhoto(false);
  startSim();
  sim?.load(state);
  Object.assign(window, { game: { state, camera } });
}

// ---- Simulación en segundo plano (fase 21) ----

/** Arranca el worker de la simulación la primera vez que hay partida (la demostración del menú corre aquí). */
function startSim(): void {
  if (sim) return;
  const port = createSimWorker();
  if (!port) return;
  sim = new SimClient(port, applyUpdate, () => {
    // Si el worker falla, la partida sigue aquí con la última copia
    port.terminate?.();
    sim = null;
    history.clear();
    hud.notify('La simulación en segundo plano ha fallado: sigue en esta pestaña', 'warning');
  });
}

/** Llega un estado del worker: sustituye a la copia de aquí y se atienden sus eventos. */
function applyUpdate(u: StateUpdate): void {
  state = u.state;
  Object.assign(window, { game: { state, camera } });
  if (u.undo) reportUndo(u.undo);
  if (u.redo) reportRedo(u.redo);
  onEvents(u.events);
}

// ---- Seguir a un vecino y modo foto (fase 20) ----

/** Empieza a seguir a un vecino: el de la vivienda seleccionada o uno al azar. */
function startFollow(): void {
  const next = pickCitizen(state, selected);
  if (!next) return hud.flash('Todavía no vive nadie en la ciudad');
  citizen = next;
  selected = null;
  tool = SELECT_TOOL;
  hud.setModes(true, photoBar.open);
}

function stopFollow(): void {
  citizen = null;
  hud.setModes(false, photoBar.open);
}

function setPhoto(on: boolean): void {
  photoBar.toggle(on);
  uiRoot.classList.toggle('photo-mode', on);
  if (on) {
    tool = SELECT_TOOL;
    selected = null;
  }
  hud.setModes(!!citizen, on);
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
  history: () => (sim ? { undo: sim.canUndo, redo: sim.canRedo } : { undo: history.canUndo, redo: history.canRedo }),
  getStrip: () => toolOptions.strip,
  setStrip: (depth) => (toolOptions.strip = depth),
  tutorialFinished: markTutorialDone,
  focus: (t) => {
    camera.centerOn(t.x + 0.5, t.y + 0.5);
    selected = t;
  },
  toggleFollow,
  togglePhoto,
});
const followCard = new FollowCard(
  () => startFollow(),
  () => stopFollow(),
);
hud.addLeft(followCard.el);
const photoBar = new PhotoBar(
  () => downloadCanvas(canvas, state.name, state.time.year, state.time.month),
  () => setPhoto(false),
);
uiRoot.append(photoBar.el);

function toggleFollow(): void {
  if (demo) return;
  if (citizen) stopFollow();
  else startFollow();
}

function togglePhoto(): void {
  if (!demo) setPhoto(!photoBar.open);
}

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
        sanitation: true,
        demographics: true,
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
    sound.setVolume(settings.volume);
    if (key === 'colorVision') {
      setColorVision(COLOR_VISION_MODES[settings.colorVision] ?? 'normal');
      rebuildRamps();
    }
    if (key === 'language') setLanguage(settings.language === 1 ? 'en' : 'es');
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
  toggleFollow,
  togglePhoto,
  blocked: () => menu.isOpen || modal.isOpen,
  edgeScroll: () => settings.edgeScroll === 1,
  // Esc: atrás en el menú → sale del modo foto → deja de seguir → suelta la herramienta → quita la selección → menú de pausa
  cancelTool: () => {
    if (modal.isOpen) modal.dismiss();
    else if (menu.isOpen) menu.back();
    else if (photoBar.open) setPhoto(false);
    else if (citizen) stopFollow();
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
    else if (e.type === 'rankUp') {
      celebrateRank(e.rank, e.grant, e.unlocks);
      sound.play('rank');
    } else if (e.type === 'achievement') {
      hud.notify(`Logro: ${e.name}`, 'unlock');
      sound.play('achievement');
    } else if (e.type === 'weather') {
      hud.notify(e.kind === 'storm' ? 'Se acerca una tormenta: los rayos pueden provocar incendios' : 'Empieza a nevar', 'info');
    }
    else if (e.type === 'scenarioEnd') scenarioEnded(e.id, e.won);
    else if (e.type === 'decision') showDecision();
    else if (e.type === 'fire') {
      hud.notify(e.covered ? 'Incendio: los bomberos ya van de camino' : 'Incendio sin cobertura de bomberos: se propagará', 'negative', { x: e.x, y: e.y });
    } else if (e.type === 'fireOver') {
      hud.notify(e.destroyed ? `Incendio apagado: ${e.destroyed} ${e.destroyed === 1 ? 'edificio destruido' : 'edificios destruidos'}` : 'Incendio apagado sin daños', e.destroyed ? 'warning' : 'info');
    } else if (e.type === 'effectEnded') hud.notify(`Termina: ${e.label}`);
    else if (e.type === 'repaired') hud.notify(`${e.name}: reparada`);
    else if (e.type === 'landfillFull') hud.notify(`${e.name} lleno: ya no recoge basura`, 'warning', { x: e.x, y: e.y });
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
    if (sim && !demo) {
      // En segundo plano: se piden los días que tocan y no se piden más hasta que lleguen (el dibujo no espera)
      const days = Math.min(MAX_DAYS_PER_REQUEST, Math.floor(accumulator / msPerDay));
      if (days > 0 && !sim.inFlight) {
        sim.tick(days);
        accumulator -= days * msPerDay;
      }
      accumulator = Math.min(accumulator, msPerDay * MAX_DAYS_PER_REQUEST);
    } else {
      while (accumulator >= msPerDay) {
        accumulator -= msPerDay;
        onEvents(tick(state));
      }
    }
  } else {
    accumulator = 0;
  }

  // Ambiente (fase 20): el reloj del día corre mientras corre la partida (y en la demostración del menú)
  if (menu.isMain || (!paused && state.time.speed > 0)) dayClock = (dayClock + dt / DAY_CYCLE_MS) % 1;
  const photo = photoBar.open;
  const photoHour = photo ? PHOTO_HOURS[photoBar.hour] : null;
  const ambient: Ambient = {
    hour: photoHour ?? (settings.dayNight ? dayClock : 0.5),
    weather: state.weather.kind,
    still: settings.reducedMotion === 1,
  };
  const weather = WEATHER[state.weather.kind];
  const night = 1 - daylight(ambient.hour).light;
  hud.setAmbient(
    settings.dayNight && !demo ? hourLabel(dayClock) : null,
    { icon: WEATHER_ICON[weather.kind], label: weather.label, season: SEASON_LABEL[seasonOf(state.time.month)] },
    night > 0.5,
  );
  const flash = lightning(ambient, now / 1000);
  const trips = Math.min(1, state.stats.traffic.trips / 3_000);
  sound.update({
    activity: trips * Math.max(0.2, Math.min(1, camera.zoom / 3)),
    weather: state.weather.kind,
    night,
    paused: paused || state.time.speed === 0,
    flash: flash > 0.9 && lastFlash <= 0.9,
  });
  lastFlash = flash;

  // El vecino al que se sigue: la cámara le acompaña (si su casa desaparece, se deja de seguir)
  if (citizen && !state.map.lotLevel[citizen.home]) {
    stopFollow();
    hud.notify('El vecino al que seguías se ha mudado');
  }
  const followed = citizen ? citizenPosition(citizen, dayClock) : null;
  if (followed && !paused) {
    const cx = camera.x + camera.viewWidth / camera.scale / 2;
    const cy = camera.y + camera.viewHeight / camera.scale / 2;
    camera.centerOn(cx + (followed.x - cx) * 0.08, cy + (followed.y - cy) * 0.08);
  }
  followCard.show(state, citizen, dayClock);

  // Previsualización de la herramienta bajo el cursor
  let preview: CommandResult | null = null;
  const view: ViewState = {
    hover: menu.isOpen || photo ? null : input.hover,
    selected: photo ? null : selected,
    preview: null,
    overlay: photo ? 'none' : (toolOverlay(tool) ?? hud.overlay),
    grid: !photo && tool.kind !== 'select' && tool.kind !== 'land',
    landTool: tool.kind === 'land',
    districts: tool.kind === 'district',
    ambient,
    follow: followed && citizen && !photo ? { ...followed, label: citizen.name } : null,
    tiltShift: photo && photoBar.tiltShift,
  };
  if (input.hover && tool.kind !== 'select' && !menu.isOpen && !photo) {
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
