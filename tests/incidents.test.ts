import { describe, expect, it } from 'vitest';
import { AutoPlayer } from '../src/sim/autoplayer';
import { applyCommand } from '../src/sim/commands';
import { FIRE_BURN_DAYS, OUTAGE_CAPACITY } from '../src/sim/config';
import { INCIDENTS, getIncident, shoreLots } from '../src/sim/data/incidents';
import { ZONE_CODE } from '../src/sim/data/zones';
import { effectDemand, effectWaterDemand } from '../src/sim/effects';
import { SAVE_VERSION, deserialize, serialize } from '../src/sim/save';
import { refreshDerived, tick } from '../src/sim/simulation';
import { type GameState, createGame, tileIndex } from '../src/sim/state';
import { estimateBudget } from '../src/sim/systems/economy';
import { updateIncidents } from '../src/sim/systems/incidents';
import { UndoHistory } from '../src/sim/undo';
import { TERRAIN_WATER } from '../src/sim/types';

/** Una manzana de 6 × 4 lotes de nivel 1 sin carreteras en medio, para ver cómo corre el fuego. */
function block(level = 2) {
  const s = createGame({ width: 20, height: 20, flat: true, incidents: level });
  for (let y = 5; y < 9; y++) {
    for (let x = 5; x < 11; x++) {
      const i = tileIndex(s.map, x, y);
      s.map.zoneType[i] = ZONE_CODE.R;
      s.map.zoneDensity[i] = 1;
      s.map.lotLevel[i] = 1;
      s.map.lotOccupants[i] = 5;
    }
  }
  return s;
}

const burning = (s: GameState) => s.map.fire.reduce((n, v) => n + (v ? 1 : 0), 0);
const built = (s: GameState) => s.map.lotLevel.reduce((n, v) => n + (v ? 1 : 0), 0);
const quietDay = (s: GameState) => updateIncidents(s, []);

describe('incendios', () => {
  it('sin bomberos el fuego se propaga y destruye; con la zona intacta para reconstruir', () => {
    const s = block();
    s.rng = 7;
    const i = tileIndex(s.map, 7, 6);
    s.map.fire[i] = 1;
    s.incidents.burning = 1;
    for (let d = 0; d < 30; d++) quietDay(s);
    expect(s.map.lotLevel[i]).toBe(0);
    expect(s.map.zoneType[i]).toBe(ZONE_CODE.R);
    expect(built(s)).toBeLessThan(24 - 1);
    expect(burning(s)).toBe(0);
  });

  it('con cobertura completa se apaga pronto y no pasa a los vecinos', () => {
    const s = block();
    s.layers.coverage.fire.fill(100);
    const i = tileIndex(s.map, 7, 6);
    s.map.fire[i] = 1;
    s.incidents.burning = 1;
    for (let d = 0; d < FIRE_BURN_DAYS + 2; d++) quietDay(s);
    expect(burning(s)).toBe(0);
    expect(built(s)).toBeGreaterThanOrEqual(23);
  });

  it('al apagarse avisa de cuántos edificios se perdieron', () => {
    const s = block();
    const i = tileIndex(s.map, 7, 6);
    s.map.fire[i] = FIRE_BURN_DAYS;
    s.incidents.burning = 1;
    s.layers.coverage.fire.fill(100); // nada más se propaga, pero este ya no tiene salvación si no se apaga hoy
    const events: ReturnType<typeof tick> = [];
    for (let d = 0; d < 3 && !events.some((e) => e.type === 'fireOver'); d++) updateIncidents(s, events);
    expect(events.find((e) => e.type === 'fireOver')).toBeDefined();
  });

  it('demoler un edificio en llamas lo apaga (cortafuegos) y deshacerlo lo devuelve tal cual', () => {
    const s = block();
    s.economy.money = 10_000;
    const i = tileIndex(s.map, 7, 6);
    s.map.fire[i] = 2;
    const h = new UndoHistory();
    h.run(s, { type: 'bulldoze', rect: { x0: 7, y0: 6, x1: 7, y1: 6 } });
    expect(s.map.fire[i]).toBe(0);
    h.undo(s);
    expect(s.map.fire[i]).toBe(2);
  });

  it('sin eventos (nivel 0) no hay incendios nunca', () => {
    const s = block(0);
    for (let d = 0; d < 2_000; d++) quietDay(s);
    expect(s.incidents.fires).toBe(0);
  });

  it('con riesgo alto acaban declarándose incendios, sobre todo donde no hay bomberos', () => {
    const s = block(3);
    let fires = 0;
    for (let d = 0; d < 20_000 && fires < 3; d++) {
      const events: ReturnType<typeof tick> = [];
      updateIncidents(s, events);
      fires += events.filter((e) => e.type === 'fire').length;
      // Reconstruir lo quemado para que siga habiendo riesgo
      for (let k = 0; k < s.map.lotLevel.length; k++) if (s.map.zoneType[k] && !s.map.lotLevel[k]) s.map.lotLevel[k] = 1;
    }
    expect(fires).toBeGreaterThan(0);
  });
});

