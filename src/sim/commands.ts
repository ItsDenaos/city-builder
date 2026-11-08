import {
  BRIDGE_COST_MULTIPLIER,
  BULLDOZE_BUILDING_COST,
  BULLDOZE_LOT_COST,
  BULLDOZE_TILE_COST,
  DISTRICT_NAME_MAX,
  FUNDING_MAX,
  FUNDING_MIN,
  FUNDING_STEP,
  LOAN_AMOUNTS,
  LOAN_MONTHS,
  MAX_DISTRICTS,
  MAX_LOANS,
  MAX_ORDINANCES,
  METRO_TUNNEL_COST,
  PIPE_COST,
  POWER_LINE_COST,
  TERRAFORM_DIG_COST,
  TERRAFORM_FILL_COST,
  TAX_MAX,
  TAX_MIN,
} from './config';
import { ROADS, ROAD_BY_CODE, type RoadKind } from './data/roads';
import { DENSITY_CODE, ZONE_CODE, getZoneDef } from './data/zones';
import { type BuildingDef, getBuildingDef } from './data/buildings';
import { autoNeighborhoodName } from './data/agora';
import { DEPARTMENT_IDS, type DepartmentId } from './data/departments';
import { getIncident } from './data/incidents';
import { getOrdinance } from './data/ordinances';
import { clipRect, curvePath, gridPositions, normalizeRect, roadPath } from './geometry';
import { nextPlotCost, ownsTile, plotAt, plotBlocker } from './land';
import { loanPayment } from './systems/economy';
import { type GameMap, type GameState, NO_BUILDING, inBounds, isUnlocked, tileIndex } from './state';
import type { TutorialState } from './tutorial';
import { roadStrip } from './zoning';
import { type Density, type Point, type Rect, type Speed, TERRAIN_LAND, TERRAIN_WATER, type ZoneType } from './types';

/**
 * Toda modificación del estado por parte del jugador pasa por un Command.
 * La UI nunca toca el estado directamente: así validación, costes, undo y repeticiones
 * quedan en un solo sitio.
 */
export type Command =
  /** Sin `road`, calle. Una avenida sobre una calle la mejora pagando la diferencia. Con `curve`, en curva. */
  | { type: 'buildRoad'; from: Point; to: Point; road?: RoadKind; curve?: boolean }
  /** Con `strip`, solo las casillas a esa distancia (a pie) de una carretera: zonificar en franjas. */
  | { type: 'zone'; rect: Rect; zone: ZoneType; density: Density; strip?: number }
  | { type: 'dezone'; rect: Rect }
  /** Con `to`, una rejilla de copias entre `at` y `to` (solo parques y edificios de 1 × 1, ver canDragPlace). */
  | { type: 'placeBuilding'; defId: string; at: Point; to?: Point }
  | { type: 'buildPowerLine'; from: Point; to: Point }
  | { type: 'buildPipe'; from: Point; to: Point }
  | { type: 'removePipe'; rect: Rect }
  /** Túnel de metro (subterráneo, como las tuberías): une las estaciones que toca. */
  | { type: 'buildMetro'; from: Point; to: Point }
  | { type: 'removeMetro'; rect: Rect }
  | { type: 'bulldoze'; rect: Rect }
  /** Editor de terreno (fase 21): excavar (agua) o rellenar (tierra) un rectángulo sin nada construido. */
  | { type: 'terraform'; rect: Rect; to: 'land' | 'water' }
  | { type: 'setSpeed'; speed: Speed }
  | { type: 'setTaxRate'; zone: ZoneType; rate: number }
  /** Financiación de un departamento, en % (múltiplo de FUNDING_STEP entre FUNDING_MIN y FUNDING_MAX). */
  | { type: 'setFunding'; dept: DepartmentId; value: number }
  /** Activa o deroga una ordenanza. */
  | { type: 'toggleOrdinance'; id: string }
  /** Distrito con nombre sobre un rectángulo; sin `name` toma el del barrio donde cae. */
  | { type: 'createDistrict'; rect: Rect; name?: string }
  | { type: 'renameDistrict'; id: number; name: string }
  | { type: 'removeDistrict'; id: number }
  | { type: 'takeLoan'; amount: number }
  | { type: 'repayLoan'; loanId: number }
  /** Comprar la parcela de terreno que contiene la casilla `at`. */
  | { type: 'buyPlot'; at: Point }
  /** Elegir una opción del evento pendiente. */
  | { type: 'decide'; choice: number }
  /** La guía de primeros pasos avanza o se cierra (null). La interfaz lo pide así para que llegue a la simulación en segundo plano. */
  | { type: 'setTutorial'; tutorial: TutorialState | null };

