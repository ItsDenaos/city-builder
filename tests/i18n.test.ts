import { describe, expect, it } from 'vitest';
import { translate } from '../src/ui/i18n';
import { ACHIEVEMENTS } from '../src/sim/data/achievements';
import { TOPICS } from '../src/sim/data/agora';
import { BUILDINGS, BUILDING_CATEGORIES } from '../src/sim/data/buildings';
import { DEPARTMENTS } from '../src/sim/data/departments';
import { INCIDENTS } from '../src/sim/data/incidents';
import { ORDINANCES } from '../src/sim/data/ordinances';
import { RANKS } from '../src/sim/data/progression';
import { ROADS } from '../src/sim/data/roads';
import { SCENARIOS } from '../src/sim/data/scenarios';
import { SEASON_LABEL, WEATHER } from '../src/sim/data/weather';
import { ZONES } from '../src/sim/data/zones';
import { TUTORIAL } from '../src/sim/tutorial';
import { SETTING_FIELDS } from '../src/ui/settings';

const en = (s: string) => translate(s, 'en');

describe('inglés (fase 21)', () => {
  it('traduce textos exactos y conserva los espacios de alrededor', () => {
    expect(en('Presupuesto')).toBe('Budget');
    expect(en('  Pausa ')).toBe('  Pause ');
    expect(translate('Presupuesto', 'es')).toBe('Presupuesto');
  });

  it('deja igual lo que no conoce, como los nombres propios', () => {
    expect(en('Villaverde')).toBe('Villaverde');
    expect(en('Español')).toBe('Español');
    expect(en('')).toBe('');
  });

  it('rellena las plantillas y traduce también lo que cae en los huecos', () => {
    expect(en('Desbloqueado: Hospital (1.000 habitantes)')).toBe('Unlocked: Hospital (1,000 residents)');
    expect(en('Electricidad para Las Eras')).toBe('Power for Las Eras');
    expect(en('Termina: Ola de calor')).toBe('Ends: Heatwave');
  });

  it('puede cambiar el orden de los huecos y elige la plantilla más concreta', () => {
    expect(en('Atenas ya es una gran ciudad.')).toBe('Atenas is now a large city.');
    expect(en('Atenas ya es un pueblo.')).toBe('Atenas is now a village.');
    expect(en('Atenas ya es una Akropolis.')).toBe('Atenas is now an Akropolis.');
  });

  it('pasa los números al formato inglés sin tocar los nombres con «de»', () => {
    expect(en('$12.500')).toBe('$12,500');
    expect(en('−1.250.000 $')).toBe('−1,250,000 $');
    expect(en('0,4')).toBe('0.4');
    expect(en('3 de 5')).toBe('3 of 5');
    expect(en('Barrio de la Estación')).toBe('Barrio de la Estación');
  });

  it('traduce lo que dicen los vecinos y las líneas con varios trozos', () => {
    expect(en('«Me encanta vivir aquí.»')).toBe('“I love living here.”');
    expect(en('Rosa · Los Tilos · hace 7 días')).toBe('Rosa · Los Tilos · 7 days ago');
    expect(en('Ranura 3 · 1/2012 · 30.194 hab. · $15.817 · guardada el 8/11/26, 15:42')).toBe('Slot 3 · 1/2012 · 30,194 res. · $15,817 · saved 8/11/26, 15:42');
  });

  it('traduce la fecha de la barra superior', () => {
    expect(en('12 mar 2005')).toBe('Mar 12, 2005');
    expect(en('1 dic 2010')).toBe('Dec 1, 2010');
  });

  it('todos los textos de los catálogos tienen traducción', () => {
    const texts: string[] = [];
    for (const a of ACHIEVEMENTS) texts.push(a.name, a.description);
    for (const t of TOPICS) {
      texts.push(...t.lines);
      if (t.petition) texts.push(t.petition.title('Las Eras'));
    }
    for (const b of BUILDINGS) texts.push(b.name);
    for (const c of BUILDING_CATEGORIES) texts.push(c.label);
    for (const d of DEPARTMENTS) texts.push(d.label, d.effect);
    for (const i of INCIDENTS) texts.push(i.kicker, i.title, ...i.choices.map((c) => c.label));
    for (const o of ORDINANCES) texts.push(o.name, o.summary);
    for (const r of RANKS) if (r.id !== 'akropolis') texts.push(r.name, r.name.toLowerCase());
    for (const r of Object.values(ROADS)) texts.push(r.name, `${r.name} curva`);
    for (const s of SCENARIOS) texts.push(s.name, s.summary, ...s.goals.map((g) => g.label));
    for (const w of Object.values(WEATHER)) texts.push(w.label, `${w.label} · ${SEASON_LABEL.winter}`);
    for (const z of ZONES) texts.push(z.label, z.buildingName);
    for (const t of TUTORIAL) texts.push(t.title, t.hint);
    for (const f of SETTING_FIELDS) {
      texts.push(f.label, ...(f.detail ? [f.detail] : []));
      for (const o of f.options) if (!/^[\d\s%]+$/.test(o.label) && !['Español', 'English', 'No'].includes(o.label)) texts.push(o.label);
    }
    // Palabras que se escriben igual en los dos idiomas
    const same = new Set(['Akropolis', 'Hospital']);
    const missing = texts.filter((t) => en(t) === t && !same.has(t));
    expect(missing, `sin traducir: ${missing.join(' | ')}`).toEqual([]);
  });
});
