import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands';
import { BANKRUPTCY_MONTHS, LOAN_MONTHS, MAX_LOANS, TAX_PER_CAPITA } from '../src/sim/config';
import { ROADS } from '../src/sim/data/roads';
import { getBuildingDef } from '../src/sim/data/buildings';
import { tick } from '../src/sim/simulation';
import { type GameState, createGame, tileIndex } from '../src/sim/state';
import { targetDemand } from '../src/sim/systems/demand';
import { estimateBudget, loanPayment, settleMonth } from '../src/sim/systems/economy';
import type { SimEvent } from '../src/sim/types';

const newGame = (money = 100_000) => createGame({ width: 32, height: 32, flat: true, money, seed: 7 });
const idx = (s: GameState, x: number, y: number) => tileIndex(s.map, x, y);
const endMonth = (s: GameState) => {
  const events: SimEvent[] = [{ type: 'newMonth', month: 2, year: 2000 }];
  settleMonth(s, events);
  return events;
};

describe('presupuesto', () => {
  it('cobra impuestos por habitante y trabajador', () => {
    const s = newGame();
    applyCommand(s, { type: 'zone', rect: { x0: 0, y0: 0, x1: 0, y1: 0 }, zone: 'R', density: 'low' });
    applyCommand(s, { type: 'zone', rect: { x0: 1, y0: 0, x1: 1, y1: 0 }, zone: 'I', density: 'low' });
    s.map.lotLevel[idx(s, 0, 0)] = 1;
    s.map.lotOccupants[idx(s, 0, 0)] = 4;
    s.map.lotLevel[idx(s, 1, 0)] = 1;
    s.map.lotOccupants[idx(s, 1, 0)] = 3;
    applyCommand(s, { type: 'setTaxRate', zone: 'R', rate: 10 });
    const b = estimateBudget(s);
    expect(b.income.R).toBeCloseTo(4 * 10 * TAX_PER_CAPITA.R);
    expect(b.income.I).toBeCloseTo(3 * 9 * TAX_PER_CAPITA.I);
    expect(b.income.C).toBe(0);
  });

  it('suma el mantenimiento de edificios y carreteras por categoría', () => {
    const s = newGame();
    applyCommand(s, { type: 'buildRoad', from: { x: 0, y: 10 }, to: { x: 9, y: 10 } });
    applyCommand(s, { type: 'placeBuilding', defId: 'police_station', at: { x: 0, y: 0 } });
    applyCommand(s, { type: 'placeBuilding', defId: 'wind_turbine', at: { x: 5, y: 0 } });
    const b = estimateBudget(s);
    expect(b.expenses.roads).toBeCloseTo(10 * ROADS.street.upkeep);
    expect(b.expenses.services).toBe(getBuildingDef('police_station')!.upkeep);
    expect(b.expenses.power).toBe(getBuildingDef('wind_turbine')!.upkeep);
    expect(b.net).toBeCloseTo(-b.totalExpenses);
  });

  it('el cierre de mes aplica el balance y guarda el historial', () => {
    const s = newGame();
    applyCommand(s, { type: 'placeBuilding', defId: 'police_station', at: { x: 0, y: 0 } });
    const upkeep = getBuildingDef('police_station')!.upkeep;
    const before = s.economy.money;
    endMonth(s);
    expect(s.economy.money).toBe(before - upkeep);
    expect(s.economy.lastMonth?.net).toBe(-upkeep);
    expect(s.economy.history).toEqual([{ month: 2, year: 2000, money: before - upkeep, net: -upkeep }]);
  });

  it('la simulación cierra el mes cada 30 días', () => {
    const s = newGame();
    applyCommand(s, { type: 'placeBuilding', defId: 'wind_turbine', at: { x: 0, y: 0 } });
    const before = s.economy.money;
    for (let d = 0; d < 60; d++) tick(s);
    expect(s.economy.money).toBe(before - 2 * 30);
    expect(s.economy.history).toHaveLength(2);
  });
});

