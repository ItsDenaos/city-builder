import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands';
import { GARBAGE_BUILDUP, GARBAGE_PER_OCCUPANT, WORKFORCE_RATIO } from '../src/sim/config';
import { getTopic } from '../src/sim/data/agora';
import { ACHIEVEMENTS } from '../src/sim/data/achievements';
import { getBuildingDef } from '../src/sim/data/buildings';
import { SAVE_VERSION, deserialize, serialize } from '../src/sim/save';
import { createScenario } from '../src/sim/scenarios';
import { refreshDerived, tick } from '../src/sim/simulation';
import { type GameState, createGame, tileIndex } from '../src/sim/state';
import { estimateBudget } from '../src/sim/systems/economy';
import { collectGarbage, facilityProblem } from '../src/sim/systems/garbage';
import { sicknessPenalty } from '../src/sim/systems/health';
import type { SimEvent } from '../src/sim/types';
import { UndoHistory } from '../src/sim/undo';

const roundTrip = (s: GameState) => deserialize(JSON.parse(JSON.stringify(serialize(s))));
const idx = (s: GameState, x: number, y: number) => tileIndex(s.map, x, y);
const days = (s: GameState, n: number, events: SimEvent[] = []) => {
  for (let d = 0; d < n; d++) collectGarbage(s, events);
};
const buildingAt = (s: GameState, x: number, y: number) => s.buildings.get(s.map.building[idx(s, x, y)])!;

/**
 * Pueblo de prueba: una calle por y = 10 y viviendas llenas a los dos lados en x 2-8 (42 lotes).
 * La central de carbón toca la calle en el este (las calles conducen la electricidad).
 * La recogida se prueba llamando a collectGarbage, sin el resto del día (crecimiento, mudanzas...).
 */
function town(opts: { sanitation?: boolean; residents?: number } = {}): GameState {
  const s = createGame({ width: 64, height: 64, flat: true, money: 1_000_000, seed: 9, sanitation: opts.sanitation ?? true });
  s.progress.peakPopulation = 100_000;
  applyCommand(s, { type: 'buildRoad', from: { x: 0, y: 10 }, to: { x: 60, y: 10 } });
  for (const [y0, y1] of [[7, 9], [11, 13]]) {
    applyCommand(s, { type: 'zone', rect: { x0: 2, y0, x1: 8, y1 }, zone: 'R', density: 'low' });
    for (let y = y0; y <= y1; y++) for (let x = 2; x <= 8; x++) [s.map.lotLevel[idx(s, x, y)], s.map.lotOccupants[idx(s, x, y)]] = [1, opts.residents ?? 10];
  }
  applyCommand(s, { type: 'placeBuilding', defId: 'coal_plant', at: { x: 50, y: 11 } });
  refreshDerived(s);
  return s;
}
const landfill = (s: GameState, x = 20) => applyCommand(s, { type: 'placeBuilding', defId: 'landfill', at: { x, y: 11 } });