describe('eventos con decisión', () => {
  it('todos tienen una opción gratis y textos para cada opción', () => {
    const s = createGame({ width: 16, height: 16, flat: true });
    for (const def of INCIDENTS) {
      expect(def.choices.some((c) => !c.cost)).toBe(true);
      for (const c of def.choices) expect(c.detail(s, { cost: 100, amount: 100, lots: 10, building: 1 })).not.toBe('');
    }
  });

  it('decidir aplica la opción, cobra y caduca al pasar los meses', () => {
    const s = createGame({ width: 16, height: 16, flat: true, incidents: 2, money: 10_000 });
    s.incidents.pending = { id: 'recesion', data: { cost: 2_000 } };
    expect(applyCommand(s, { type: 'decide', choice: 9 }).ok).toBe(false);
    const r = applyCommand(s, { type: 'decide', choice: 2 });
    expect(r).toMatchObject({ ok: true, cost: 0 });
    expect(s.incidents.pending).toBeNull();
    expect(effectDemand(s, 'C')).toBeCloseTo(-0.25);
    expect(applyCommand(s, { type: 'decide', choice: 0 }).ok).toBe(false); // ya no hay nada pendiente
    for (let d = 0; d < 6 * 30; d++) tick(s);
    expect(s.incidents.effects).toEqual([]);
  });

  it('la opción de pago se cobra y no se puede elegir sin fondos', () => {
    const s = createGame({ width: 16, height: 16, flat: true, incidents: 2, money: 1_000 });
    s.incidents.pending = { id: 'ola-calor', data: { cost: 1_500 } };
    expect(applyCommand(s, { type: 'decide', choice: 0 })).toMatchObject({ ok: false, reason: 'Fondos insuficientes' });
    s.economy.money = 2_000;
    expect(applyCommand(s, { type: 'decide', choice: 0 }).ok).toBe(true);
    expect(s.economy.money).toBe(500);
    expect(effectWaterDemand(s)).toBe(1);
  });

  it('los efectos llegan a los sistemas: consumo de agua y recaudación', () => {
    const s = createGame({ width: 16, height: 16, flat: true, incidents: 2 });
    s.incidents.pending = { id: 'recesion', data: { cost: 1 } };
    const before = { ...estimateBudget(s).income };
    for (let i = 0; i < 4; i++) {
      s.map.zoneType[i] = ZONE_CODE.C;
      s.map.lotLevel[i] = 1;
      s.map.lotOccupants[i] = 10;
    }
    const full = estimateBudget(s).income.C;
    applyCommand(s, { type: 'decide', choice: 1 }); // rebajar impuestos a las empresas
    expect(estimateBudget(s).income.C).toBeCloseTo(full * 0.6);
    expect(before.R).toBe(0);
  });

  it('la inundación daña solo edificios de la orilla', () => {
    const s = block();
    for (let x = 0; x < 20; x++) s.map.terrain[tileIndex(s.map, x, 4)] = TERRAIN_WATER;
    const shore = shoreLots(s);
    expect(shore.length).toBe(6);
    s.incidents.pending = { id: 'lluvias', data: { cost: 100, lots: shore.length } };
    const r = applyCommand(s, { type: 'decide', choice: 1 });
    expect(r.message).toMatch(/inundación|agua/);
    for (let y = 6; y < 9; y++) for (let x = 5; x < 11; x++) expect(s.map.lotLevel[tileIndex(s.map, x, y)]).toBe(1);
  });

  it('al cerrar el mes llegan eventos y no se acumulan mientras hay uno pendiente', () => {
    const s = createGame({ width: 32, height: 32, flat: true, incidents: 3 });
    s.stats.population = 2_000;
    s.time.month = 6;
    s.incidents.cooldown = 0;
    let decisions = 0;
    for (let k = 0; k < 40; k++) {
      const events: ReturnType<typeof tick> = [{ type: 'newMonth', month: 6, year: 2000 }];
      updateIncidents(s, events);
      decisions += events.filter((e) => e.type === 'decision').length;
      if (decisions) break;
      s.incidents.cooldown = 0;
    }
    expect(decisions).toBe(1);
    const id = s.incidents.pending!.id;
    expect(getIncident(id)).toBeDefined();
    const events: ReturnType<typeof tick> = [{ type: 'newMonth', month: 7, year: 2000 }];
    updateIncidents(s, events);
    expect(events.some((e) => e.type === 'decision')).toBe(false);
  });
});

