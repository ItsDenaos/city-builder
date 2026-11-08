import type { Command } from '../sim/commands';
import {
  FUNDING_MAX,
  FUNDING_MIN,
  FUNDING_STEP,
  LOAN_AMOUNTS,
  LOAN_ANNUAL_RATE,
  LOAN_MONTHS,
  MAX_DISTRICTS,
  MAX_LOANS,
  MAX_ORDINANCES,
  TAX_MAX,
  TAX_MIN,
} from '../sim/config';
import { DEPARTMENTS } from '../sim/data/departments';
import { ORDINANCES } from '../sim/data/ordinances';
import { ZONE_TYPE_LABEL } from '../sim/data/zones';
import { isUnlocked } from '../sim/state';
import type { Budget, GameState } from '../sim/state';
import { districtStats } from '../sim/systems/districts';
import { estimateBudget, loanPayment } from '../sim/systems/economy';
import { DATA, FONTS, UI } from '../theme';
import { icon } from './icons';
import { formatMoney } from './menus';

const EXPENSE_LABELS: Record<keyof Budget['expenses'], string> = {
  roads: 'Carreteras',
  networks: 'Tendido y tuberías',
  power: 'Electricidad',
  water: 'Agua',
  services: 'Servicios',
  parks: 'Parques',
  transport: 'Transporte',
  waste: 'Residuos',
  monuments: 'Monumentos',
  ordinances: 'Ordenanzas',
  loans: 'Préstamos',
};
const ZONE_DOT = { R: DATA.zoneR, C: DATA.zoneC, I: DATA.zoneI };
const HISTORY_SHOWN = 24;
const REFRESH_MS = 250;

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${formatMoney(Math.abs(n))}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Panel de presupuesto: impuestos, gastos estimados, último mes, préstamos e historial del dinero. */
export class BudgetPanel {
  readonly el = document.createElement('section');
  private body = document.createElement('div');
  private chart = document.createElement('canvas');
  private lastHtml = '';
  private lastRefresh = 0;
  private lastState: GameState | null = null;