describe('basura', () => {
  it('sin basura y salud en la partida no se acumula nada', () => {
    const s = town({ sanitation: false });
    days(s, 30);
    expect(s.map.garbage.every((g) => g === 0)).toBe(true);
    expect(s.stats.garbage.produced).toBe(0);
  });

  it('sin recogida se acumula, y más deprisa donde vive más gente', () => {
    const s = town();
    const tower = idx(s, 2, 7);
    s.map.lotOccupants[tower] = 120;
    days(s, 5);
    const house = s.map.garbage[idx(s, 3, 7)];
    expect(house).toBeCloseTo(5 * 10 * GARBAGE_PER_OCCUPANT.R * GARBAGE_BUILDUP, 4);
    expect(s.map.garbage[tower]).toBeGreaterThan(house * 10);
    expect(s.stats.garbage.produced).toBeCloseTo((41 * 10 + 120) * GARBAGE_PER_OCCUPANT.R, 4);
    days(s, 200);
    expect(s.map.garbage[tower]).toBe(100);
  });

  it('un vertedero recoge lo que alcanza y limpia lo acumulado', () => {
    const s = town();
    days(s, 30);
    expect(s.map.garbage[idx(s, 5, 8)]).toBeGreaterThan(0);
    expect(landfill(s).ok).toBe(true);
    refreshDerived(s);
    days(s, 30);
    expect(s.map.garbage.every((g) => g === 0)).toBe(true);
    expect(s.stats.garbage.collected).toBeCloseTo(s.stats.garbage.produced, 4);
    expect(buildingAt(s, 20, 11).stored).toBeGreaterThan(0);
  });

  it('con poca capacidad recoge primero lo más cercano', () => {
    const s = town({ residents: 100 });
    landfill(s);
    applyCommand(s, { type: 'setFunding', dept: 'waste', value: 50 });
    refreshDerived(s);
    days(s, 20);
    const g = s.stats.garbage;
    expect(g.capacity).toBeCloseTo(getBuildingDef('landfill')!.garbage!.collect * 0.5);
    expect(g.collected).toBeLessThanOrEqual(g.capacity);
    expect(g.produced).toBeGreaterThan(g.capacity);
    // El vertedero está al este: los lotes de x = 8 se recogen y los de x = 2 no
    expect(s.map.garbage[idx(s, 8, 9)]).toBe(0);
    expect(s.map.garbage[idx(s, 2, 7)]).toBeGreaterThan(50);
  });

  it('los camiones no pasan de su radio', () => {
    const s = town();
    landfill(s, 44); // a más de 32 casillas de las viviendas del oeste
    refreshDerived(s);
    days(s, 20);
    expect(s.stats.garbage.collected).toBe(0);
    expect(s.stats.garbage.dirtyShare).toBe(0); // aún no han llegado a 50
  });

  it('un vertedero lleno deja de recoger y avisa una vez', () => {
    const s = town();
    landfill(s);
    refreshDerived(s);
    const b = buildingAt(s, 20, 11);
    b.stored = getBuildingDef('landfill')!.garbage!.storage! - 1;
    const events: SimEvent[] = [];
    days(s, 3, events);
    expect(events.filter((e) => e.type === 'landfillFull')).toHaveLength(1);
    expect(facilityProblem(s, b)).toBe('Lleno');
    expect(s.stats.garbage.capacity).toBe(0);
  });

  it('las instalaciones necesitan calle y, si consumen, electricidad', () => {
    const s = town();
    applyCommand(s, { type: 'placeBuilding', defId: 'landfill', at: { x: 30, y: 40 } });
    applyCommand(s, { type: 'placeBuilding', defId: 'recycling_center', at: { x: 30, y: 11 } });
    refreshDerived(s);
    expect(facilityProblem(s, buildingAt(s, 30, 40))).toMatch(/calle/);
    expect(facilityProblem(s, buildingAt(s, 30, 11))).toBeNull();
    applyCommand(s, { type: 'bulldoze', rect: { x0: 50, y0: 11, x1: 53, y1: 14 } });
    refreshDerived(s);
    expect(facilityProblem(s, buildingAt(s, 30, 11))).toMatch(/electricidad/);
  });

  it('la recogida selectiva produce menos basura y la financiación cambia la capacidad y el gasto', () => {
    const s = town();
    landfill(s);
    refreshDerived(s);
    days(s, 1);
    const before = s.stats.garbage.produced;
    applyCommand(s, { type: 'toggleOrdinance', id: 'recycling_program' });
    days(s, 1);
    expect(s.stats.garbage.produced).toBeCloseTo(before * 0.75, 4);
    const upkeep = getBuildingDef('landfill')!.upkeep;
    applyCommand(s, { type: 'setFunding', dept: 'waste', value: 150 });
    days(s, 1);
    expect(s.stats.garbage.capacity).toBeCloseTo(getBuildingDef('landfill')!.garbage!.collect * 1.5);
    expect(estimateBudget(s).departments.waste).toBeCloseTo(upkeep * 1.5);
    expect(estimateBudget(s).expenses.waste).toBeCloseTo(upkeep * 1.5);
  });

  it('demoler un lote se lleva su basura, y deshacerlo la devuelve', () => {
    const s = town();
    const i = idx(s, 5, 8);
    s.map.garbage[i] = 60;
    const h = new UndoHistory();
    expect(h.run(s, { type: 'bulldoze', rect: { x0: 5, y0: 8, x1: 5, y1: 8 } }).ok).toBe(true);
    expect(s.map.garbage[i]).toBe(0);
    expect(h.undo(s).ok).toBe(true);
    expect(s.map.garbage[i]).toBe(60);
  });
});

