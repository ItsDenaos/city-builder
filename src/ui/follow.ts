import { FIRST_NAMES, neighborhoodName } from '../sim/data/agora';
import { getBuildingDef } from '../sim/data/buildings';
import { ZONE_BY_CODE, ZONE_CODE, ZONE_TYPE_LABEL, getZoneDefByCode } from '../sim/data/zones';
import { type GameState, NO_BUILDING, TRANSIT_MODE_CODE, adultsOf } from '../sim/state';
import { roadRoute } from '../sim/systems/paths';
import type { Point } from '../sim/types';
import { icon } from './icons';

/**
 * Seguir a un vecino (fase 20): se elige a alguien de una vivienda y la cámara le acompaña de casa a su
 * destino y de vuelta según la hora del día (el trabajo para los adultos, el colegio para los niños, un
 * parque o un monumento para los mayores). Es solo de la interfaz: lee la simulación y no la cambia.
 */

type Stage = 'school' | 'work' | 'retired';

export interface Citizen {
  name: string;
  stage: Stage;
  /** Casilla de la vivienda y de su destino (null si no llega a ninguno). */
  home: number;
  goal: number | null;
  /** Qué es su destino, para la ficha («Talleres · industria», «Escuela»...). */
  goalLabel: string;
  /** Puntos del trayecto en casillas (centros), de casa al destino. */
  route: Point[];
  /** Cómo va: «en coche», «en autobús»... */
  mode: string;
}

/** Horas (0-1) de ida y de vuelta y lo que dura el viaje, según la edad. */
const SCHEDULE: Record<Stage, { leave: number; back: number }> = {
  school: { leave: 8 / 24, back: 14 / 24 },
  work: { leave: 7 / 24, back: 17.5 / 24 },
  retired: { leave: 10 / 24, back: 12.5 / 24 },
};
const TRIP = 1 / 24;
const MODE_LABEL: Record<number, string> = { [TRANSIT_MODE_CODE.bus]: 'en autobús', [TRANSIT_MODE_CODE.metro]: 'en metro', [TRANSIT_MODE_CODE.train]: 'en tren' };

const center = (state: GameState, i: number): Point => ({ x: (i % state.map.width) + 0.5, y: Math.floor(i / state.map.width) + 0.5 });

/** Elige un vecino (de la vivienda `near` si se da y está habitada) y le calcula el trayecto. */
export function pickCitizen(state: GameState, near?: Point | null): Citizen | null {
  const { map, layers } = state;
  const isHome = (i: number) => map.zoneType[i] === ZONE_CODE.R && map.lotLevel[i] > 0 && map.lotOccupants[i] > 0 && layers.roadEntry[i] >= 0;
  let home = near ? near.y * map.width + near.x : -1;
  if (home < 0 || !isHome(home)) {
    const homes: number[] = [];
    for (let i = 0; i < map.zoneType.length; i++) if (isHome(i)) homes.push(i);
    if (!homes.length) return null;
    home = homes[Math.floor(Math.random() * homes.length)];
  }

  // Edad según el reparto de la ciudad (sin edades en la partida, siempre en edad de trabajar)
  let stage: Stage = 'work';
  if (state.demographics) {
    const d = state.demography;
    const r = Math.random() * (d.children + adultsOf(d) + d.elderly);
    stage = r < d.children ? 'school' : r < d.children + adultsOf(d) ? 'work' : 'retired';
  }

  // Destino: la casilla de calle más cercana por la que se entra a un sitio de su tipo
  const goalOf = new Map<number, number>();
  const want = (i: number): boolean => {
    if (stage === 'work') {
      const type = ZONE_BY_CODE[map.zoneType[i]];
      if (map.lotLevel[i] && (type === 'C' || type === 'I')) return true;
    }
    const id = map.building[i];
    if (id === NO_BUILDING) return false;
    const def = getBuildingDef(state.buildings.get(id)?.defId ?? '');
    if (!def) return false;
    if (stage === 'school') return def.seats?.level === 'basic' || def.coverage?.service === 'education';
    if (stage === 'retired') return def.category === 'parks' || !!def.monument;
    return !!def.capacity?.jobs;
  };
  for (let i = 0; i < map.zoneType.length; i++) {
    const e = layers.roadEntry[i];
    if (e >= 0 && !goalOf.has(e) && want(i)) goalOf.set(e, i);
  }
  const path = roadRoute(map, layers.roadEntry[home], (i) => goalOf.has(i));
  const goal = path ? goalOf.get(path[path.length - 1])! : null;

  const name = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  // Va en transporte con la misma probabilidad que sus vecinos de casa
  const transit = layers.transitMode[home] && Math.random() < layers.transitShare[home] ? MODE_LABEL[layers.transitMode[home]] : null;
  const walk = path && path.length <= 3;
  return {
    name,
    stage,
    home,
    goal,
    goalLabel: goal === null ? '' : placeLabel(state, goal),
    route: path && goal !== null ? [center(state, home), ...path.map((i) => center(state, i)), center(state, goal)] : [center(state, home)],
    mode: walk ? 'a pie' : stage === 'work' ? (transit ?? 'en coche') : stage === 'school' ? 'a pie o en autobús escolar' : (transit ?? 'a pie'),
  };
}