export interface CommandResult {
  ok: boolean;
  cost: number;
  affected: number; // casillas o edificios afectados
  reason?: string;
  /** Resultado que conviene contar al jugador (daños de una inundación...). */
  message?: string;
}

interface Plan {
  result: CommandResult;
  apply?: () => void | string;
}

/** Calcula el resultado sin modificar el estado (para la previsualización bajo el cursor). */
export function previewCommand(state: GameState, cmd: Command): CommandResult {
  return checkFunds(state, plan(state, cmd).result);
}

export function applyCommand(state: GameState, cmd: Command): CommandResult {
  if (state.economy.bankrupt) return { ok: false, cost: 0, affected: 0, reason: 'La ciudad está en bancarrota' };
  const p = plan(state, cmd);
  const result = checkFunds(state, p.result);
  if (result.ok && p.apply) {
    const message = p.apply();
    if (!state.sandbox) state.economy.money -= result.cost;
    if (message) return { ...result, message };
  }
  return result;
}

/** Solo bloquea lo que cuesta dinero: con saldo negativo se puede seguir pidiendo préstamos o cambiando impuestos. */
function checkFunds(state: GameState, r: CommandResult): CommandResult {
  return !state.sandbox && r.ok && r.cost > 0 && r.cost > state.economy.money ? { ...r, ok: false, reason: 'Fondos insuficientes' } : r;
}

const ok = (cost: number, affected: number): CommandResult => ({ ok: true, cost, affected });
const fail = (reason: string): Plan => ({ result: { ok: false, cost: 0, affected: 0, reason } });

function plan(state: GameState, cmd: Command): Plan {
  switch (cmd.type) {
    case 'buildRoad':
      return planRoad(state, cmd.from, cmd.to, cmd.road ?? 'street', cmd.curve);
    case 'zone':
      return planZone(state, cmd.rect, cmd.zone, cmd.density, cmd.strip);
    case 'dezone':
      return planDezone(state, cmd.rect);
    case 'placeBuilding':
      return cmd.to ? planBuildings(state, cmd.defId, cmd.at, cmd.to) : planBuilding(state, cmd.defId, cmd.at);
    case 'buildPowerLine':
      return planPowerLine(state, cmd.from, cmd.to);
    case 'buildPipe':
      return planPipe(state, cmd.from, cmd.to);
    case 'removePipe':
      return planRemovePipe(state, cmd.rect);
    case 'buildMetro':
      return planMetro(state, cmd.from, cmd.to);
    case 'removeMetro':
      return planRemoveMetro(state, cmd.rect);
    case 'bulldoze':
      return planBulldoze(state, cmd.rect);
    case 'terraform':
      return planTerraform(state, cmd.rect, cmd.to);
    case 'setSpeed':
      return { result: ok(0, 0), apply: () => void (state.time.speed = cmd.speed) };
    case 'setTaxRate':
      return planTax(state, cmd.zone, cmd.rate);
    case 'setFunding':
      return planFunding(state, cmd.dept, cmd.value);
    case 'toggleOrdinance':
      return planOrdinance(state, cmd.id);
    case 'createDistrict':
      return planCreateDistrict(state, cmd.rect, cmd.name);
    case 'renameDistrict':
      return planRenameDistrict(state, cmd.id, cmd.name);
    case 'removeDistrict':
      return planRemoveDistrict(state, cmd.id);
    case 'takeLoan':
      return planLoan(state, cmd.amount);
    case 'repayLoan':
      return planRepay(state, cmd.loanId);
    case 'buyPlot':
      return planBuyPlot(state, cmd.at);
    case 'decide':
      return planDecide(state, cmd.choice);
    case 'setTutorial':
      return { result: ok(0, 0), apply: () => void (state.tutorial = cmd.tutorial ? { ...cmd.tutorial } : null) };
  }
}

const NOT_OWNED = 'Ese terreno no es tuyo: compra la parcela con la herramienta Terrenos';

