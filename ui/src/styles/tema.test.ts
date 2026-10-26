/* El tema es oscuro siempre: no sigue al del sistema operativo ni tiene interruptor, y no quedan
   colores claros fijos que se vean como parches blancos sobre el fondo oscuro. */
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

describe('tema oscuro siempre', () => {
  it('los tokens y la página piden oscuro', () => {
    expect(tokens).toMatch(/color-scheme:\s*dark/);
    expect(html).toMatch(/name="color-scheme" content="dark"/);
    const n0 = /--n-0:\s*(#[0-9a-f]{6})/i.exec(tokens)![1];
    const n12 = /--n-12:\s*(#[0-9a-f]{6})/i.exec(tokens)![1];
    expect(lum(n0)).toBeLessThan(0.1);
    expect(lum(n12)).toBeGreaterThan(0.8);
  });

  it('nada sigue al tema del sistema', () => {
    for (const [f, s] of Object.entries({ ...css, ...code })) {
      expect(s, f).not.toMatch(/prefers-color-scheme/);
      expect(s, f).not.toMatch(/color-scheme:\s*light/);
    }
  });

  it('fuera de los tokens no hay fondos ni bordes claros fijos', () => {
    for (const [f, s] of Object.entries(css)) {
      if (f.endsWith('tokens.css')) continue;
      const clean = s.replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of clean.matchAll(/(background[\w-]*|border[\w-]*|box-shadow)\s*:[^;}]*?(#[0-9a-f]{3,6})\b/gi))
        expect(lum(m[2]), `${f}: ${m[0]}`).toBeLessThan(0.5);
      expect(clean, f).not.toMatch(/background[\w-]*\s*:\s*(white|#fff\b|#ffffff)/i);
      // sombras/velos con el negro tibio del tema claro
      expect(clean, f).not.toMatch(/rgba\(\s*(28,\s*27,\s*25|250,\s*249,\s*247)/);
    }
  });
});
