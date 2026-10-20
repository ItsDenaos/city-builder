import { it } from 'vitest';
import { createGame } from '../src/sim/state';
import { Bot, type BotOptions } from './bot';
import { type YearRow, printTable, snapshot } from './report';

/**
 * Informe de balance: no comprueba nada, imprime cómo evoluciona una ciudad jugada por el bot.
 * Se ejecuta con `npm run balance` (no forma parte de `npm test`).
 */
function scenario(title: string, years: number, opts: BotOptions & { money?: number; seed?: number; lakes?: boolean } = {}) {
  it(title, async () => {
    const s = createGame({ width: 128, height: 128, flat: !opts.lakes, seed: opts.seed ?? 3, money: opts.money });
    const bot = new Bot(s, opts);
    const rows: YearRow[] = [];
    for (let y = 0; y < years && !s.economy.bankrupt; y++) {
      bot.run(360);
      rows.push(snapshot(s));
      await new Promise((r) => setTimeout(r)); // ceder el hilo para que vitest no se queje
    }
    printTable(`${title}${s.economy.bankrupt ? ' — BANCARROTA' : ''}`, rows);
    console.log('construido:', JSON.stringify(bot.log.built));
    const failures = Object.entries(bot.log.failures).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (failures.length) console.log('fallos más frecuentes:', JSON.stringify(Object.fromEntries(failures)));
  });
}

scenario('Normal ($50.000, impuestos 9%)', 25);
scenario('Difícil ($25.000)', 15, { money: 25_000 });
scenario('Sin servicios', 15, { services: false });
scenario('Impuestos altos (14%)', 15, { taxes: { R: 14, C: 14, I: 14 } });
scenario('Impuestos 11%', 15, { taxes: { R: 11, C: 11, I: 11 } });
scenario('Impuestos bajos (5%)', 15, { taxes: { R: 5, C: 5, I: 5 } });
scenario('Con lagos (semilla 42)', 15, { lakes: true, seed: 42 });