/** Recorre las casillas propias del rectángulo; devuelve cuántas se saltaron por no ser del jugador. */
function forEachTile(state: GameState, rect: Rect, fn: (i: number) => void): number {
  const { map } = state;
  const r = clipRect(rect, map.width, map.height);
  if (!r) return 0;
  let skipped = 0;
  for (let y = r.y0; y <= r.y1; y++) {
    for (let x = r.x0; x <= r.x1; x++) {
      if (ownsTile(state, x, y)) fn(tileIndex(map, x, y));
      else skipped++;
    }
  }
  return skipped;
}

function clearLot(map: GameMap, i: number): void {
  map.lotLevel[i] = 0;
  map.lotOccupants[i] = 0;
  map.fire[i] = 0; // demoler hace de cortafuegos
  map.garbage[i] = 0; // la basura se va con el edificio
}

function clearZone(map: GameMap, i: number): void {
  map.zoneType[i] = 0;
  map.zoneDensity[i] = 0;
  clearLot(map, i);
}

/** Lo que se construye encima ya conduce la electricidad, así que el tendido sobra. */
function clearPowerLine(map: GameMap, i: number): void {
  map.powerLine[i] = 0;
}

/** Casilla ocupada por un edificio colocado o por uno que creció en una zona. */
const isBuilt = (map: GameMap, i: number) => map.building[i] !== NO_BUILDING || map.lotLevel[i] > 0;

function planRoad(state: GameState, from: Point, to: Point, kind: RoadKind, curve = false): Plan {
  const { map } = state;
  const def = ROADS[kind];
  const toBuild: number[] = [];
  let cost = 0;
  for (const p of curve ? curvePath(from, to) : roadPath(from, to)) {
    if (!inBounds(map, p.x, p.y)) return fail('Fuera del mapa');
    if (!ownsTile(state, p.x, p.y)) return fail(NOT_OWNED);
    const i = tileIndex(map, p.x, p.y);
    if (isBuilt(map, i)) return fail('Hay un edificio en el camino');
    const existing = ROAD_BY_CODE[map.road[i]];
    if (existing && existing.code >= def.code) continue; // no se rebaja una avenida a calle
    toBuild.push(i);
    // Sobre agua es un puente: más caro
    const factor = map.terrain[i] === TERRAIN_WATER ? BRIDGE_COST_MULTIPLIER : 1;
    cost += (def.cost - (existing?.cost ?? 0)) * factor;
  }
  if (!toBuild.length) return fail(kind === 'street' ? 'Ya hay carretera' : 'Ya hay avenida');
  return {
    result: ok(cost, toBuild.length),
    apply: () => {
      for (const i of toBuild) {
        map.road[i] = def.code;
        clearZone(map, i);
        clearPowerLine(map, i);
      }
    },
  };
}

function planZone(state: GameState, rect: Rect, zone: ZoneType, density: Density, strip?: number): Plan {
  const { map } = state;
  const def = getZoneDef(zone, density);
  if (!isUnlocked(state, def.unlockAtPopulation)) return fail(`Se desbloquea con ${def.unlockAtPopulation} habitantes`);
  const code = ZONE_CODE[zone];
  const dcode = DENSITY_CODE[density];
  const near = strip ? roadStrip(state, rect, strip) : null;
  const tiles: number[] = [];
  let far = 0;
  const skipped = forEachTile(state, rect, (i) => {
    const free = map.terrain[i] !== TERRAIN_WATER && !map.road[i] && map.building[i] === NO_BUILDING;
    // Sobre un lote construido solo se permite cambiar la densidad del mismo tipo
    const compatible = !map.lotLevel[i] || map.zoneType[i] === code;
    if (!free || !compatible || (map.zoneType[i] === code && map.zoneDensity[i] === dcode)) return;
    if (near && !near.has(i)) far++;
    else tiles.push(i);
  });
  if (!tiles.length) {
    if (far) return fail('Lejos de las calles: zonifica junto a una calle o pulsa F para usar el rectángulo entero');
    return fail(skipped ? NOT_OWNED : 'Nada que zonificar aquí');
  }
  return {
    result: ok(tiles.length * def.costPerTile, tiles.length),
    apply: () => {
      for (const i of tiles) {
        map.zoneType[i] = code;
        map.zoneDensity[i] = dcode;
        clearPowerLine(map, i);
      }
    },
  };
}

