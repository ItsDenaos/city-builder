import {
  BREAKDOWN_MONTHLY_CHANCE,
  FIRE_BURN_DAYS,
  FIRE_DAILY_CHANCE,
  FIRE_EXTINGUISH,
  FIRE_SPREAD,
  INCIDENT_COOLDOWN_DAYS,
  INCIDENT_MONTHLY_CHANCE,
} from '../config';
import { getBuildingDef } from '../data/buildings';
import { INCIDENTS, breakablePlants, getIncident } from '../data/incidents';
import { ZONE_CODE } from '../data/zones';
import { random } from '../rng';
import type { GameState } from '../state';
import type { SimEvent } from '../types';

/** Eventos que no se repiten hasta que hayan pasado otros tantos. */
const RECENT_MEMORY = 3;

function forNeighbors(w: number, h: number, i: number, fn: (n: number) => void): void {
  const x = i % w;
  if (x > 0) fn(i - 1);
  if (x < w - 1) fn(i + 1);
  if (i >= w) fn(i - w);
  if (i < w * (h - 1)) fn(i + w);
}

function ignite(state: GameState, i: number): void {
  state.map.fire[i] = 1;
  state.map.lotOccupants[i] = 0; // se desaloja
}

/**
 * Incendios en los edificios de las zonas:
 * - Cada día puede declararse uno; el riesgo crece con el nivel del edificio, es doble en la industria
 *   y cae con el cuadrado de la cobertura de bomberos.
 * - Un edificio en llamas se queda vacío, puede contagiar a sus vecinos (menos cuanto más cobertura
 *   tengan) y, si los bomberos no lo apagan antes, a los FIRE_BURN_DAYS días queda destruido.
 *   La zona sigue: con demanda se vuelve a construir. Las carreteras hacen de cortafuegos.
 */
function updateFires(state: GameState, events: SimEvent[]): void {
  const { map, layers, incidents } = state;
  const { width: w, height: h } = map;
  const size = w * h;
  const cover = layers.coverage.fire;
  const wasBurning = incidents.burning > 0;

  // 1. Los fuegos en curso: se apagan, se propagan o consumen el edificio
  const spread: number[] = [];
  let burning = 0;
  for (let i = 0; i < size; i++) {
    if (!map.fire[i]) continue;
    if (!map.lotLevel[i]) {
      map.fire[i] = 0; // demolido o ya sin edificio
      continue;
    }
    if (random(state) < (cover[i] / 100) * FIRE_EXTINGUISH) {
      map.fire[i] = 0;
      continue;
    }
    forNeighbors(w, h, i, (n) => {
      if (map.lotLevel[n] && !map.fire[n] && random(state) < FIRE_SPREAD * (1 - cover[n] / 100)) spread.push(n);
    });
    if (++map.fire[i] > FIRE_BURN_DAYS) {
      map.fire[i] = 0;
      map.lotLevel[i] = 0;
      map.lotOccupants[i] = 0;
      incidents.fireLosses++;
      continue;
    }
    burning++;
  }
  for (const n of spread) {
    if (map.fire[n]) continue;
    ignite(state, n);
    burning++;
  }

  // 2. Un incendio nuevo: se sortea uno por día con el riesgo total y se elige el lote por su riesgo
  const chance = FIRE_DAILY_CHANCE[incidents.level] ?? 0;
  if (chance) {
    const risk = (i: number) =>
      map.lotLevel[i] && !map.fire[i]
        ? chance * (0.5 + 0.5 * map.lotLevel[i]) * (map.zoneType[i] === ZONE_CODE.I ? 2 : 1) * (1 - cover[i] / 100) ** 2
        : 0;
    let total = 0;
    for (let i = 0; i < size; i++) total += risk(i);
    if (total > 0 && random(state) < total) {
      let pick = random(state) * total;
      for (let i = 0; i < size; i++) {
        pick -= risk(i);
        if (pick > 0) continue;
        ignite(state, i);
        burning++;
        incidents.fires++;
        const x = i % w;
        events.push({ type: 'fire', x, y: (i - x) / w, covered: cover[i] >= 30 });
        break;
      }
    }
  }

  incidents.burning = burning;
  if (wasBurning && !burning) {
    events.push({ type: 'fireOver', destroyed: incidents.fireLosses });
    if (!incidents.fireLosses) incidents.firesContained++;
    incidents.fireLosses = 0;
  }
}

/** Las centrales averiadas cuentan los días que les faltan para volver a funcionar. */
function updateOutages(state: GameState, events: SimEvent[]): void {
  for (const b of state.buildings.values()) {
    if (!b.outage) continue;
    if (--b.outage <= 0) {
      delete b.outage;
      events.push({ type: 'repaired', name: getBuildingDef(b.defId)?.name ?? 'La central' });
    }
  }
}

function startIncident(state: GameState, events: SimEvent[], id: string, data: Record<string, number>): void {
  const inc = state.incidents;
  inc.pending = { id, data };
  inc.recent = [...inc.recent, id].slice(-RECENT_MEMORY);
  events.push({ type: 'decision', id });
}

/**
 * Eventos y desastres (fase 17), según el nivel elegido al crear la partida (0 = ninguno):
 * incendios y averías a diario; al cerrar el mes caducan los efectos y puede llegar un evento con decisión.
 * Mientras hay una decisión pendiente no llega otra.
 */
export function updateIncidents(state: GameState, events: SimEvent[]): void {
  const inc = state.incidents;
  updateOutages(state, events);
  if (inc.level || inc.burning) updateFires(state, events);
  if (inc.cooldown > 0) inc.cooldown--;
  if (!events.some((e) => e.type === 'newMonth')) return;

  for (const e of inc.effects) e.monthsLeft--;
  for (const e of inc.effects) if (e.monthsLeft <= 0) events.push({ type: 'effectEnded', label: e.label });
  inc.effects = inc.effects.filter((e) => e.monthsLeft > 0);

  if (!inc.level || inc.pending) return;
  const breakdown = BREAKDOWN_MONTHLY_CHANCE[inc.level] ?? 0;
  if (breakablePlants(state).some(() => random(state) < breakdown)) {
    const data = getIncident('averia')!.prepare(state);
    if (data) return startIncident(state, events, 'averia', data);
  }
  if (inc.cooldown > 0 || random(state) >= (INCIDENT_MONTHLY_CHANCE[inc.level] ?? 0)) return;
  const options = INCIDENTS.filter((d) => d.weight > 0 && !inc.recent.includes(d.id))
    .map((def) => ({ def, data: def.prepare(state) }))
    .filter((o): o is { def: (typeof INCIDENTS)[number]; data: Record<string, number> } => o.data !== null);
  const total = options.reduce((sum, o) => sum + o.def.weight, 0);
  if (!total) return;
  let pick = random(state) * total;
  for (const o of options) {
    pick -= o.def.weight;
    if (pick > 0) continue;
    inc.cooldown = INCIDENT_COOLDOWN_DAYS;
    return startIncident(state, events, o.def.id, o.data);
  }
}
