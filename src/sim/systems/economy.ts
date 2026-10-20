import {
  BANKRUPTCY_MONTHS,
  BUDGET_HISTORY_MONTHS,
  LOAN_ANNUAL_RATE,
  LOAN_MONTHS,
  NETWORK_UPKEEP,
  TAX_PER_CAPITA,
} from '../config';
import { getBuildingDef } from '../data/buildings';
import { ROAD_BY_CODE } from '../data/roads';
import { ZONE_BY_CODE } from '../data/zones';
import { effectTaxIncome } from '../effects';
import type { Budget, GameState, Loan } from '../state';
import type { SimEvent } from '../types';

const MONTHLY_RATE = LOAN_ANNUAL_RATE / 12;

/** Cuota fija mensual de un préstamo (sistema francés). */
export function loanPayment(amount: number, months = LOAN_MONTHS, monthlyRate = MONTHLY_RATE): number {
  return (amount * monthlyRate) / (1 - (1 + monthlyRate) ** -months);
}

/** Lo que se pagará este mes por un préstamo: la cuota, o lo que quede si es menos. */
const dueThisMonth = (loan: Loan) => Math.min(loan.monthlyPayment, loan.balance * (1 + MONTHLY_RATE));

/**
 * Presupuesto mensual con el estado actual de la ciudad:
 * - Ingresos: habitantes (R) y trabajadores (C/I) × tasa × recaudación por punto.
 * - Gastos: mantenimiento de edificios por categoría, carreteras, redes y cuotas de préstamos.
 */
export function estimateBudget(state: GameState): Budget {
  const { map, economy } = state;
  const people = { R: 0, C: 0, I: 0 };
  let roads = 0;
  let networkTiles = 0;
  for (let i = 0; i < map.zoneType.length; i++) {
    roads += ROAD_BY_CODE[map.road[i]]?.upkeep ?? 0;
    networkTiles += map.powerLine[i] + map.waterPipe[i];
    const type = ZONE_BY_CODE[map.zoneType[i]];
    if (type && map.lotLevel[i]) people[type] += map.lotOccupants[i];
  }

  const income = {
    R: people.R * economy.taxes.R * TAX_PER_CAPITA.R * effectTaxIncome(state, 'R'),
    C: people.C * economy.taxes.C * TAX_PER_CAPITA.C * effectTaxIncome(state, 'C'),
    I: people.I * economy.taxes.I * TAX_PER_CAPITA.I * effectTaxIncome(state, 'I'),
  };
  const expenses = {
    roads,
    networks: networkTiles * NETWORK_UPKEEP,
    power: 0,
    water: 0,
    services: 0,
    parks: 0,
    loans: economy.loans.reduce((sum, l) => sum + dueThisMonth(l), 0),
  };
  for (const b of state.buildings.values()) {
    const def = getBuildingDef(b.defId);
    if (def) expenses[def.category] += def.upkeep;
  }

  const totalIncome = income.R + income.C + income.I;
  const totalExpenses = Object.values(expenses).reduce((a, b) => a + b, 0);
  return { income, expenses, totalIncome, totalExpenses, net: totalIncome - totalExpenses };
}

/** Paga una cuota de cada préstamo; quita los que quedan saldados. */
function amortizeLoans(state: GameState, events: SimEvent[]): void {
  const economy = state.economy;
  for (const loan of economy.loans) {
    const interest = loan.balance * MONTHLY_RATE;
    loan.balance = Math.max(0, loan.balance + interest - dueThisMonth(loan));
    loan.monthsLeft--;
    if (loan.balance < 0.01) {
      events.push({ type: 'loanPaidOff', amount: loan.amount });
      state.progress.loansClosed++;
    }
  }
  economy.loans = economy.loans.filter((l) => l.balance >= 0.01);
}

/** Cierre mensual: cobra impuestos, paga gastos, amortiza préstamos y vigila la deuda. */
export function settleMonth(state: GameState, events: SimEvent[]): void {
  const month = events.find((e) => e.type === 'newMonth');
  if (!month || month.type !== 'newMonth') return;
  const economy = state.economy;
  const budget = estimateBudget(state);
  // En el modo libre el presupuesto se calcula (para verlo), pero el dinero no cambia
  if (!state.sandbox) economy.money += budget.net;
  amortizeLoans(state, events);
  economy.lastMonth = budget;
  economy.history.push({ month: month.month, year: month.year, money: economy.money, net: budget.net });
  if (economy.history.length > BUDGET_HISTORY_MONTHS) economy.history.shift();

  economy.monthsInDebt = economy.money < 0 && !state.sandbox ? economy.monthsInDebt + 1 : 0;
  if (economy.monthsInDebt >= BANKRUPTCY_MONTHS && !economy.bankrupt) {
    economy.bankrupt = true;
    state.time.speed = 0;
    events.push({ type: 'bankrupt' });
  }
}
