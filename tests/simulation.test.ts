import { describe, expect, it } from 'vitest';
import { generateTerrain } from '../src/sim/mapgen';
import { tick } from '../src/sim/simulation';
import { createGame } from '../src/sim/state';
import { TERRAIN_LAND } from '../src/sim/types';

describe('tiempo', () => {
  it('avanza de mes cada 30 días y de año cada 12 meses', () => {
    const s = createGame({ width: 8, height: 8, flat: true });
    const events = [];
    for (let i = 0; i < 30; i++) events.push(...tick(s));
    expect(s.time).toMatchObject({ day: 1, month: 2, year: 2000 });
    expect(events).toEqual([{ type: 'newMonth', month: 2, year: 2000 }]);

    for (let i = 0; i < 330; i++) events.push(...tick(s));
    expect(s.time).toMatchObject({ day: 1, month: 1, year: 2001 });
    expect(events).toContainEqual({ type: 'newYear', year: 2001 });
  });
});

describe('generación de mapa', () => {
  it('es determinista por semilla', () => {
    expect(generateTerrain(64, 64, 42)).toEqual(generateTerrain(64, 64, 42));
    expect(generateTerrain(64, 64, 42)).not.toEqual(generateTerrain(64, 64, 43));
  });

  it('deja la mayor parte del mapa como tierra', () => {
    for (const seed of [1, 7, 123, 9999]) {
      const t = generateTerrain(128, 128, seed);
      const land = t.filter((v) => v === TERRAIN_LAND).length / t.length;
      expect(land).toBeGreaterThan(0.5);
    }
  });
});