describe('salud', () => {
  it('la basura acumulada quita felicidad, valor del suelo y salud por encima de un mínimo', () => {
    const clean = town();
    const dirty = town();
    for (let i = 0; i < dirty.map.garbage.length; i++) if (dirty.map.lotLevel[i]) dirty.map.garbage[i] = 100;
    const little = town();
    for (let i = 0; i < little.map.garbage.length; i++) if (little.map.lotLevel[i]) little.map.garbage[i] = 15;
    // Impuesto residencial a 0 para que la felicidad de partida no esté pegada al mínimo
    for (const s of [clean, dirty, little]) {
      applyCommand(s, { type: 'setTaxRate', zone: 'R', rate: 0 });
      refreshDerived(s);
    }
    expect(clean.layers.happiness[idx(clean, 5, 8)]).toBeGreaterThan(12);
    const i = idx(clean, 5, 8);
    expect(dirty.layers.happiness[i]).toBeLessThan(clean.layers.happiness[i] - 10);
    expect(dirty.layers.landValue[i]).toBeLessThan(clean.layers.landValue[i]);
    expect(dirty.layers.health[i]).toBeLessThan(clean.layers.health[i]);
    // Un poco de basura no molesta
    expect(little.layers.happiness[i]).toBeCloseTo(clean.layers.happiness[i], 4);
  });

  it('con salud baja hay enfermos, que no trabajan', () => {
    const s = town();
    for (let i = 0; i < s.map.garbage.length; i++) if (s.map.lotLevel[i]) s.map.garbage[i] = 100;
    refreshDerived(s);
    refreshDerived(s); // la población activa usa los enfermos del día anterior
    expect(s.stats.health.sick).toBeGreaterThan(0);
    expect(s.layers.sick[idx(s, 5, 8)]).toBeGreaterThan(0);
    expect(s.stats.workforce).toBeLessThan(Math.floor(s.stats.population * WORKFORCE_RATIO));
  });

  it('sin basura y salud en la partida nadie enferma (pero la salud se calcula)', () => {
    const s = town({ sanitation: false });
    for (let i = 0; i < s.map.garbage.length; i++) if (s.map.lotLevel[i]) s.map.garbage[i] = 100;
    refreshDerived(s);
    expect(s.stats.health.sick).toBe(0);
    expect(s.layers.health[idx(s, 5, 8)]).toBeLessThan(40);
  });

  it('las clínicas dan camas, y estar enfermo sin cama hace más daño', () => {
    const s = town();
    applyCommand(s, { type: 'placeBuilding', defId: 'clinic', at: { x: 12, y: 11 } });
    refreshDerived(s);
    expect(s.stats.health.beds).toBe(getBuildingDef('clinic')!.beds);
    const i = idx(s, 5, 8);
    s.layers.sick[i] = 0.1;
    s.stats.health = { ...s.stats.health, sick: 50, treated: 50 };
    const treated = sicknessPenalty(s, i);
    s.stats.health = { ...s.stats.health, sick: 50, treated: 0 };
    expect(sicknessPenalty(s, i)).toBeGreaterThan(treated);
    expect(treated).toBeGreaterThan(0);
  });
});

describe('vecinos, logros y escenarios', () => {
  it('los vecinos piden recogida de basura y la petición se cumple al limpiar', () => {
    const s = town();
    const i = idx(s, 5, 8);
    s.map.garbage[i] = 60;
    const topic = getTopic('basura')!;
    expect(topic.detect(s, i)).toBe(true);
    expect(topic.petition!.goal(s, i).done).toBe(false);
    s.map.garbage[i] = 5;
    expect(topic.petition!.goal(s, i).done).toBe(true);
    s.sanitation = false;
    s.map.garbage[i] = 60;
    expect(topic.detect(s, i)).toBe(false);
  });

  it('el logro «Ciudad limpia» pide 5.000 habitantes sin lotes sucios', () => {
    const s = town();
    const def = ACHIEVEMENTS.find((a) => a.id === 'ciudad-limpia')!;
    s.stats.population = 5_000;
    s.stats.garbage = { ...s.stats.garbage, dirtyShare: 0.01 };
    expect(def.check(s)).toBe(false);
    s.stats.garbage = { ...s.stats.garbage, dirtyShare: 0 };
    expect(def.check(s)).toBe(true);
  });

  it('los escenarios tienen basura y salud', () => {
    expect(createScenario('contrarreloj').sanitation).toBe(true);
  });
});

describe('guardado de la fase 14', () => {
  it('conserva la basura y los vertederos, y la partida cargada sigue igual', () => {
    const s = town();
    landfill(s, 44);
    applyCommand(s, { type: 'placeBuilding', defId: 'clinic', at: { x: 12, y: 11 } });
    for (let d = 0; d < 90; d++) tick(s);
    const loaded = roundTrip(s);
    expect(loaded.sanitation).toBe(true);
    expect(loaded.map.garbage).toEqual(s.map.garbage);
    expect(buildingAt(loaded, 44, 11).stored).toBe(buildingAt(s, 44, 11).stored);
    for (let d = 0; d < 60; d++) {
      tick(s);
      tick(loaded);
    }
    expect(loaded.stats).toEqual(s.stats);
    expect(loaded.map.garbage).toEqual(s.map.garbage);
  });

  it('migra una partida v5: con basura y salud activadas y sin basura acumulada', () => {
    const s = town({ sanitation: false });
    const data = JSON.parse(JSON.stringify(serialize(s)));
    data.version = 5;
    delete data.state.sanitation;
    delete data.state.map.layers.garbage;
    delete data.state.stats.garbage;
    delete data.state.stats.health;
    delete data.state.economy.funding.waste;
    const loaded = deserialize(data);
    expect(loaded.sanitation).toBe(true);
    expect(loaded.map.garbage.every((g) => g === 0)).toBe(true);
    expect(loaded.economy.funding.waste).toBe(100);
    expect(loaded.stats.health.sick).toBe(0);
    expect(Number.isFinite(loaded.stats.workforce)).toBe(true);
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(6);
  });
});