function planDezone(state: GameState, rect: Rect): Plan {
  const { map } = state;
  const tiles: number[] = [];
  const skipped = forEachTile(state, rect, (i) => {
    if (map.zoneType[i] && !isBuilt(map, i)) tiles.push(i);
  });
  if (!tiles.length) return fail(skipped ? NOT_OWNED : 'No hay zonas aquí');
  return { result: ok(0, tiles.length), apply: () => tiles.forEach((i) => clearZone(map, i)) };
}

function touchesWater(map: GameMap, x: number, y: number, w: number, h: number): boolean {
  for (let ty = y - 1; ty <= y + h; ty++) {
    for (let tx = x - 1; tx <= x + w; tx++) {
      const onRing = tx < x || tx >= x + w || ty < y || ty >= y + h;
      if (onRing && inBounds(map, tx, ty) && map.terrain[tileIndex(map, tx, ty)] === TERRAIN_WATER) return true;
    }
  }
  return false;
}

/** Parques y edificios de una casilla se pueden colocar en serie arrastrando. */
export function canDragPlace(def: BuildingDef): boolean {
  return def.category === 'parks' || (def.size.w === 1 && def.size.h === 1);
}

/** Casillas que ocuparía el edificio en `at`, o el motivo por el que no cabe. */
function footprint(state: GameState, def: BuildingDef, at: Point): number[] | string {
  const { map } = state;
  const { w, h } = def.size;
  const tiles: number[] = [];
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const x = at.x + dx;
      const y = at.y + dy;
      if (!inBounds(map, x, y)) return 'Fuera del mapa';
      if (!ownsTile(state, x, y)) return NOT_OWNED;
      const i = tileIndex(map, x, y);
      if (map.terrain[i] === TERRAIN_WATER) return 'No se puede construir sobre agua';
      if (map.road[i]) return 'Hay una carretera en el camino';
      if (isBuilt(map, i)) return 'Ocupado por otro edificio';
      tiles.push(i);
    }
  }
  if (def.requiresWaterAdjacent && !touchesWater(map, at.x, at.y, w, h)) return 'Debe construirse junto al agua';
  return tiles;
}

function placeOn(state: GameState, def: BuildingDef, at: Point, tiles: number[]): void {
  const { map } = state;
  const id = state.nextBuildingId++;
  state.buildings.set(id, { id, defId: def.id, x: at.x, y: at.y, w: def.size.w, h: def.size.h });
  for (const i of tiles) {
    map.building[i] = id;
    clearZone(map, i);
    clearPowerLine(map, i);
  }
}

function buildingDef(state: GameState, defId: string): BuildingDef | string {
  const def = getBuildingDef(defId);
  if (!def) return 'Edificio desconocido';
  if (!isUnlocked(state, def.unlockAtPopulation)) return `Se desbloquea con ${def.unlockAtPopulation} habitantes`;
  // Los monumentos son únicos
  if (def.monument && [...state.buildings.values()].some((b) => b.defId === def.id)) return 'La ciudad ya tiene este monumento';
  return def;
}

function planBuilding(state: GameState, defId: string, at: Point): Plan {
  const def = buildingDef(state, defId);
  if (typeof def === 'string') return fail(def);
  const tiles = footprint(state, def, at);
  if (typeof tiles === 'string') return fail(tiles);
  return { result: ok(def.cost, 1), apply: () => placeOn(state, def, at, tiles) };
}

/** Varias copias en rejilla: se saltan los huecos donde no caben. */
function planBuildings(state: GameState, defId: string, from: Point, to: Point): Plan {
  const def = buildingDef(state, defId);
  if (typeof def === 'string') return fail(def);
  if (!canDragPlace(def)) return planBuilding(state, defId, to);
  const spots: { at: Point; tiles: number[] }[] = [];
  let reason = '';
  for (const at of gridPositions(normalizeRect(from, to), def.size.w, def.size.h)) {
    const tiles = footprint(state, def, at);
    if (typeof tiles === 'string') reason ||= tiles;
    else spots.push({ at, tiles });
  }
  if (!spots.length) return fail(reason);
  return { result: ok(def.cost * spots.length, spots.length), apply: () => spots.forEach((s) => placeOn(state, def, s.at, s.tiles)) };
}

