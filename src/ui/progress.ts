import { ACHIEVEMENTS } from '../sim/data/achievements';
import { RANKS } from '../sim/data/progression';
import { getScenario } from '../sim/data/scenarios';
import { nextPlotCost, ownedPlots } from '../sim/land';
import { scenarioGoals } from '../sim/scenarios';
import type { GameState } from '../sim/state';
import { unlocksBetween } from '../sim/systems/progress';
import { rankEmblemSVG } from './brand';
import { icon } from './icons';
import { formatMoney } from './menus';

const REFRESH_MS = 500;
const n = (v: number) => v.toLocaleString('es-ES');

function bar(value: number, done = value >= 1): string {
  return `<div class="meter-track"><div class="meter-fill" style="width:${Math.round(Math.min(1, value) * 100)}%;background:${done ? 'var(--ui-positive)' : 'var(--ui-gold)'}"></div></div>`;
}

/** Panel de progreso: rango y próxima meta, terreno, escenario en curso y logros. */
export class ProgressPanel {
  readonly el = document.createElement('section');
  private body = document.createElement('div');
  private lastHtml = '';
  private lastRefresh = 0;

  constructor(onClose: () => void) {
    this.el.className = 'panel side-panel progress hidden';
    this.el.setAttribute('aria-label', 'Progreso');
    const head = document.createElement('div');
    head.className = 'panel-head';
    head.innerHTML = '<div><span class="kicker">Ciudad</span><h2 class="title">Progreso</h2></div>';
    const close = document.createElement('button');
    close.className = 'icon-btn';
    close.innerHTML = icon('close', 16);
    close.dataset.tip = 'Cerrar';
    close.dataset.key = 'L';
    close.setAttribute('aria-label', 'Cerrar');
    close.onclick = onClose;
    head.append(close);
    this.body.className = 'panel-body';
    this.el.append(head, this.body);
  }

  get open(): boolean {
    return !this.el.classList.contains('hidden');
  }

  toggle(force?: boolean): void {
    this.el.classList.toggle('hidden', !(force ?? !this.open));
    this.lastRefresh = 0;
  }

  update(state: GameState): void {
    if (!this.open || performance.now() - this.lastRefresh < REFRESH_MS) return;
    this.lastRefresh = performance.now();
    const html = this.render(state);
    if (html !== this.lastHtml) {
      this.body.innerHTML = html;
      this.lastHtml = html;
    }
  }

  private render(state: GameState): string {
    const p = state.progress;
    const rank = RANKS[p.rank];
    const next = RANKS[p.rank + 1];
    let html = `<div class="rank-card">${rankEmblemSVG(p.rank, RANKS.length, 84)}<div>
      <span class="kicker">Rango ${p.rank + 1} de ${RANKS.length}</span>
      <span class="rank-name">${rank.name}</span></div></div>`;
    if (next) {
      const progress = (p.peakPopulation - rank.population) / (next.population - rank.population);
      const unlocks = unlocksBetween(rank.population, next.population);
      html += `<div class="section-title"><span class="kicker">Siguiente: ${next.name}</span><span class="muted num">${n(p.peakPopulation)} / ${n(next.population)}</span></div>
        ${bar(progress, false)}
        <div class="kv"><span>Subvención</span><span>${formatMoney(next.grant)}</span></div>
        ${unlocks.length ? `<div class="kv"><span>Desbloquea</span><span>${unlocks.join(', ')}</span></div>` : ''}
        ${state.land ? `<div class="kv"><span>Parcelas permitidas</span><span>${next.maxPlots === Infinity ? 'todas' : n(next.maxPlots)}</span></div>` : ''}`;
    } else {
      html += '<p class="muted">Has alcanzado el rango más alto.</p>';
    }

    if (state.land) {
      const owned = ownedPlots(state.land);
      const max = rank.maxPlots === Infinity ? state.land.owned.length : rank.maxPlots;
      html += `<div class="section-title"><span class="kicker">Terreno</span></div>
        <div class="kv"><span>Parcelas</span><span>${owned} de ${Math.min(max, state.land.owned.length)} permitidas</span></div>
        <div class="kv"><span>Siguiente parcela</span><span>${formatMoney(nextPlotCost(state))}</span></div>
        <p class="muted">Compra parcelas vecinas con la herramienta Terrenos del dock.</p>`;
    }

    const inc = state.incidents;
    const outages = [...state.buildings.values()].filter((b) => b.outage);
    if (inc.effects.length || inc.burning || outages.length) {
      html += `<div class="section-title"><span class="kicker">En curso</span></div>`;
      if (inc.burning) html += `<div class="kv"><span>Incendio</span><span class="tone-negative">${n(inc.burning)} ${inc.burning === 1 ? 'edificio' : 'edificios'} en llamas</span></div>`;
      for (const b of outages) html += `<div class="kv"><span>Avería</span><span class="tone-warning">${b.outage} ${b.outage === 1 ? 'día' : 'días'} para la reparación</span></div>`;
      for (const e of inc.effects) html += `<div class="kv"><span>${e.label}</span><span>${e.monthsLeft} ${e.monthsLeft === 1 ? 'mes' : 'meses'}</span></div>`;
    }

    const sc = state.scenario;
    const def = sc && getScenario(sc.id);
    if (sc && def) {
      const left = sc.endYear - state.time.year;
      const status = sc.status === 'won' ? '<span class="tone-positive">Completado</span>' : sc.status === 'lost' ? '<span class="tone-negative">Plazo agotado</span>' : `${left} ${left === 1 ? 'año' : 'años'} de plazo`;
      html += `<div class="section-title"><span class="kicker">Escenario · ${def.name}</span><span class="muted">${status}</span></div>`;
      for (const g of scenarioGoals(state)) {
        html += `<div class="goal"><span>${g.label}</span>${bar(g.progress)}<span class="num">${Math.round(g.progress * 100)} %</span></div>`;
      }
    }

    const got = ACHIEVEMENTS.filter((a) => p.achievements.includes(a.id)).length;
    html += `<div class="section-title"><span class="kicker">Logros</span><span class="muted num">${got} de ${ACHIEVEMENTS.length}</span></div>`;
    if (state.sandbox) html += '<p class="muted">En el modo libre los logros no cuentan.</p>';
    html += '<div class="achievements">';
    for (const a of ACHIEVEMENTS) {
      const done = p.achievements.includes(a.id);
      html += `<div class="achievement ${done ? 'is-done' : ''}"><span class="icon-wrap">${icon(done ? 'spark' : 'lock', 14)}</span><div><span class="achievement-name">${a.name}</span><span class="muted">${a.description}</span></div></div>`;
    }
    return `${html}</div>`;
  }
}
