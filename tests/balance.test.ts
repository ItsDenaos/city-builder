import { beforeAll, describe, expect, it } from 'vitest';
import { Bot, type BotOptions } from '../balance/bot';
import { type GameState, createGame } from '../src/sim/state';
import { taxDemandPenalty } from '../src/sim/systems/demand';

/**
 * Objetivos de balance, comprobados con el jugador automático (balance/bot.ts).
 * Si un cambio de números rompe alguno, revisa el informe completo con `npm run balance`.
 */
function play(years: number, opts: BotOptions & { money?: number } = {}) {
  const s = createGame({ width: 128, height: 128, flat: true, seed: 3, money: opts.money });
  const bot = new Bot(s, opts);
  const yearly: { pop: number; money: number; net: number }[] = [];
  for (let y = 0; y < years && !s.economy.bankrupt; y++) {
    bot.run(360);
    yearly.push({ pop: s.stats.population, money: s.economy.money, net: s.economy.lastMonth?.net ?? 0 });
  }
  return { s, yearly };
}

describe('balance', () => {
  let normal: { s: GameState; yearly: { pop: number; money: number; net: number }[] };
  beforeAll(() => {
    normal = play(8);
  }, 120_000);

  it('una ciudad sensata nunca quiebra y gana dinero desde el primer año', () => {
    expect(normal.s.economy.bankrupt).toBe(false);
    expect(normal.yearly[0].net).toBeGreaterThan(0);
    expect(normal.yearly.every((y) => y.money > 0)).toBe(true);
  });

  it('crece a buen ritmo: unos cientos el primer año y miles a los 8', () => {
    expect(normal.yearly[0].pop).toBeGreaterThan(250);
    expect(normal.yearly[4].pop).toBeGreaterThan(1_500);
    expect(normal.yearly[7].pop).toBeGreaterThan(4_000);
  });

  it('desbloquea la densidad media en los primeros años', () => {
    expect(normal.s.progress.peakPopulation).toBeGreaterThan(1_000);
    expect(normal.s.map.lotLevel.some((v) => v >= 2)).toBe(true);
  });

  it('los servicios compensan: sin ellos la ciudad crece bastante menos', () => {
    const bare = play(8, { services: false });
    expect(bare.s.stats.population).toBeLessThan(normal.s.stats.population * 0.7);
    expect(bare.s.map.lotLevel.some((v) => v >= 2)).toBe(false);
  }, 120_000);

  it('subir mucho los impuestos frena el crecimiento', () => {
    const high = play(8, { taxes: { R: 14, C: 14, I: 14 } });
    expect(high.s.stats.population).toBeLessThan(normal.s.stats.population / 2);
  }, 120_000);

  it('el castigo de los impuestos crece más deprisa por encima del 12 %', () => {
    const step = (t: number) => taxDemandPenalty(t + 1) - taxDemandPenalty(t);
    expect(taxDemandPenalty(9)).toBe(0);
    expect(taxDemandPenalty(5)).toBeLessThan(0);
    expect(step(14)).toBeGreaterThan(step(10) * 2);
  });
});
