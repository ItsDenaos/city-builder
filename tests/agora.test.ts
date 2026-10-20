import { describe, expect, it } from 'vitest';
import { NEIGHBORHOOD_SIZE, neighborhoodName } from '../src/sim/data/agora';
import { ZONE_CODE } from '../src/sim/data/zones';
import { deserialize, serialize } from '../src/sim/save';
import { type GameState, createGame, tileIndex } from '../src/sim/state';
import { approvalTarget, topicFor, updateAgora } from '../src/sim/systems/agora';
import type { SimEvent } from '../src/sim/types';

/** Ciudad mínima: una fila de casas habitadas en y = 5. */
function town(opts: { elections?: boolean } = {}) {
  const s = createGame({ width: 48, height: 48, flat: true, elections: opts.elections });
  for (let x = 2; x < 12; x++) {
    const i = tileIndex(s.map, x, 5);
    s.map.zoneType[i] = ZONE_CODE.R;
    s.map.zoneDensity[i] = 1;
    s.map.lotLevel[i] = 1;
    s.map.lotOccupants[i] = 8;
    s.layers.powered[i] = 1;
    s.layers.watered[i] = 1;
    s.layers.happiness[i] = 60;
    s.layers.coverage.park[i] = 50;
    s.layers.coverage.health[i] = 50;
    s.layers.coverage.education[i] = 50;
  }
  s.stats.population = 80;
  s.stats.happiness = 60;
  return s;
}

const at = (s: GameState, x: number) => tileIndex(s.map, x, 5);
const month = (s: GameState, m: number): SimEvent[] => {
  s.time.month = m;
  return [{ type: 'newMonth', month: m, year: s.time.year }];
};

describe('mensajes de los vecinos', () => {
  it('cada mensaje sale de la causa real del lote', () => {
    const s = town();
    s.layers.powered[at(s, 3)] = 0;
    expect(topicFor(s, at(s, 3))?.id).toBe('sin-luz');
    s.layers.pollution[at(s, 4)] = 50;
    expect(topicFor(s, at(s, 4))?.id).toBe('humo');
    s.layers.happiness[at(s, 5)] = 80;
    s.layers.coverage.park[at(s, 5)] = 70;
    expect(topicFor(s, at(s, 5))).toMatchObject({ id: 'parque', tone: 'elogio' });
    expect(topicFor(s, at(s, 6))).toBeNull(); // nada que contar
  });

  it('cada diez días hablan algunos vecinos, sin tocar el generador de la simulación', () => {
    const s = town();
    for (let x = 2; x < 12; x++) s.layers.coverage.health[at(s, x)] = 0;
    s.stats.population = 900;
    const rng = s.rng;
    for (let d = 1; d <= 30; d++) {
      s.time.tick = d;
      updateAgora(s, []);
    }
    expect(s.rng).toBe(rng);
    expect(s.agora.posts.length).toBeGreaterThan(0);
    expect(s.agora.posts[0]).toMatchObject({ topic: 'sin-salud', tone: 'queja', y: 5 });
    expect(s.agora.posts[0].barrio).toBe(neighborhoodName(s, 2, 5));
  });
});

describe('peticiones', () => {
  function withComplaints(s: GameState) {
    for (let x = 2; x < 12; x++) s.layers.coverage.park[at(s, x)] = 0;
    s.stats.population = 400;
    for (let k = 0; k < 4; k++) s.agora.posts.push({ day: 0, x: 3, y: 5, author: 'Lucía', barrio: neighborhoodName(s, 3, 5), text: '…', tone: 'queja', topic: 'sin-parque' });
  }

  it('la queja que más se repite se convierte en petición y se cumple al resolverla', () => {
    const s = town();
    withComplaints(s);
    s.agora.rng = 1;
    let events: SimEvent[] = [];
    for (let m = 1; m <= 24 && !s.agora.petitions.length; m++) updateAgora(s, (events = month(s, (m % 12) + 1)));
    const p = s.agora.petitions[0];
    expect(p).toMatchObject({ topic: 'sin-parque', status: 'open', title: `Un parque para ${p.barrio}` });
    expect(events.some((e) => e.type === 'petitionNew')).toBe(true);
    const before = s.agora.approval;
    s.layers.coverage.park[tileIndex(s.map, p.x, p.y)] = 60;
    events = month(s, 2);
    updateAgora(s, events);
    expect(p.status).toBe('done');
    expect(s.agora.approval).toBeGreaterThan(before);
    expect(s.incidents.effects.some((e) => e.label === 'Vecinos agradecidos')).toBe(true);
  });

  it('si vence el plazo se pierde aprobación y no se vuelve a pedir enseguida', () => {
    const s = town();
    withComplaints(s);
    s.agora.petitions.push({ id: 1, topic: 'sin-parque', title: 'Un parque', barrio: neighborhoodName(s, 3, 5), x: 3, y: 5, created: 0, deadline: 10, status: 'open' });
    s.time.tick = 11;
    s.agora.approval = 60;
    const target = approvalTarget(s);
    updateAgora(s, month(s, 3));
    expect(s.agora.petitions[0].status).toBe('failed');
    expect(s.agora.approval).toBeLessThan(60 + (target - 60) * 0.25);
    for (let m = 0; m < 6; m++) updateAgora(s, month(s, 4 + m));
    expect(s.agora.petitions.filter((p) => p.topic === 'sin-parque' && p.status === 'open')).toHaveLength(0);
  });
});

