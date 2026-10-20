import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands';
import { deserialize, serialize } from '../src/sim/save';
import { refreshDerived, tick } from '../src/sim/simulation';
import { createGame } from '../src/sim/state';
import { TUTORIAL, advanceTutorial } from '../src/sim/tutorial';
import { SETTING_FIELDS, parseSettings } from '../src/ui/settings';

const base = { autosaveMonths: 3, edgeScroll: 0, uiScale: 1, reducedMotion: 0, advisor: 1 };

/** Avanza la guía todo lo que permita el estado actual; devuelve los pasos cumplidos. */
function advanceAll(s: ReturnType<typeof createGame>): string[] {
  refreshDerived(s);
  const done: string[] = [];
  for (let step = advanceTutorial(s); step; step = advanceTutorial(s)) done.push(step.id);
  return done;
}

describe('primeros pasos', () => {
  it('solo empieza si se pide y se guarda con la partida', () => {
    expect(createGame({ width: 16, height: 16, flat: true }).tutorial).toBeNull();
    const s = createGame({ width: 16, height: 16, flat: true, tutorial: true });
    expect(s.tutorial).toEqual({ step: 0 });
    s.tutorial!.step = 3;
    expect(deserialize(JSON.parse(JSON.stringify(serialize(s)))).tutorial).toEqual({ step: 3 });
  });

  it('cada paso se cumple con lo que pide, en orden', () => {
    const s = createGame({ width: 40, height: 40, flat: true, money: 200_000, tutorial: true });
    expect(advanceAll(s)).toEqual([]);

    // Calle desde el borde
    applyCommand(s, { type: 'buildRoad', from: { x: 0, y: 20 }, to: { x: 30, y: 20 } });
    expect(advanceAll(s)).toEqual(['calle']);

    // Viviendas en franja a ambos lados
    applyCommand(s, { type: 'zone', rect: { x0: 2, y0: 14, x1: 14, y1: 26 }, zone: 'R', density: 'low', strip: 3 });
    expect(advanceAll(s)).toEqual(['viviendas']);

    applyCommand(s, { type: 'placeBuilding', defId: 'wind_turbine', at: { x: 1, y: 19 } });
    expect(advanceAll(s)).toEqual(['luz']);

    applyCommand(s, { type: 'placeBuilding', defId: 'water_tower', at: { x: 1, y: 21 } });
    applyCommand(s, { type: 'buildPipe', from: { x: 0, y: 20 }, to: { x: 16, y: 20 } });
    expect(advanceAll(s)).toEqual(['agua']);

    applyCommand(s, { type: 'zone', rect: { x0: 16, y0: 18, x1: 22, y1: 19 }, zone: 'C', density: 'low' });
    applyCommand(s, { type: 'zone', rect: { x0: 24, y0: 21, x1: 30, y1: 22 }, zone: 'I', density: 'low' });
    expect(advanceAll(s)).toEqual(['empleo']);
    expect(TUTORIAL[s.tutorial!.step].id).toBe('tiempo');
  });

  it('al terminar se queda en el último paso hasta que se cierra', () => {
    const s = createGame({ width: 16, height: 16, flat: true, tutorial: true });
    s.tutorial!.step = TUTORIAL.length;
    expect(advanceTutorial(s)).toBeNull();
    for (let d = 0; d < 5; d++) tick(s);
    expect(s.tutorial).toEqual({ step: TUTORIAL.length });
  });
});

describe('ajustes', () => {
  it('toma los valores guardados válidos y descarta el resto', () => {
    expect(parseSettings(null, base)).toEqual(base);
    expect(parseSettings({ autosaveMonths: 6, uiScale: 1.25, edgeScroll: 1 }, base)).toMatchObject({ autosaveMonths: 6, uiScale: 1.25, edgeScroll: 1 });
    expect(parseSettings({ autosaveMonths: 5, uiScale: '2', advisor: 7, extra: 1 }, base)).toEqual(base);
  });

  it('cada ajuste ofrece su valor de serie', () => {
    for (const f of SETTING_FIELDS) expect(f.options.some((o) => o.value === base[f.key])).toBe(true);
  });
});