function planPowerLine(state: GameState, from: Point, to: Point): Plan {
  const { map } = state;
  const toBuild: number[] = [];
  for (const p of roadPath(from, to)) {
    if (!inBounds(map, p.x, p.y)) return fail('Fuera del mapa');
    if (!ownsTile(state, p.x, p.y)) return fail(NOT_OWNED);
    const i = tileIndex(map, p.x, p.y);
    // Carreteras, zonas y edificios ya conducen: el tendido solo se pone en terreno libre (o sobre agua)
    const conducts = map.road[i] || map.zoneType[i] || map.building[i] !== NO_BUILDING;
    if (!conducts && !map.powerLine[i]) toBuild.push(i);
  }
  if (!toBuild.length) return fail('Ya hay conexión eléctrica aquí');
  return {
    result: ok(toBuild.length * POWER_LINE_COST, toBuild.length),
    apply: () => toBuild.forEach((i) => (map.powerLine[i] = 1)),
  };
}

function planPipe(state: GameState, from: Point, to: Point): Plan {
  const { map } = state;
  const toBuild: number[] = [];
  for (const p of roadPath(from, to)) {
    if (!inBounds(map, p.x, p.y)) return fail('Fuera del mapa');
    if (!ownsTile(state, p.x, p.y)) return fail(NOT_OWNED);
    const i = tileIndex(map, p.x, p.y);
    if (!map.waterPipe[i]) toBuild.push(i);
  }
  if (!toBuild.length) return fail('Ya hay tubería');
  return {
    result: ok(toBuild.length * PIPE_COST, toBuild.length),
    apply: () => toBuild.forEach((i) => (map.waterPipe[i] = 1)),
  };
}

function planRemovePipe(state: GameState, rect: Rect): Plan {
  const { map } = state;
  const tiles: number[] = [];
  const skipped = forEachTile(state, rect, (i) => {
    if (map.waterPipe[i]) tiles.push(i);
  });
  if (!tiles.length) return fail(skipped ? NOT_OWNED : 'No hay tuberías aquí');
  return {
    result: ok(tiles.length * BULLDOZE_TILE_COST, tiles.length),
    apply: () => tiles.forEach((i) => (map.waterPipe[i] = 0)),
  };
}

/** Los túneles se desbloquean con la estación de metro. */
const metroUnlock = () => getBuildingDef('metro_station')?.unlockAtPopulation ?? 0;

function planMetro(state: GameState, from: Point, to: Point): Plan {
  const { map } = state;
  if (!isUnlocked(state, metroUnlock())) return fail(`Se desbloquea con ${metroUnlock().toLocaleString('es-ES')} habitantes`);
  const toBuild: number[] = [];
  for (const p of roadPath(from, to)) {
    if (!inBounds(map, p.x, p.y)) return fail('Fuera del mapa');
    if (!ownsTile(state, p.x, p.y)) return fail(NOT_OWNED);
    const i = tileIndex(map, p.x, p.y);
    if (!map.metro[i]) toBuild.push(i);
  }
  if (!toBuild.length) return fail('Ya hay túnel de metro');
  return {
    result: ok(toBuild.length * METRO_TUNNEL_COST, toBuild.length),
    apply: () => toBuild.forEach((i) => (map.metro[i] = 1)),
  };
}

function planRemoveMetro(state: GameState, rect: Rect): Plan {
  const { map } = state;
  const tiles: number[] = [];
  const skipped = forEachTile(state, rect, (i) => {
    if (map.metro[i]) tiles.push(i);
  });
  if (!tiles.length) return fail(skipped ? NOT_OWNED : 'No hay túneles aquí');
  return {
    result: ok(tiles.length * BULLDOZE_TILE_COST, tiles.length),
    apply: () => tiles.forEach((i) => (map.metro[i] = 0)),
  };
}

function planTax(state: GameState, zone: ZoneType, rate: number): Plan {
  if (!Number.isInteger(rate) || rate < TAX_MIN || rate > TAX_MAX) return fail(`El impuesto va de ${TAX_MIN}% a ${TAX_MAX}%`);
  return { result: ok(0, 1), apply: () => void (state.economy.taxes[zone] = rate) };
}

function planFunding(state: GameState, dept: DepartmentId, value: number): Plan {
  if (!DEPARTMENT_IDS.includes(dept)) return fail('Departamento desconocido');
  if (!Number.isInteger(value) || value < FUNDING_MIN || value > FUNDING_MAX || value % FUNDING_STEP !== 0) {
    return fail(`La financiación va del ${FUNDING_MIN} % al ${FUNDING_MAX} %, de ${FUNDING_STEP} en ${FUNDING_STEP}`);
  }
  return { result: ok(0, 1), apply: () => void (state.economy.funding[dept] = value) };
}