  constructor(
    private run: (cmd: Command) => void,
    onClose: () => void,
  ) {
    this.el.className = 'panel side-panel budget hidden';
    this.el.setAttribute('aria-label', 'Presupuesto');
    const head = document.createElement('div');
    head.className = 'panel-head';
    head.innerHTML = '<div><span class="kicker">Gestión</span><h2 class="title">Presupuesto</h2></div>';
    const close = document.createElement('button');
    close.className = 'icon-btn';
    close.innerHTML = icon('close', 16);
    close.dataset.tip = 'Cerrar';
    close.dataset.key = 'P';
    close.setAttribute('aria-label', 'Cerrar');
    close.onclick = onClose;
    head.append(close);
    this.chart.width = 640;
    this.chart.height = 120;
    this.chart.className = 'budget-chart';
    const wrap = document.createElement('div');
    wrap.className = 'panel-body';
    wrap.append(this.body, this.chart);
    this.body.className = 'budget-content';
    this.el.append(head, wrap);

    // Un solo listener para todos los botones del panel (se regeneran con el contenido)
    this.body.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b?.dataset.rename) {
        const id = Number(b.dataset.rename);
        const current = this.lastState?.districts.find((d) => d.id === id);
        const name = current ? window.prompt('Nuevo nombre del distrito', current.name) : null;
        if (name !== null) this.run({ type: 'renameDistrict', id, name });
        this.lastRefresh = 0;
        return;
      }
      if (!b?.dataset.cmd) return;
      this.run(JSON.parse(b.dataset.cmd) as Command);
      this.lastRefresh = 0; // refrescar ya
    });
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
    this.lastState = state;
    const html = this.render(state);
    if (html !== this.lastHtml) {
      this.body.innerHTML = html;
      this.lastHtml = html;
    }
    this.drawChart(state);
  }

  private render(state: GameState): string {
    const { economy } = state;
    const est = estimateBudget(state);
    const cmd = (c: Command) => `data-cmd='${JSON.stringify(c)}'`;
    const kv = (label: string, value: string, cls = '') => `<div class="kv ${cls}"><span>${label}</span><span>${value}</span></div>`;
    const toneOf = (v: number) => (v < 0 ? 'tone-negative' : 'tone-positive');

    const taxes = (['R', 'C', 'I'] as const)
      .map((z) => {
        const rate = economy.taxes[z];
        return `<div class="tax-row">
          <span class="tax-zone"><span class="swatch" style="background:${ZONE_DOT[z]}"></span>${ZONE_TYPE_LABEL[z]}</span>
          <span class="stepper">
            <button class="icon-btn" ${cmd({ type: 'setTaxRate', zone: z, rate: rate - 1 })} ${rate <= TAX_MIN ? 'disabled' : ''} aria-label="Bajar impuesto ${ZONE_TYPE_LABEL[z].toLowerCase()}">${icon('minus', 14)}</button>
            <span class="stepper-value num">${rate} %</span>
            <button class="icon-btn" ${cmd({ type: 'setTaxRate', zone: z, rate: rate + 1 })} ${rate >= TAX_MAX ? 'disabled' : ''} aria-label="Subir impuesto ${ZONE_TYPE_LABEL[z].toLowerCase()}">${icon('plus', 14)}</button>
          </span>
          <span class="num tax-income">${formatMoney(est.income[z])}</span>
        </div>`;
      })
      .join('');

    const expenses =
      (Object.keys(EXPENSE_LABELS) as (keyof Budget['expenses'])[])
        .filter((k) => est.expenses[k] > 0)
        .map((k) => kv(EXPENSE_LABELS[k], formatMoney(est.expenses[k])))
        .join('') || kv('Sin gastos', formatMoney(0));

    const last = economy.lastMonth
      ? kv('Ingresos', formatMoney(economy.lastMonth.totalIncome)) +
        kv('Gastos', formatMoney(economy.lastMonth.totalExpenses)) +
        `<div class="kv is-total"><span>Balance</span><span class="${toneOf(economy.lastMonth.net)}">${signed(economy.lastMonth.net)}</span></div>`
      : '<p class="muted">Todavía no ha cerrado ningún mes.</p>';

    const loans = economy.loans.length
      ? economy.loans
          .map(
            (l) => `<div class="loan">
              <div><span class="num">${formatMoney(l.amount)}</span><span class="muted num">Pendiente ${formatMoney(l.balance)} · ${formatMoney(l.monthlyPayment)}/mes · ${l.monthsLeft} meses</span></div>
              <button class="btn" ${cmd({ type: 'repayLoan', loanId: l.id })} ${economy.money < l.balance ? 'disabled' : ''} data-tip="${esc(`Pagar ${formatMoney(l.balance)} ahora`)}">Saldar</button>
            </div>`,
          )
          .join('')
      : '<p class="muted">Sin préstamos.</p>';
    const full = economy.loans.length >= MAX_LOANS;
    const offers = LOAN_AMOUNTS.map(
      (a) =>
        `<button class="btn" ${cmd({ type: 'takeLoan', amount: a })} ${full ? 'disabled' : ''} data-tip="${esc(`${formatMoney(loanPayment(a))} al mes durante ${LOAN_MONTHS / 12} años`)}">${formatMoney(a)}</button>`,
    ).join('');

    const funding = DEPARTMENTS.map((d) => {
      const value = economy.funding[d.id];
      const set = (v: number) => cmd({ type: 'setFunding', dept: d.id, value: v });
      return `<div class="tax-row" data-tip="${esc(d.effect)}">
        <span class="tax-zone">${d.label}</span>
        <span class="stepper">
          <button class="icon-btn" ${set(value - FUNDING_STEP)} ${value <= FUNDING_MIN ? 'disabled' : ''} aria-label="Bajar financiación de ${d.label.toLowerCase()}">${icon('minus', 14)}</button>
          <span class="stepper-value num">${value} %</span>
          <button class="icon-btn" ${set(value + FUNDING_STEP)} ${value >= FUNDING_MAX ? 'disabled' : ''} aria-label="Subir financiación de ${d.label.toLowerCase()}">${icon('plus', 14)}</button>
        </span>
        <span class="num tax-income">${formatMoney(est.departments[d.id])}</span>
      </div>`;
    }).join('');

    const active = economy.ordinances.length;
    const ordinances = ORDINANCES.map((o) => {
      const on = economy.ordinances.includes(o.id);
      const locked = !on && !isUnlocked(state, o.unlockAtPopulation);
      const full = !on && active >= MAX_ORDINANCES;
      const note = locked ? `Con ${o.unlockAtPopulation.toLocaleString('es-ES')} hab.` : `${formatMoney(o.cost)}/mes`;
      return `<div class="ordinance ${on ? 'is-on' : ''}" data-tip="${esc(o.summary)}">
        <span class="ordinance-text"><span>${o.name}</span><span class="muted num">${note}</span></span>
        <button class="btn" ${cmd({ type: 'toggleOrdinance', id: o.id })} ${locked || full ? 'disabled' : ''}>${on ? 'Derogar' : 'Aprobar'}</button>
      </div>`;
    }).join('');

    const districts = state.districts.length
      ? state.districts
          .map((d) => {
            const s = districtStats(state, d);
            return `<div class="district">
              <div class="district-head"><span class="district-name">${esc(d.name)}</span>
                <span class="district-actions">
                  <button class="btn" data-rename="${d.id}" aria-label="Renombrar ${esc(d.name)}">Renombrar</button>
                  <button class="icon-btn" ${cmd({ type: 'removeDistrict', id: d.id })} aria-label="Quitar ${esc(d.name)}" data-tip="Quitar distrito">${icon('close', 14)}</button>
                </span></div>
              <span class="muted num">${s.population.toLocaleString('es-ES')} hab. · ${s.workers.toLocaleString('es-ES')} empleos · felicidad ${s.population ? Math.round(s.happiness) : '—'}</span>
              <span class="muted num">Contaminación ${Math.round(s.pollution)} · crimen ${Math.round(s.crime)}</span>
            </div>`;
          })
          .join('')
      : '<p class="muted">Sin distritos. Usa la herramienta «Distritos» de la barra inferior para delimitar y nombrar una zona.</p>';

    return `
      <div class="section-title"><span class="kicker">Impuestos</span><span class="kicker">Ingreso / mes</span></div>
      ${taxes}
      ${est.fares > 0 ? kv('Billetes de transporte', formatMoney(est.fares)) : ''}
      ${est.tourism > 0 ? kv('Turismo', formatMoney(est.tourism)) : ''}
      <div class="section-title"><span class="kicker">Financiación</span><span class="kicker">Gasto / mes</span></div>
      ${funding}
      <p class="muted">En los servicios, por debajo de 100 % la cobertura es más débil y por encima llega más lejos; en el transporte cambia la frecuencia. Más financiación, más gasto.</p>
      <div class="section-title"><span class="kicker">Ordenanzas</span><span class="muted">${active} / ${MAX_ORDINANCES}</span></div>
      ${ordinances}
      <div class="section-title"><span class="kicker">Distritos</span><span class="muted">${state.districts.length} / ${MAX_DISTRICTS}</span></div>
      ${districts}
      <div class="section-title"><span class="kicker">Gastos estimados / mes</span></div>
      <div>${expenses}<div class="kv is-total"><span>Balance estimado</span><span class="${toneOf(est.net)}">${signed(est.net)} / mes</span></div></div>
      <div class="section-title"><span class="kicker">Último mes</span></div>
      <div>${last}</div>
      <div class="section-title"><span class="kicker">Préstamos</span><span class="muted">${LOAN_ANNUAL_RATE * 100} % anual · ${LOAN_MONTHS / 12} años</span></div>
      ${
        state.sandbox
          ? '<p class="muted">En el modo libre el dinero es ilimitado: el presupuesto solo es orientativo.</p>'
          : `${loans}<div class="loan-offers"><span class="muted">Pedir</span>${offers}</div>${full ? `<p class="muted">Máximo ${MAX_LOANS} préstamos a la vez.</p>` : ''}`
      }
      <div class="section-title"><span class="kicker">Dinero</span><span class="muted">últimos ${HISTORY_SHOWN} meses</span></div>`;
  }

  private drawChart(state: GameState): void {
    const ctx = this.chart.getContext('2d')!;
    const { width: w, height: h } = this.chart;
    ctx.clearRect(0, 0, w, h);
    const points = state.economy.history.slice(-HISTORY_SHOWN).map((p) => p.money);
    if (points.length < 2) {
      ctx.fillStyle = UI.textMuted;
      ctx.font = `22px ${FONTS.body}`;
      ctx.textAlign = 'center';
      ctx.fillText('El historial aparece tras el segundo mes.', w / 2, h / 2);
      return;
    }
    const min = Math.min(0, ...points);
    const max = Math.max(1, ...points);
    const x = (i: number) => (i / (points.length - 1)) * (w - 8) + 4;
    const y = (v: number) => h - 6 - ((v - min) / (max - min)) * (h - 12);
    ctx.strokeStyle = UI.lineStrong;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y(0));
    ctx.lineTo(w, y(0));
    ctx.stroke();
    const color = points[points.length - 1] >= 0 ? DATA.income : DATA.expense;
    // Área bajo la curva, muy tenue, y la línea encima
    ctx.beginPath();
    points.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.lineTo(x(points.length - 1), y(0));
    ctx.lineTo(x(0), y(0));
    ctx.closePath();
    ctx.fillStyle = `${color}22`;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    points.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x(points.length - 1), y(points[points.length - 1]), 5, 0, Math.PI * 2);
    ctx.fill();
  }
}