describe('impuestos', () => {
  it('limita la tasa entre 0 y 20', () => {
    const s = newGame();
    expect(applyCommand(s, { type: 'setTaxRate', zone: 'C', rate: 21 }).ok).toBe(false);
    expect(applyCommand(s, { type: 'setTaxRate', zone: 'C', rate: -1 }).ok).toBe(false);
    expect(applyCommand(s, { type: 'setTaxRate', zone: 'C', rate: 0 }).ok).toBe(true);
    expect(s.economy.taxes.C).toBe(0);
  });

  it('subir impuestos baja la demanda de ese tipo', () => {
    const s = newGame();
    const neutral = targetDemand(s.stats, s.economy.taxes);
    const high = targetDemand(s.stats, { ...s.economy.taxes, R: 20 });
    const low = targetDemand(s.stats, { ...s.economy.taxes, R: 0 });
    expect(high.R).toBeLessThan(neutral.R);
    expect(low.R).toBeGreaterThan(neutral.R);
    expect(high.I).toBe(neutral.I);
  });
});

describe('préstamos', () => {
  it('da el dinero y se devuelve en cuotas fijas con intereses', () => {
    const s = newGame(0);
    expect(applyCommand(s, { type: 'takeLoan', amount: 10_000 }).ok).toBe(true);
    expect(s.economy.money).toBe(10_000);
    const payment = loanPayment(10_000);
    expect(payment).toBeCloseTo(132.15, 1);
    for (let m = 0; m < LOAN_MONTHS; m++) endMonth(s);
    expect(s.economy.loans).toHaveLength(0);
    expect(s.economy.money).toBeCloseTo(10_000 - payment * LOAN_MONTHS, 0);
  });

  it('avisa al terminar de pagarlo', () => {
    const s = newGame();
    applyCommand(s, { type: 'takeLoan', amount: 10_000 });
    const events: SimEvent[] = [];
    for (let m = 0; m < LOAN_MONTHS; m++) events.push(...endMonth(s));
    expect(events).toContainEqual({ type: 'loanPaidOff', amount: 10_000 });
  });

  it('se puede pedir aunque el saldo sea negativo', () => {
    const s = newGame();
    s.economy.money = -5_000;
    expect(applyCommand(s, { type: 'takeLoan', amount: 10_000 }).ok).toBe(true);
    expect(s.economy.money).toBe(5_000);
    expect(applyCommand(s, { type: 'setTaxRate', zone: 'R', rate: 12 }).ok).toBe(true);
  });

  it('solo importes del catálogo y como máximo 3 a la vez', () => {
    const s = newGame();
    expect(applyCommand(s, { type: 'takeLoan', amount: 12_345 }).ok).toBe(false);
    for (let k = 0; k < MAX_LOANS; k++) expect(applyCommand(s, { type: 'takeLoan', amount: 10_000 }).ok).toBe(true);
    expect(applyCommand(s, { type: 'takeLoan', amount: 10_000 }).ok).toBe(false);
  });

  it('se puede saldar por adelantado pagando el capital pendiente', () => {
    const s = newGame();
    applyCommand(s, { type: 'takeLoan', amount: 25_000 });
    endMonth(s);
    const loan = s.economy.loans[0];
    const money = s.economy.money;
    const r = applyCommand(s, { type: 'repayLoan', loanId: loan.id });
    expect(r.ok).toBe(true);
    expect(s.economy.money).toBe(money - Math.ceil(loan.balance));
    expect(s.economy.loans).toHaveLength(0);
  });
});

describe('bancarrota', () => {
  it(`llega tras ${BANKRUPTCY_MONTHS} meses en negativo y bloquea la partida`, () => {
    const s = newGame(100);
    applyCommand(s, { type: 'placeBuilding', defId: 'wind_turbine', at: { x: 0, y: 0 } }); // queda en -1.400
    s.economy.money = -1;
    const events: SimEvent[] = [];
    for (let m = 0; m < BANKRUPTCY_MONTHS; m++) events.push(...endMonth(s));
    expect(events).toContainEqual({ type: 'bankrupt' });
    expect(s.economy.bankrupt).toBe(true);
    expect(s.time.speed).toBe(0);
    expect(applyCommand(s, { type: 'setSpeed', speed: 1 }).ok).toBe(false);
  });

  it('salir de los números rojos reinicia la cuenta', () => {
    const s = newGame();
    s.economy.money = -10;
    endMonth(s);
    expect(s.economy.monthsInDebt).toBe(1);
    s.economy.money = 1_000;
    endMonth(s);
    expect(s.economy.monthsInDebt).toBe(0);
  });
});