function planOrdinance(state: GameState, id: string): Plan {
  const def = getOrdinance(id);
  if (!def) return fail('Ordenanza desconocida');
  const active = state.economy.ordinances;
  if (active.includes(id)) return { result: ok(0, 1), apply: () => void (state.economy.ordinances = active.filter((o) => o !== id)) };
  if (!isUnlocked(state, def.unlockAtPopulation)) return fail(`Se desbloquea con ${def.unlockAtPopulation.toLocaleString('es-ES')} habitantes`);
  if (active.length >= MAX_ORDINANCES) return fail(`Como máximo ${MAX_ORDINANCES} ordenanzas a la vez`);
  return { result: ok(0, 1), apply: () => void active.push(id) };
}

/** Nombre limpio de un distrito, o el motivo por el que no vale. */
function districtName(state: GameState, raw: string, ignoreId?: number): { name: string } | { error: string } {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) return { error: 'El distrito necesita un nombre' };
  if (name.length > DISTRICT_NAME_MAX) return { error: `El nombre admite hasta ${DISTRICT_NAME_MAX} letras` };
  if (state.districts.some((d) => d.id !== ignoreId && d.name.toLowerCase() === name.toLowerCase())) return { error: 'Ya hay un distrito con ese nombre' };
  return { name };
}

function planCreateDistrict(state: GameState, rect: Rect, requested?: string): Plan {
  const { map } = state;
  if (state.districts.length >= MAX_DISTRICTS) return fail(`Como máximo ${MAX_DISTRICTS} distritos`);
  const r = clipRect(rect, map.width, map.height);
  if (!r) return fail('Fuera del mapa');
  if ((r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) < 4) return fail('El distrito debe tener al menos 4 casillas');
  let name = requested;
  if (name === undefined) {
    // Nombre por defecto: el del barrio del centro; si ya está cogido, «Distrito N»
    const base = autoNeighborhoodName(state, Math.floor((r.x0 + r.x1) / 2), Math.floor((r.y0 + r.y1) / 2));
    name = base;
    for (let k = 2; state.districts.some((d) => d.name.toLowerCase() === name!.toLowerCase()); k++) name = `${base} ${k}`;
    name = name.slice(0, DISTRICT_NAME_MAX);
  }
  const checked = districtName(state, name);
  if ('error' in checked) return fail(checked.error);
  return {
    result: ok(0, 1),
    apply: () => {
      state.districts.push({ id: state.nextDistrictId++, name: checked.name, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 });
    },
  };
}

function planRenameDistrict(state: GameState, id: number, raw: string): Plan {
  const district = state.districts.find((d) => d.id === id);
  if (!district) return fail('Distrito no encontrado');
  const checked = districtName(state, raw, id);
  if ('error' in checked) return fail(checked.error);
  return { result: ok(0, 1), apply: () => void (district.name = checked.name) };
}

function planRemoveDistrict(state: GameState, id: number): Plan {
  if (!state.districts.some((d) => d.id === id)) return fail('Distrito no encontrado');
  return { result: ok(0, 1), apply: () => void (state.districts = state.districts.filter((d) => d.id !== id)) };
}

function planLoan(state: GameState, amount: number): Plan {
  const economy = state.economy;
  if (state.sandbox) return fail('En el modo libre el dinero es ilimitado');
  if (!(LOAN_AMOUNTS as readonly number[]).includes(amount)) return fail('Importe de préstamo no disponible');
  if (economy.loans.length >= MAX_LOANS) return fail(`Como máximo ${MAX_LOANS} préstamos a la vez`);
  return {
    result: ok(0, 1),
    apply: () => {
      economy.money += amount;
      economy.loans.push({ id: economy.nextLoanId++, amount, balance: amount, monthlyPayment: loanPayment(amount), monthsLeft: LOAN_MONTHS });
    },
  };
}

/** Saldar un préstamo por adelantado: se paga el capital pendiente, sin más intereses. */
function planRepay(state: GameState, loanId: number): Plan {
  const economy = state.economy;
  const loan = economy.loans.find((l) => l.id === loanId);
  if (!loan) return fail('Préstamo no encontrado');
  return {
    result: ok(Math.ceil(loan.balance), 1),
    apply: () => {
      economy.loans = economy.loans.filter((l) => l !== loan);
      state.progress.loansClosed++;
    },
  };
}

