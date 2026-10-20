import { describe, expect, it } from 'vitest';
import { toolCommand, toolPreviewTiles } from '../src/input/tools';
import { applyCommand } from '../src/sim/commands';
import { UNDO_MAX_DAYS } from '../src/sim/config';
import { getBuildingDef } from '../src/sim/data/buildings';
import { ZONE_CODE, getZoneDef } from '../src/sim/data/zones';
import { deserialize, serialize } from '../src/sim/save';
import { tick } from '../src/sim/simulation';
import { NO_BUILDING, createGame, tileIndex } from '../src/sim/state';
import { UndoHistory } from '../src/sim/undo';
import { roadStrip } from '../src/sim/zoning';
import { TERRAIN_WATER } from '../src/sim/types';

const newGame = (money = 100_000) => createGame({ width: 24, height: 24, flat: true, money });
const at = (s: ReturnType<typeof newGame>, x: number, y: number) => tileIndex(s.map, x, y);
const street = (s: ReturnType<typeof newGame>, y: number) => applyCommand(s, { type: 'buildRoad', from: { x: 0, y }, to: { x: 23, y } });

describe('zonificar en franjas', () => {
  it('solo zonifica a la distancia pedida de una calle', () => {
    const s = newGame();
    street(s, 10);
    const r = applyCommand(s, { type: 'zone', rect: { x0: 0, y0: 0, x1: 23, y1: 23 }, zone: 'R', density: 'low', strip: 2 });
    // Dos filas a cada lado de la calle, de 24 casillas
    expect(r).toMatchObject({ ok: true, affected: 4 * 24 });
    expect(s.map.zoneType[at(s, 5, 8)]).toBe(ZONE_CODE.R);
    expect(s.map.zoneType[at(s, 5, 12)]).toBe(ZONE_CODE.R);
    expect(s.map.zoneType[at(s, 5, 7)]).toBe(0);
    expect(s.map.zoneType[at(s, 5, 13)]).toBe(0);
  });

  it('cuenta las calles que quedan fuera del rectángulo y no cruza el agua', () => {
    const s = newGame();
    street(s, 10);
    for (let x = 0; x < 24; x++) s.map.terrain[at(s, x, 12)] = TERRAIN_WATER;
    const near = roadStrip(s, { x0: 0, y0: 11, x1: 23, y1: 14 }, 3);
    expect(near.has(at(s, 3, 11))).toBe(true);
    // Detrás del agua no se llega a pie
    expect(near.has(at(s, 3, 13))).toBe(false);
  });

  it('lejos de las calles explica cómo zonificar el rectángulo entero', () => {
    const s = newGame();
    const r = applyCommand(s, { type: 'zone', rect: { x0: 0, y0: 0, x1: 5, y1: 5 }, zone: 'R', density: 'low', strip: 3 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/pulsa F/);
  });

  it('la herramienta añade la franja al comando y la vista previa la usa', () => {
    const tool = { kind: 'zone', zone: 'R', density: 'low' } as const;
    expect(toolCommand(tool, { x: 0, y: 0 }, { x: 3, y: 3 }, { strip: 2 })).toMatchObject({ strip: 2 });
    expect(toolCommand(tool, { x: 0, y: 0 }, { x: 3, y: 3 }, { strip: 0 })).not.toHaveProperty('strip');
  });
});

describe('colocar edificios en serie', () => {
  it('arrastrando un parque pone una rejilla de copias y salta los huecos ocupados', () => {
    const s = newGame();
    const park = getBuildingDef('park_small')!;
    applyCommand(s, { type: 'buildRoad', from: { x: 2, y: 0 }, to: { x: 2, y: 0 } });
    const cmd = toolCommand({ kind: 'building', defId: park.id }, { x: 0, y: 0 }, { x: 4, y: 0 })!;
    expect(cmd).toMatchObject({ type: 'placeBuilding', at: { x: 0, y: 0 }, to: { x: 4, y: 0 } });
    const before = s.economy.money;
    const r = applyCommand(s, cmd);
    const copies = 5 - 1; // una casilla es calle
    expect(r).toMatchObject({ ok: true, affected: copies, cost: copies * park.cost });
    expect(s.economy.money).toBe(before - copies * park.cost);
    expect(s.buildings.size).toBe(copies);
  });

  it('los edificios grandes no se arrastran: se colocan en la casilla final', () => {
    const tool = { kind: 'building', defId: 'police_station' } as const;
    expect(toolCommand(tool, { x: 0, y: 0 }, { x: 6, y: 6 })).toEqual({ type: 'placeBuilding', defId: 'police_station', at: { x: 6, y: 6 } });
    expect(toolPreviewTiles(tool, { x: 0, y: 0 }, { x: 6, y: 6 })).toHaveLength(4);
  });

  it('la vista previa muestra todas las copias', () => {
    const plaza = getBuildingDef('plaza')!;
    const tiles = toolPreviewTiles({ kind: 'building', defId: plaza.id }, { x: 0, y: 0 }, { x: 5, y: 1 });
    const per = plaza.size.w * plaza.size.h;
    expect(tiles.length % per).toBe(0);
    expect(tiles.length / per).toBe(Math.floor(6 / plaza.size.w) * Math.max(1, Math.floor(2 / plaza.size.h)));
  });
});

describe('deshacer y rehacer', () => {
  it('deshace una calle, devuelve el dinero y la rehace', () => {
    const s = newGame();
    const h = new UndoHistory();
    const r = h.run(s, { type: 'buildRoad', from: { x: 0, y: 5 }, to: { x: 9, y: 5 } });
    expect(r.ok).toBe(true);
    expect(s.economy.money).toBe(100_000 - r.cost);
    const u = h.undo(s);
    expect(u).toMatchObject({ ok: true, refund: r.cost, restored: 10, total: 10 });
    expect(s.map.road[at(s, 4, 5)]).toBe(0);
    expect(s.economy.money).toBe(100_000);
    expect(h.canRedo).toBe(true);
    expect(h.redo(s).ok).toBe(true);
    expect(s.map.road[at(s, 4, 5)]).toBe(1);
    expect(s.economy.money).toBe(100_000 - r.cost);
  });

  it('una demolición deshecha devuelve el edificio con su identificador', () => {
    const s = newGame();
    const h = new UndoHistory();
    h.run(s, { type: 'placeBuilding', defId: 'police_station', at: { x: 3, y: 3 } });
    const id = s.map.building[at(s, 3, 3)];
    h.run(s, { type: 'bulldoze', rect: { x0: 3, y0: 3, x1: 3, y1: 3 } });
    expect(s.buildings.size).toBe(0);
    expect(h.undo(s).ok).toBe(true);
    expect(s.buildings.get(id)).toMatchObject({ defId: 'police_station', x: 3, y: 3 });
    expect(s.map.building[at(s, 4, 4)]).toBe(id);
    // Y deshacer la colocación lo quita del todo
    expect(h.undo(s).ok).toBe(true);
    expect(s.buildings.size).toBe(0);
    expect(s.map.building[at(s, 4, 4)]).toBe(NO_BUILDING);
  });

  it('las casillas que la ciudad ya cambió se quedan y se devuelve la parte proporcional', () => {
    const s = newGame();
    const h = new UndoHistory();
    const r = h.run(s, { type: 'zone', rect: { x0: 0, y0: 0, x1: 9, y1: 0 }, zone: 'R', density: 'low' });
    // Un edificio crece en dos casillas de la zona
    s.map.lotLevel[at(s, 0, 0)] = 1;
    s.map.lotLevel[at(s, 1, 0)] = 1;
    const u = h.undo(s);
    expect(u).toMatchObject({ ok: true, restored: 8, total: 10, refund: Math.round((r.cost * 8) / 10) });
    expect(s.map.zoneType[at(s, 0, 0)]).toBe(ZONE_CODE.R);
    expect(s.map.zoneType[at(s, 5, 0)]).toBe(0);
  });

  it('solo se deshace lo reciente y una acción nueva borra lo que había para rehacer', () => {
    const s = newGame();
    const h = new UndoHistory();
    h.run(s, { type: 'buildRoad', from: { x: 0, y: 5 }, to: { x: 3, y: 5 } });
    h.run(s, { type: 'buildRoad', from: { x: 0, y: 7 }, to: { x: 3, y: 7 } });
    h.undo(s);
    h.run(s, { type: 'buildRoad', from: { x: 0, y: 9 }, to: { x: 3, y: 9 } });
    expect(h.canRedo).toBe(false);
    for (let d = 0; d <= UNDO_MAX_DAYS; d++) tick(s);
    expect(h.undo(s).ok).toBe(false);
    expect(s.map.road[at(s, 0, 9)]).toBe(1);
  });

  it('no apunta lo que no cambia la ciudad', () => {
    const s = newGame();
    const h = new UndoHistory();
    h.run(s, { type: 'setTaxRate', zone: 'R', rate: 12 });
    h.run(s, { type: 'buildRoad', from: { x: 0, y: 0 }, to: { x: 0, y: 0 } });
    h.run(s, { type: 'buildRoad', from: { x: 0, y: 0 }, to: { x: 0, y: 0 } }); // falla: ya hay carretera
    h.undo(s);
    expect(h.canUndo).toBe(false);
    expect(s.economy.taxes.R).toBe(12);
  });

  it('deshacer la compra de una parcela la devuelve', () => {
    const s = createGame({ width: 128, height: 128, seed: 5, landPlots: true });
    const h = new UndoHistory();
    s.progress.rank = 1; // con el rango inicial ya se tienen todas las parcelas permitidas
    const land = s.land!;
    const plot = land.owned.findIndex((v, i) => !v && land.owned.some((o, j) => o && Math.abs((j % land.cols) - (i % land.cols)) + Math.abs(Math.floor(j / land.cols) - Math.floor(i / land.cols)) === 1));
    const x = (plot % land.cols) * land.plotSize;
    const y = Math.floor(plot / land.cols) * land.plotSize;
    const money = s.economy.money;
    expect(h.run(s, { type: 'buyPlot', at: { x, y } }).ok).toBe(true);
    expect(h.undo(s).ok).toBe(true);
    expect(land.owned[plot]).toBe(0);
    expect(s.progress.plotsBought).toBe(0);
    expect(s.economy.money).toBe(money);
  });
});

describe('modo libre', () => {
  it('todo desbloqueado, sin coste, sin préstamos ni bancarrota', () => {
    const s = createGame({ width: 24, height: 24, flat: true, sandbox: true, money: 10, landPlots: true });
    expect(s.land).toBeNull();
    const high = getZoneDef('R', 'high');
    expect(high.unlockAtPopulation).toBeGreaterThan(0);
    const r = applyCommand(s, { type: 'zone', rect: { x0: 0, y0: 0, x1: 9, y1: 9 }, zone: 'R', density: 'high' });
    expect(r.ok).toBe(true);
    expect(applyCommand(s, { type: 'placeBuilding', defId: 'coal_plant', at: { x: 12, y: 12 } }).ok).toBe(true);
    expect(s.economy.money).toBe(10);
    expect(applyCommand(s, { type: 'takeLoan', amount: 10_000 }).ok).toBe(false);
    for (let d = 0; d < 400; d++) tick(s);
    expect(s.economy.money).toBe(10);
    expect(s.economy.bankrupt).toBe(false);
    expect(s.progress.achievements).toEqual([]);
  });

  it('se guarda y se carga', () => {
    const s = createGame({ width: 24, height: 24, flat: true, sandbox: true });
    const loaded = deserialize(JSON.parse(JSON.stringify(serialize(s))));
    expect(loaded.sandbox).toBe(true);
    expect(serialize(s).meta.sandbox).toBe(true);
  });
});
