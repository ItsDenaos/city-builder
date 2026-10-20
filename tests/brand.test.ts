import { describe, expect, it } from 'vitest';
import favicon from '../public/brand/akropolis-favicon.svg?raw';
import lockupDark from '../public/brand/akropolis-lockup-dark.svg?raw';
import lockupLight from '../public/brand/akropolis-lockup-light.svg?raw';
import symbolDark from '../public/brand/akropolis-symbol-dark.svg?raw';
import symbolLight from '../public/brand/akropolis-symbol-light.svg?raw';
import symbolMono from '../public/brand/akropolis-symbol-mono.svg?raw';
import { getZoneDef } from '../src/sim/data/zones';
import { BRAND, DATA } from '../src/theme';
import { lockupHTML, symbolSVG } from '../src/ui/brand';

const paths = (svg: string) => [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);

describe('marca AKROPOLIS', () => {
  it('los SVG publicados usan el mismo símbolo que el juego', () => {
    const symbol = paths(symbolSVG('light'));
    for (const file of [symbolLight, symbolDark, symbolMono, favicon, lockupLight, lockupDark]) {
      expect(paths(file)).toEqual(symbol);
    }
  });

  it('el símbolo tiene variante clara, oscura y monocroma; el punto superior es de oro salvo en mono', () => {
    expect(symbolSVG('light')).toContain(`fill="${BRAND.marble}"`);
    expect(symbolSVG('dark')).toContain(`fill="${BRAND.slate}"`);
    expect(symbolSVG('light')).toContain(`fill="${BRAND.gold}"`);
    expect(symbolSVG('mono')).not.toContain(BRAND.gold);
  });

  it('el logotipo escribe AKROPOLIS con K y el lema solo cuando se pide', () => {
    expect(lockupHTML()).toContain('AKROPOLIS');
    expect(lockupHTML()).not.toContain('BUILD BEYOND.');
    expect(lockupHTML({ tagline: true })).toContain('BUILD BEYOND.');
  });

  it('los colores de datos de zona salen del catálogo de zonas', () => {
    expect(DATA.zoneR).toBe(getZoneDef('R', 'medium').color);
    expect(DATA.zoneI).toBe(getZoneDef('I', 'medium').color);
  });
});
