/* El tema es claro siempre (D-06): no sigue al del sistema operativo ni tiene interruptor, y no
   quedan colores oscuros fijos que se vean como parches negros sobre el fondo blanco. */
import { describe, expect, it } from 'vitest';
import html from '../../index.html?raw';

const css = import.meta.glob<string>(['../styles/*.css', '../pages/*/*.css'], { query: '?raw', import: 'default', eager: true });
const code = import.meta.glob<string>(['../**/*.tsx', '../**/*.ts', '!../**/*.test.*'], { query: '?raw', import: 'default', eager: true });

/** Luminancia aproximada de un color #rgb / #rrggbb (0 negro, 1 blanco) */
function lum(hex: string): number {
  const h = hex.length === 4 ? [...hex.slice(1)].map(x => x + x).join('') : hex.slice(1, 7);
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const tokens = Object.entries(css).find(([f]) => f.endsWith('/tokens.css'))![1];

describe('tema claro siempre', () => {
  it('los tokens y la página piden claro', () => {
    expect(tokens).toMatch(/color-scheme:\s*light/);
    expect(html).toMatch(/name="color-scheme" content="light"/);
    const n0 = /--n-0:\s*(#[0-9a-f]{6})/i.exec(tokens)![1];
    const n12 = /--n-12:\s*(#[0-9a-f]{6})/i.exec(tokens)![1];
    expect(lum(n0)).toBeGreaterThan(0.9);
    expect(lum(n12)).toBeLessThan(0.1);
  });

  it('nada sigue al tema del sistema', () => {
    for (const [f, s] of Object.entries({ ...css, ...code })) {
      expect(s, f).not.toMatch(/prefers-color-scheme/);
      expect(s, f).not.toMatch(/color-scheme:\s*dark/);
    }
  });

  it('fuera de los tokens no hay fondos ni bordes oscuros fijos', () => {
    for (const [f, s] of Object.entries(css)) {
      if (f.endsWith('tokens.css')) continue;
      const clean = s.replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of clean.matchAll(/(background[\w-]*|border[\w-]*|box-shadow)\s*:[^;}]*?(#[0-9a-f]{3,6})\b/gi))
        expect(lum(m[2]), `${f}: ${m[0]}`).toBeGreaterThan(0.5);
      expect(clean, f).not.toMatch(/background[\w-]*\s*:\s*(white|#fff\b|#ffffff)/i);
      // velos blancos pensados para fondo oscuro: sobre blanco no se ven
      expect(clean, f).not.toMatch(/rgba\(\s*255,\s*255,\s*255,\s*\.0\d\)/);
    }
  });
});