describe('aprobación y elecciones', () => {
  it('la aprobación sigue a la felicidad, el paro y los impuestos', () => {
    const s = town();
    const base = approvalTarget(s);
    s.economy.taxes = { R: 15, C: 15, I: 15 };
    expect(approvalTarget(s)).toBeLessThan(base);
    s.stats.happiness = 90;
    s.economy.taxes = { R: 9, C: 9, I: 9 };
    expect(approvalTarget(s)).toBeGreaterThan(base);
  });

  it('en enero del año de elecciones se vota: con buena aprobación se gana', () => {
    const s = town({ elections: true });
    s.time.year = s.agora.nextElection;
    s.agora.approval = 70;
    s.stats.happiness = 70;
    const events = month(s, 1);
    updateAgora(s, events);
    expect(events.find((e) => e.type === 'election')).toMatchObject({ won: true });
    expect(s.agora.nextElection).toBe(s.time.year + 4);
    expect(s.agora.electionsWon).toBe(1);
  });

  it('con mala aprobación se pierde y la partida sigue sin elecciones', () => {
    const s = town({ elections: true });
    s.time.year = s.agora.nextElection;
    s.agora.approval = 25;
    s.stats.happiness = 20;
    const events = month(s, 1);
    updateAgora(s, events);
    expect(events.find((e) => e.type === 'election')).toMatchObject({ won: false });
    expect(s.agora.elections).toBe(false);
  });

  it('avisa seis meses y un mes antes', () => {
    const s = town({ elections: true });
    s.time.year = s.agora.nextElection - 1;
    const july = month(s, 7);
    updateAgora(s, july);
    expect(july.find((e) => e.type === 'electionSoon')).toMatchObject({ months: 6 });
    const december = month(s, 12);
    updateAgora(s, december);
    expect(december.find((e) => e.type === 'electionSoon')).toMatchObject({ months: 1 });
  });

  it('el modo libre no tiene elecciones', () => {
    expect(createGame({ width: 16, height: 16, flat: true, sandbox: true, elections: true }).agora.elections).toBe(false);
  });
});

describe('barrios y guardado', () => {
  it('cada barrio tiene un nombre distinto y estable', () => {
    const s = createGame({ width: 192, height: 192, flat: true, seed: 4 });
    const names = new Set<string>();
    for (let y = 0; y < 192; y += NEIGHBORHOOD_SIZE) for (let x = 0; x < 192; x += NEIGHBORHOOD_SIZE) names.add(neighborhoodName(s, x, y));
    expect(names.size).toBe((192 / NEIGHBORHOOD_SIZE) ** 2);
    expect(neighborhoodName(s, 5, 5)).toBe(neighborhoodName(s, 20, 20));
  });

  it('el Ágora se guarda con la partida', () => {
    const s = town({ elections: true });
    s.agora.posts.push({ day: 3, x: 3, y: 5, author: 'Inés', barrio: 'La Vega', text: 'Hola', tone: 'elogio', topic: 'feliz' });
    s.agora.approval = 61.5;
    const loaded = deserialize(JSON.parse(JSON.stringify(serialize(s))));
    expect(loaded.agora).toEqual(s.agora);
  });
});
