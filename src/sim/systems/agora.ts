import {
  APPROVAL_INCUMBENT,
  APPROVAL_SMOOTHING,
  ELECTION_YEARS,
  PETITION_APPROVAL,
  PETITION_CHANCE,
  POSTS_KEPT,
} from '../config';
import { BUSINESSES, FIRST_NAMES, type TopicDef, TOPICS, getTopic, neighborhoodName } from '../data/agora';
import { ZONE_CODE } from '../data/zones';
import { addEffect } from '../effects';
import { random } from '../rng';
import type { Agora, AgoraPost, GameState, Petition } from '../state';
import type { SimEvent } from '../types';
import { unemploymentRate } from './metrics';

const MAX_OPEN_PETITIONS = 3;
/** Días que pasan antes de volver a pedir lo mismo en el mismo barrio. */
const PETITION_REPEAT_DAYS = 360;
const PETITIONS_KEPT = 8;
/** Días entre tandas de mensajes. */
const POST_EVERY_DAYS = 10;
/** Mensajes que se fijan en cada tanda (de lotes al azar, ponderados por ocupantes). */
const POSTS_PER_ROUND = 2;

/** El Ágora usa su propio generador: lo que digan los vecinos no cambia cómo crece la ciudad. */
const rnd = (agora: Agora) => random(agora);
const pick = <T>(agora: Agora, items: readonly T[]): T => items[Math.floor(rnd(agora) * items.length)];

/** Lote con gente al azar, con más probabilidad cuanta más gente tenga. */
function randomLot(state: GameState): number {
  const { map } = state;
  let total = 0;
  for (let i = 0; i < map.lotOccupants.length; i++) if (map.lotLevel[i]) total += map.lotOccupants[i] + 1;
  if (!total) return -1;
  let r = rnd(state.agora) * total;
  for (let i = 0; i < map.lotOccupants.length; i++) {
    if (!map.lotLevel[i]) continue;
    r -= map.lotOccupants[i] + 1;
    if (r <= 0) return i;
  }
  return -1;
}

/** El tema más importante para un lote, según quién hable en él. */
export function topicFor(state: GameState, i: number): TopicDef | null {
  const speaker = state.map.zoneType[i] === ZONE_CODE.R ? 'vecino' : 'negocio';
  return TOPICS.find((t) => t.speaker === speaker && t.detect(state, i)) ?? null;
}

function post(state: GameState, i: number, topic: TopicDef): void {
  const { map, agora } = state;
  const x = i % map.width;
  const y = (i - x) / map.width;
  const author = topic.speaker === 'vecino' ? pick(agora, FIRST_NAMES) : `${pick(agora, BUSINESSES)} ${pick(agora, FIRST_NAMES)}`;
  agora.posts.unshift({ day: state.time.tick, x, y, author, barrio: neighborhoodName(state, x, y), text: pick(agora, topic.lines), tone: topic.tone, topic: topic.id });
  agora.posts.length = Math.min(agora.posts.length, POSTS_KEPT);
}

/** Objetivo de aprobación: la felicidad, más el empleo, los impuestos y las cuentas. */
export function approvalTarget(state: GameState): number {
  const { stats, economy } = state;
  const unemployment = unemploymentRate(state);
  const avgTax = (economy.taxes.R + economy.taxes.C + economy.taxes.I) / 3;
  let t = stats.happiness + APPROVAL_INCUMBENT;
  t -= Math.max(0, unemployment - 0.05) * 150;
  t -= Math.max(0, avgTax - 9) * 3;
  if (economy.money < 0) t -= 10;
  return Math.max(0, Math.min(100, t));
}

