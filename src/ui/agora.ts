import { PETITION_APPROVAL } from '../sim/config';
import { getTopic } from '../sim/data/agora';
import type { GameState } from '../sim/state';
import type { Point } from '../sim/types';
import { icon } from './icons';

const REFRESH_MS = 500;
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** «hoy», «hace 3 días», «hace 2 meses». */
function ago(days: number): string {
  if (days < 1) return 'hoy';
  if (days < 30) return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
  const months = Math.floor(days / 30);
  return `hace ${months} ${months === 1 ? 'mes' : 'meses'}`;
}

function left(days: number): string {
  if (days < 30) return `quedan ${Math.max(0, days)} días`;
  const months = Math.round(days / 30);
  return `quedan ${months} ${months === 1 ? 'mes' : 'meses'}`;
}

/**
 * Ágora: la voz de la ciudad. Arriba la aprobación y las elecciones; debajo, en dos pestañas,
 * lo que dicen vecinos y negocios (cada mensaje lleva a su sitio) y las peticiones con plazo.
 */
export class AgoraPanel {
  readonly el = document.createElement('section');
  private body = document.createElement('div');
  private tab: 'posts' | 'petitions' = 'posts';
  private lastHtml = '';
  private lastRefresh = 0;

  constructor(
    onClose: () => void,
    private focus: (tile: Point) => void,
  ) {
    this.el.className = 'panel side-panel agora hidden';
    this.el.setAttribute('aria-label', 'Ágora');
    const head = document.createElement('div');
    head.className = 'panel-head';
    head.innerHTML = '<div><span class="kicker">Ciudad</span><h2 class="title">Ágora</h2></div>';
    const close = document.createElement('button');
    close.className = 'icon-btn';
    close.innerHTML = icon('close', 16);
    close.dataset.tip = 'Cerrar';
    close.dataset.key = 'G';
    close.setAttribute('aria-label', 'Cerrar');
    close.onclick = onClose;
    head.append(close);
    this.body.className = 'panel-body';
    this.body.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tab], [data-x]');
      if (!t) return;
      if (t.dataset.tab) {
        this.tab = t.dataset.tab as typeof this.tab;
        this.lastRefresh = 0;
      } else this.focus({ x: Number(t.dataset.x), y: Number(t.dataset.y) });
    });
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
    const { agora, time } = state;
    const approval = Math.round(agora.approval);
    const tone = approval >= 55 ? 'var(--ui-positive)' : approval >= 50 ? 'var(--ui-warning)' : 'var(--ui-negative)';
    let election: string;
    if (!agora.elections) election = state.sandbox ? 'Sin elecciones en el modo libre' : 'Sin elecciones en esta partida';
    else {
      const months = (agora.nextElection - time.year) * 12 - (time.month - 1);
      const y = Math.floor(months / 12);
      const m = months % 12;
      const wait = [y ? `${y} ${y === 1 ? 'año' : 'años'}` : '', m ? `${m} ${m === 1 ? 'mes' : 'meses'}` : ''].filter(Boolean).join(' y ');
      election = `Elecciones en ${MONTHS[0]} de ${agora.nextElection}${wait ? ` · faltan ${wait}` : ''} · se gana con un 50 %`;
    }
    const open = agora.petitions.filter((p) => p.status === 'open').length;
    let html = `<div class="approval-card">
        <div class="approval-row"><span class="kicker">Aprobación del alcalde</span><span class="approval-value num">${approval} %</span></div>
        <div class="meter-track approval-track"><div class="meter-fill" style="width:${approval}%;background:${tone}"></div><span class="approval-mark"></span></div>
        <span class="muted">${election}</span>
      </div>
      <div class="tabs" role="tablist">
        <button role="tab" data-tab="posts" class="${this.tab === 'posts' ? 'is-active' : ''}" aria-selected="${this.tab === 'posts'}">Vecinos</button>
        <button role="tab" data-tab="petitions" class="${this.tab === 'petitions' ? 'is-active' : ''}" aria-selected="${this.tab === 'petitions'}">Peticiones${open ? ` (${open})` : ''}</button>
      </div>`;

    if (this.tab === 'posts') {
      if (!agora.posts.length) return `${html}<p class="muted">Cuando llegue gente a la ciudad, aquí verás lo que opina.</p>`;
      html += '<div class="posts">';
      for (const p of agora.posts) {
        html += `<button class="post post--${p.tone}" data-x="${p.x}" data-y="${p.y}" data-tip="Ver en el mapa">
          <span class="icon-wrap">${icon(p.tone === 'queja' ? 'alert' : 'spark', 14)}</span>
          <span class="post-body"><span class="post-text">«${esc(p.text)}»</span>
          <span class="post-meta">${esc(p.author)} · ${esc(p.barrio)} · ${ago(time.tick - p.day)}</span></span>
        </button>`;
      }
      return `${html}</div>`;
    }

    if (!agora.petitions.length) {
      return `${html}<p class="muted">Cuando una queja se repita, los vecinos presentarán una petición con plazo. Cumplirla sube ${PETITION_APPROVAL} puntos la aprobación; dejarla pasar los baja.</p>`;
    }
    html += '<div class="petitions">';
    for (const p of agora.petitions) {
      const goal = getTopic(p.topic)?.petition?.goal(state, p.y * state.map.width + p.x);
      const status =
        p.status === 'done' ? '<span class="tone-positive">Cumplida</span>' : p.status === 'failed' ? '<span class="tone-negative">Sin cumplir</span>' : `<span>${left(p.deadline - time.tick)}</span>`;
      const progress = goal && p.status === 'open' ? (goal.binary ? `<div class="kv"><span>${goal.label}</span><span class="tone-negative">Todavía no</span></div>` : goalBar(goal.label, goal.value, goal.target)) : '';
      html += `<div class="petition ${p.status !== 'open' ? 'is-closed' : ''}">
        <div class="petition-head"><span class="petition-title">${esc(p.title)}</span><span class="muted">${status}</span></div>
        ${progress}
        <div class="petition-foot"><span class="muted">${p.status === 'open' ? `±${PETITION_APPROVAL} de aprobación` : esc(p.barrio)}</span>
        <button class="btn" data-x="${p.x}" data-y="${p.y}">Ver</button></div>
      </div>`;
    }
    return `${html}</div>`;
  }
}

/** Barra de un objetivo «llegar a» o «bajar de» con su valor actual. */
function goalBar(label: string, value: number, target: number): string {
  // Para «bajar de» (el valor empieza por encima), la barra muestra lo que falta recorrer
  const lower = value > target;
  const progress = lower ? Math.max(0, Math.min(1, target / Math.max(value, 1))) : Math.min(1, value / target);
  return `<div class="goal"><span>${label}</span><div class="meter-track"><div class="meter-fill" style="width:${Math.round(progress * 100)}%;background:var(--ui-gold)"></div></div><span class="num">${value} / ${target}</span></div>`;
}
