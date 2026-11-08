import {
  BANKRUPTCY_MONTHS,
  BUDGET_HISTORY_MONTHS,
  LOAN_ANNUAL_RATE,
  LOAN_MONTHS,
  METRO_TUNNEL_UPKEEP,
  NETWORK_UPKEEP,
  TAX_PER_CAPITA,
  TRANSIT_FARE,
} from '../config';
import { getBuildingDef } from '../data/buildings';
import { ROAD_BY_CODE } from '../data/roads';
import { ZONE_BY_CODE } from '../data/zones';
import { activeOrdinances, effectTaxIncome } from '../effects';
import { incomeIndex } from './demography';
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
 * - Ingresos: habitantes (R) y trabajadores (C/I) × tasa × recaudación por punto, y billetes del transporte.
 * - Gastos: mantenimiento de edificios por categoría, carreteras, redes, túneles y cuotas de préstamos.
 */
export function estimateBudget(state: GameState): Budget {
  const { map, economy } = state;
  const people = { R: 0, C: 0, I: 0 };
  let roads = 0;
  let networkTiles = 0;
  let tunnels = 0;
  for (let i = 0; i < map.zoneType.length; i++) {
    roads += ROAD_BY_CODE[map.road[i]]?.upkeep ?? 0;
    networkTiles += map.powerLine[i] + map.waterPipe[i];
    tunnels += map.metro[i];
    const type = ZONE_BY_CODE[map.zoneType[i]];
    if (type && map.lotLevel[i]) people[type] += map.lotOccupants[i];
  }

  const income = {
    // Los sueldos (estudios) y las pensiones (fase 15) cambian lo que paga cada vecino
    R: people.R * economy.taxes.R * TAX_PER_CAPITA.R * effectTaxIncome(state, 'R') * incomeIndex(state),
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
    transport: 0,
    waste: 0,
    ordinances: activeOrdinances(state).reduce((sum, o) => sum + o.cost, 0),
    loans: economy.loans.reduce((sum, l) => sum + dueThisMonth(l), 0),
  };
  const transitFunding = economy.funding.transit / 100;
  const departments = { police: 0, fire: 0, health: 0, education: 0, park: 0, transit: tunnels * METRO_TUNNEL_UPKEEP * transitFunding, waste: 0 };
  expenses.transport = departments.transit;
  for (const b of state.buildings.values()) {
    const def = getBuildingDef(b.defId);
    if (!def) continue;
    // La financiación del departamento escala el mantenimiento de sus edificios
    const dept = def.coverage?.service ?? (def.transit ? 'transit' : def.garbage ? 'waste' : null);
    const upkeep = def.upkeep * (dept ? economy.funding[dept] / 100 : 1);
    expenses[def.category] += upkeep;
    if (dept) departments[dept] += upkeep;
  }

  // Billetes: cada viajero diario deja TRANSIT_FARE al mes
  const fares = state.stats.transit.riders * TRANSIT_FARE;
  const totalIncome = income.R + income.C + income.I + fares;
  const totalExpenses = Object.values(expenses).reduce((a, b) => a + b, 0);
  return { income, fares, expenses, departments, totalIncome, totalExpenses, net: totalIncome - totalExpenses };
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