describe('averías', () => {
  it('una central averiada rinde al 40 % hasta que se repara', () => {
    const s = createGame({ width: 24, height: 24, flat: true, incidents: 2, money: 100_000 });
    applyCommand(s, { type: 'placeBuilding', defId: 'coal_plant', at: { x: 2, y: 2 } });
    refreshDerived(s);
    expect(s.utilities.power.production).toBe(150);
    s.incidents.pending = getIncident('averia')!.prepare(s) && { id: 'averia', data: getIncident('averia')!.prepare(s)! };
    applyCommand(s, { type: 'decide', choice: 0 }); // urgente: 3 días
    refreshDerived(s);
    expect(s.utilities.power.production).toBe(150 * OUTAGE_CAPACITY);
    const events: ReturnType<typeof tick> = [];
    for (let d = 0; d < 3; d++) updateIncidents(s, events);
    expect(events.some((e) => e.type === 'repaired')).toBe(true);
    refreshDerived(s);
    expect(s.utilities.power.production).toBe(150);
  });
});

describe('guardado de la fase 17', () => {
  it('conserva incendios, efectos, averías y la decisión pendiente', () => {
    const s = block();
    s.map.fire[tileIndex(s.map, 6, 6)] = 3;
    s.incidents.effects = [{ id: 'festival', label: 'Festival', monthsLeft: 2, happiness: 8 }];
    s.incidents.pending = { id: 'festival', data: { cost: 900 } };
    const data = serialize(s);
    expect(data.version).toBe(SAVE_VERSION);
    const loaded = deserialize(JSON.parse(JSON.stringify(data)));
    expect(loaded.map.fire[tileIndex(s.map, 6, 6)]).toBe(3);
    expect(loaded.incidents).toEqual(s.incidents);
  });

  it('las partidas v2 se cargan sin incendios ni eventos', () => {
    const data = JSON.parse(JSON.stringify(serialize(block())));
    data.version = 2;
    delete data.state.map.layers.fire;
    delete data.state.incidents;
    const loaded = deserialize(data);
    expect(loaded.incidents.level).toBe(0);
    expect(loaded.map.fire.every((v: number) => v === 0)).toBe(true);
  });
});

describe('una ciudad con eventos y desastres', () => {
  it('el jugador automático sigue creciendo con eventos normales', () => {
    const s = createGame({ width: 128, height: 128, flat: true, seed: 3, incidents: 2 });
    const bot = new AutoPlayer(s);
    bot.run(6 * 360);
    expect(s.economy.bankrupt).toBe(false);
    expect(s.stats.population).toBeGreaterThan(2_000);
    expect(s.incidents.recent.length).toBeGreaterThan(0);
  }, 60_000);
});