function planBuyPlot(state: GameState, at: Point): Plan {
  const { land } = state;
  if (!land) return fail('En esta partida todo el terreno es tuyo');
  if (!inBounds(state.map, at.x, at.y)) return fail('Fuera del mapa');
  const plot = plotAt(land, at.x, at.y);
  const blocker = plotBlocker(state, plot);
  if (blocker) return fail(blocker);
  return {
    result: ok(nextPlotCost(state), 1),
    apply: () => {
      land.owned[plot] = 1;
      state.progress.plotsBought++;
    },
  };
}

function planDecide(state: GameState, choice: number): Plan {
  const pending = state.incidents.pending;
  if (!pending) return fail('No hay ninguna decisión pendiente');
  const c = getIncident(pending.id)?.choices[choice];
  if (!c) return fail('Opción desconocida');
  return {
    result: ok(c.cost?.(state, pending.data) ?? 0, 1),
    apply: () => {
      state.incidents.pending = null;
      state.incidents.resolved++;
      return c.apply(state, pending.data);
    },
  };
}

export function removeBuilding(state: GameState, id: number): void {
  const b = state.buildings.get(id);
  if (!b) return;
  const { map } = state;
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) map.building[tileIndex(map, x, y)] = NO_BUILDING;
  state.buildings.delete(id);
}

/**
 * Editor de terreno: solo cambia casillas libres (sin calle, edificio ni lote construido). Excavar quita la
 * zona y el tendido que hubiera; las tuberías y los túneles, que van bajo tierra, se quedan.
 */
function planTerraform(state: GameState, rect: Rect, to: 'land' | 'water'): Plan {
  const { map } = state;
  const target = to === 'water' ? TERRAIN_WATER : TERRAIN_LAND;
  const tiles: number[] = [];
  let blocked = 0;
  const skipped = forEachTile(state, rect, (i) => {
    if (map.terrain[i] === target) return;
    if (map.road[i] || isBuilt(map, i)) blocked++;
    else tiles.push(i);
  });
  if (!tiles.length) {
    if (blocked) return fail('Hay calles o edificios: demuélelos antes de cambiar el terreno');
    if (skipped) return fail(NOT_OWNED);
    return fail(to === 'water' ? 'Ya es agua' : 'Ya es tierra');
  }
  const cost = tiles.length * (to === 'water' ? TERRAFORM_DIG_COST : TERRAFORM_FILL_COST);
  return {
    result: ok(cost, tiles.length),
    apply: () => {
      for (const i of tiles) {
        map.terrain[i] = target;
        if (to === 'water') {
          clearZone(map, i);
          clearPowerLine(map, i);
        }
      }
    },
  };
}

function planBulldoze(state: GameState, rect: Rect): Plan {
  const { map } = state;
  const roads: number[] = [];
  const lots: number[] = [];
  const zones: number[] = [];
  const lines: number[] = [];
  const ids = new Set<number>();
  // Demoler un edificio de zona deja la zona: volverá a crecer si hay demanda (como en SimCity)
  const skipped = forEachTile(state, rect, (i) => {
    if (map.road[i]) roads.push(i);
    else if (map.building[i] !== NO_BUILDING) ids.add(map.building[i]);
    else if (map.lotLevel[i]) lots.push(i);
    else if (map.zoneType[i]) zones.push(i);
    else if (map.powerLine[i]) lines.push(i);
  });
  if (!roads.length && !lots.length && !zones.length && !lines.length && !ids.size) return fail(skipped ? NOT_OWNED : 'Nada que demoler');
  const cost =
    (roads.length + lines.length) * BULLDOZE_TILE_COST + lots.length * BULLDOZE_LOT_COST + ids.size * BULLDOZE_BUILDING_COST;
  return {
    result: ok(cost, roads.length + lots.length + zones.length + lines.length + ids.size),
    apply: () => {
      for (const i of roads) map.road[i] = 0;
      for (const i of lines) clearPowerLine(map, i);
      for (const i of lots) clearLot(map, i);
      for (const i of zones) clearZone(map, i);
      for (const id of ids) removeBuilding(state, id);
    },
  };
}
