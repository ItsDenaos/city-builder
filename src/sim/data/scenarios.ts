import { AutoPlayer } from '../autoplayer';
import { LOAN_MONTHS } from '../config';
import type { GameState, NewGameOptions } from '../state';
import { loanPayment } from '../systems/economy';
import { countBuildings, residentAverages } from '../systems/metrics';

export interface ScenarioGoal {
  label: string;
  /** Avance en [0, 1]; el objetivo se cumple con 1. */
  progress: (s: GameState) => number;
}

export interface ScenarioDef {
  id: string;
  name: string;
  summary: string;
  /** Años de plazo desde el inicio. */
  years: number;
  options: NewGameOptions;
  /** Preparación extra del mapa (por ejemplo, una ciudad heredada). */
  prepare?: (s: GameState) => void;
  goals: ScenarioGoal[];
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const population = (target: number): ScenarioGoal => ({
  label: `${target.toLocaleString('es-ES')} habitantes`,
  progress: (s) => clamp01(s.stats.population / target),
});

export const SCENARIOS: readonly ScenarioDef[] = [
  {
    id: 'contrarreloj',
    name: 'Contrarreloj',
    summary: 'Empiezas con poco dinero y el reloj corre: haz crecer la ciudad sin quebrar.',
    years: 10,
    options: { seed: 2718, money: 25_000, landPlots: true },
    goals: [population(8_000)],
  },
  {
    id: 'ciudad-verde',
    name: 'Ciudad verde',
    summary: 'Una ciudad grande que respire: nada de carbón y aire limpio en los barrios.',
    years: 12,
    options: { seed: 3141, landPlots: true },
    goals: [
      population(6_000),
      { label: 'Ninguna central de carbón', progress: (s) => (countBuildings(s, 'coal_plant') === 0 ? 1 : 0) },
      {
        label: 'Contaminación media en las viviendas de 8 o menos',
        progress: (s) => {
          const p = residentAverages(s).pollution;
          return p <= 8 ? 1 : clamp01(8 / p);
        },
      },
    ],
  },
  {
    id: 'tierra-de-lagos',
    name: 'Tierra de lagos',
    summary: 'Un territorio salpicado de agua: puentes, orillas y poco suelo edificable.',
    years: 12,
    options: { seed: 77, waterLevel: 0.46, landPlots: true },
    goals: [population(5_000)],
  },
  {
    id: 'herencia',
    name: 'Herencia',
    summary: 'Heredas una ciudad endeudada, con impuestos bajos y números rojos. Sácala adelante.',
    years: 6,
    options: { seed: 42 },
    prepare: (s) => {
      new AutoPlayer(s).run(360 * 4);
      const e = s.economy;
      e.taxes = { R: 7, C: 7, I: 7 };
      e.money = -12_000;
      e.loans = [50_000, 50_000, 25_000].map((amount, k) => ({
        id: e.nextLoanId + k,
        amount,
        balance: amount,
        monthlyPayment: loanPayment(amount),
        monthsLeft: LOAN_MONTHS,
      }));
      e.nextLoanId += 3;
      e.monthsInDebt = 0;
      s.progress.monthsPositive = 0;
    },
    goals: [
      { label: 'Saldo positivo', progress: (s) => (s.economy.money >= 0 ? 1 : clamp01(1 + s.economy.money / 12_000)) },
      { label: '12 meses seguidos con balance positivo', progress: (s) => clamp01(s.progress.monthsPositive / 12) },
    ],
  },
];

export const getScenario = (id: string) => SCENARIOS.find((s) => s.id === id);