function placeLabel(state: GameState, i: number): string {
  const { map } = state;
  const id = map.building[i];
  if (id !== NO_BUILDING) return getBuildingDef(state.buildings.get(id)?.defId ?? '')?.name ?? 'un edificio';
  const type = ZONE_BY_CODE[map.zoneType[i]];
  const def = getZoneDefByCode(map.zoneType[i], map.zoneDensity[i]);
  return type ? `${def.buildingName} · ${ZONE_TYPE_LABEL[type].toLowerCase()}` : 'un edificio';
}

/** Dónde está el vecino a esta hora (0-1), en casillas. */
export function citizenPosition(c: Citizen, hour: number): Point {
  const s = SCHEDULE[c.stage];
  const along = (t: number): Point => {
    const pts = c.route;
    if (pts.length < 2) return pts[0];
    const seg = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1)));
    const k = t * (pts.length - 1) - seg;
    return { x: pts[seg].x + (pts[seg + 1].x - pts[seg].x) * k, y: pts[seg].y + (pts[seg + 1].y - pts[seg].y) * k };
  };
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  if (hour < s.leave) return along(0);
  if (hour < s.leave + TRIP) return along(clamp((hour - s.leave) / TRIP));
  if (hour < s.back) return along(1);
  if (hour < s.back + TRIP) return along(1 - clamp((hour - s.back) / TRIP));
  return along(0);
}

/** Qué está haciendo, para la ficha. */
function doing(c: Citizen, hour: number): string {
  const s = SCHEDULE[c.stage];
  if (c.goal === null) return 'Hoy no sale de casa: no hay adónde llegar por la calle';
  if (hour >= s.leave && hour < s.leave + TRIP) return `De camino, ${c.mode}`;
  if (hour >= s.back && hour < s.back + TRIP) return `Vuelve a casa, ${c.mode}`;
  if (hour >= s.leave + TRIP && hour < s.back) return c.stage === 'work' ? 'Trabajando' : c.stage === 'school' ? 'En clase' : 'De paseo';
  return hour >= 22 / 24 || hour < 6.5 / 24 ? 'Durmiendo' : 'En casa';
}

/** Ficha del vecino al que se sigue (va en la columna izquierda, sobre el inspector). */
export class FollowCard {
  readonly el = document.createElement('section');
  private body = document.createElement('div');
  private lastHtml = '';

  constructor(onOther: () => void, onStop: () => void) {
    this.el.className = 'panel follow-card hidden';
    this.el.setAttribute('aria-label', 'Vecino al que sigues');
    const head = document.createElement('div');
    head.className = 'panel-head';
    head.innerHTML = '<div><span class="kicker">Siguiendo a un vecino</span><h2 class="title"></h2></div>';
    const close = document.createElement('button');
    close.className = 'icon-btn';
    close.innerHTML = icon('close', 16);
    close.dataset.tip = 'Dejar de seguir';
    close.dataset.key = 'Esc';
    close.setAttribute('aria-label', 'Dejar de seguir');
    close.onclick = onStop;
    head.append(close);
    const actions = document.createElement('div');
    actions.className = 'follow-actions';
    const other = document.createElement('button');
    other.className = 'btn';
    other.textContent = 'Otro vecino';
    other.onclick = onOther;
    actions.append(other);
    this.body.className = 'panel-body';
    this.el.append(head, this.body, actions);
  }

  show(state: GameState, c: Citizen | null, hour: number): void {
    this.el.classList.toggle('hidden', !c);
    if (!c) return;
    const { layers } = state;
    const title = this.el.querySelector('.title')!;
    if (title.textContent !== c.name) title.textContent = c.name;
    const hx = c.home % state.map.width;
    const hy = Math.floor(c.home / state.map.width);
    const where = c.stage === 'work' ? 'Trabaja en' : c.stage === 'school' ? 'Estudia en' : 'Se jubiló; pasa la mañana en';
    const kv = (k: string, v: string) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`;
    const html =
      kv('Ahora', doing(c, hour)) +
      kv('Barrio', neighborhoodName(state, hx, hy)) +
      kv('Vive en', getZoneDefByCode(state.map.zoneType[c.home], state.map.zoneDensity[c.home]).buildingName) +
      (c.goal !== null ? kv(where, c.goalLabel) : '') +
      kv('Felicidad en casa', `${Math.round(layers.happiness[c.home])} %`) +
      (layers.commute[c.home] >= 0 && c.stage === 'work' ? kv('Trayecto al trabajo', String(Math.round(layers.commute[c.home]))) : '');
    if (html !== this.lastHtml) {
      this.body.innerHTML = html;
      this.lastHtml = html;
    }
  }
}
