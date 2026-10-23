import { describe, expect, it } from 'vitest';

// El CSS de cada pantalla se carga cuando entrás y queda puesto para toda la app:
// si dos pantallas definen la misma clase raíz, la segunda le pisa el estilo a la primera
// (pasó con .hd y .cm entre HDFS, YARN y ML). Las clases compartidas van en styles/.

const pages = import.meta.glob<string>('./*/*.css', { query: '?raw', import: 'default', eager: true });
const globals = import.meta.glob<string>('../styles/*.css', { query: '?raw', import: 'default', eager: true });

function rootClasses(css: string): Set<string> {
  const out = new Set<string>();
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, sel] of clean.matchAll(/([^{}]+)\{/g)) {
    for (const part of sel.split(',')) {
      const m = /^\.([\w-]+)/.exec(part.trim());
      if (m) out.add(m[1]);
    }
  }
  return out;
}

describe('CSS de las pantallas', () => {
  it('encuentra las hojas', () => {
    // Vitest deja vacío el CSS que no está en test.css.include (vite.config.ts)
    expect(Object.keys(pages).length).toBeGreaterThan(3);
    expect(Object.values(pages).every(css => rootClasses(css).size > 0)).toBe(true);
    expect(Object.values(globals).every(css => css.length > 0)).toBe(true);
  });

  it('no repite clases raíz entre pantallas', () => {
    const shared = new Set(Object.values(globals).flatMap(css => [...rootClasses(css)]));
    const byPage = new Map<string, Set<string>>();
    for (const [file, css] of Object.entries(pages)) {
      const page = file.split('/')[1];
      const mine = byPage.get(page) ?? new Set<string>();
      for (const c of rootClasses(css)) if (!shared.has(c)) mine.add(c);
      byPage.set(page, mine);
    }
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const [page, mine] of byPage) {
      for (const c of mine) {
        const prev = owner.get(c);
        if (prev) clashes.push(`.${c} (${prev} y ${page})`);
        else owner.set(c, page);
      }
    }
    expect(clashes).toEqual([]);
  });
});