function checkPetitions(state: GameState, events: SimEvent[]): void {
  const { agora, map } = state;
  for (const p of agora.petitions) {
    if (p.status !== 'open') continue;
    const goal = getTopic(p.topic)?.petition?.goal(state, p.y * map.width + p.x);
    if (goal?.done) {
      p.status = 'done';
      agora.approval = Math.min(100, agora.approval + PETITION_APPROVAL);
      agora.petitionsDone++;
      addEffect(state, { id: `peticion-${p.id}`, label: 'Vecinos agradecidos', monthsLeft: 3, happiness: 2 });
      events.push({ type: 'petition', title: p.title, done: true });
    } else if (state.time.tick >= p.deadline) {
      p.status = 'failed';
      agora.approval = Math.max(0, agora.approval - PETITION_APPROVAL);
      events.push({ type: 'petition', title: p.title, done: false });
    }
  }
  // Se guardan las abiertas y las últimas resueltas
  const open = agora.petitions.filter((p) => p.status === 'open');
  const closed = agora.petitions.filter((p) => p.status !== 'open').slice(0, PETITIONS_KEPT - open.length);
  agora.petitions = [...open, ...closed];
}

/** La queja más repetida de los dos últimos meses se convierte en petición, en el sitio del último mensaje. */
function maybePetition(state: GameState, events: SimEvent[]): void {
  const { agora, time } = state;
  const open = agora.petitions.filter((p) => p.status === 'open');
  if (open.length >= MAX_OPEN_PETITIONS || rnd(agora) >= PETITION_CHANCE) return;
  // Ni lo que ya se está pidiendo ni lo que se pidió hace poco en el mismo barrio
  const asked = (p: AgoraPost) =>
    agora.petitions.some((o) => o.topic === p.topic && o.barrio === p.barrio && (o.status === 'open' || time.tick - o.deadline < PETITION_REPEAT_DAYS));
  const candidates = agora.posts.filter((p) => time.tick - p.day <= 60 && p.tone === 'queja' && getTopic(p.topic)?.petition && !asked(p));
  const counts = new Map<string, number>();
  for (const p of candidates) counts.set(p.topic, (counts.get(p.topic) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best) return;
  const source = candidates.find((p) => p.topic === best[0])!;
  const def = getTopic(best[0])!.petition!;
  const petition: Petition = {
    id: agora.nextPetitionId++,
    topic: best[0],
    title: def.title(source.barrio),
    barrio: source.barrio,
    x: source.x,
    y: source.y,
    created: time.tick,
    deadline: time.tick + def.months * 30,
    status: 'open',
  };
  agora.petitions.unshift(petition);
  events.push({ type: 'petitionNew', title: petition.title, x: petition.x, y: petition.y });
}

/** Elecciones en enero de cada año de elecciones; avisos a 6 meses y a 1 mes. */
function elections(state: GameState, events: SimEvent[], month: number): void {
  const { agora, time } = state;
  if (!agora.elections) return;
  if (time.year === agora.nextElection - 1 && (month === 7 || month === 12)) {
    events.push({ type: 'electionSoon', months: month === 7 ? 6 : 1, approval: Math.round(agora.approval) });
  }
  if (month !== 1 || time.year < agora.nextElection) return;
  const share = Math.max(5, Math.min(95, agora.approval + (rnd(agora) - 0.5) * 6));
  const won = share >= 50;
  if (won) agora.electionsWon++;
  else agora.elections = false; // fin del mandato: la partida puede seguir, pero sin más elecciones
  agora.nextElection = time.year + ELECTION_YEARS;
  events.push({ type: 'election', won, share: Math.round(share), year: time.year });
}

/**
 * El Ágora (fase 18): cada POST_EVERY_DAYS días hablan algunos vecinos y negocios; al cerrar el mes
 * se mueve la aprobación, se revisan y se abren peticiones y, cuando toca, hay elecciones.
 */
export function updateAgora(state: GameState, events: SimEvent[]): void {
  const { agora, time } = state;
  if (state.stats.population > 0 && time.tick % POST_EVERY_DAYS === 0) {
    for (let k = 0; k < POSTS_PER_ROUND; k++) {
      const i = randomLot(state);
      const topic = i >= 0 ? topicFor(state, i) : null;
      if (topic) post(state, i, topic);
    }
  }
  const month = events.find((e) => e.type === 'newMonth');
  if (!month || month.type !== 'newMonth') return;
  agora.approval += (approvalTarget(state) - agora.approval) * APPROVAL_SMOOTHING;
  checkPetitions(state, events);
  maybePetition(state, events);
  elections(state, events, month.month);
}
