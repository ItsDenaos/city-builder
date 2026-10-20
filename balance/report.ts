import { ZONE_CODE } from '../src/sim/data/zones';
import type { GameState } from '../src/sim/state';

export interface YearRow {
  year: number;
  pop: number;
  money: number;
  net: number;
  happiness: number;
  unemployment: number;
  levels: string;
  commute: number;
  congested: number;
  power: string;
  water: string;
  crime: number;
  pollution: number;
  landValue: number;
  loans: number;
  demand: string;
  income: number;
  /** Gastos: carreteras / redes / electricidad / agua / servicios / parques / préstamos. */
  expenses: string;
}

/** Fotografía anual de la ciudad para comparar escenarios. */
export function snapshot(s: GameState): YearRow {
  const { map, layers, stats, economy, utilities } = s;
  const lv = [0, 0, 0, 0];
  let residents = 0;
  let crime = 0;
  let pollution = 0;
  let land = 0;
  for (let i = 0; i < map.lotLevel.length; i++) {
    lv[map.lotLevel[i]]++;
    if (map.zoneType[i] === ZONE_CODE.R && map.lotOccupants[i]) {
      const n = map.lotOccupants[i];
      residents += n;
      crime += layers.crime[i] * n;
      pollution += layers.pollution[i] * n;
      land += layers.landValue[i] * n;
    }
  }
  const avg = (v: number) => Math.round(residents ? v / residents : 0);
  return {
    year: s.time.year,
    pop: stats.population,
    money: Math.round(economy.money),
    net: Math.round(economy.lastMonth?.net ?? 0),
    happiness: Math.round(stats.happiness),
    unemployment: Math.round(stats.workforce ? ((stats.workforce - stats.employed) / stats.workforce) * 100 : 0),
    levels: lv.slice(1).join('/'),
    commute: Math.round(stats.traffic.avgCommute),
    congested: Math.round(stats.traffic.congestedShare * 100),
    power: `${Math.round(utilities.power.demand)}/${utilities.power.production}`,
    water: `${Math.round(utilities.water.demand)}/${utilities.water.production}`,
    crime: avg(crime),
    pollution: avg(pollution),
    landValue: avg(land),
    loans: economy.loans.length,
    demand: (['R', 'C', 'I'] as const).map((z) => stats.demand[z].toFixed(2)).join(' '),
    income: Math.round(economy.lastMonth?.totalIncome ?? 0),
    expenses: economy.lastMonth ? Object.values(economy.lastMonth.expenses).map((v) => Math.round(v)).join('/') : '',
  };
}

export function printTable(title: string, rows: YearRow[]): void {
  const cols = Object.keys(rows[0]) as (keyof YearRow)[];
  const width = (c: keyof YearRow) => Math.max(c.length, ...rows.map((r) => String(r[c]).length));
  const line = (vals: string[]) => vals.map((v, k) => v.padStart(width(cols[k]))).join('  ');
  console.log(`\n== ${title} ==\n${line(cols)}\n${rows.map((r) => line(cols.map((c) => String(r[c])))).join('\n')}`);
}
