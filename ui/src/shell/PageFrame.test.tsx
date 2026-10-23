import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/* La banda de "sin conexión" y el marco de cada pantalla, con el store reemplazado */
const h = vi.hoisted(() => ({ snap: {} as Record<string, unknown> }));
vi.mock('../state/store', () => ({ useSnapshot: () => h.snap, retryNow: vi.fn() }));
vi.mock('../state/ui', () => ({ navigate: vi.fn() }));

const { ConnectionBand, PageFrame, retryIn } = await import('./PageFrame');

describe('retryIn', () => {
  it('redondea para arriba y nunca da negativo', () => {
    expect(retryIn(10_500, 9_000)).toBe(2);
    expect(retryIn(5_000, 9_000)).toBe(0);
    expect(retryIn(null, 9_000)).toBe(0);
  });
});

describe('ConnectionBand', () => {
  beforeEach(() => { h.snap = { error: null, retryAt: null, failures: 0, status: null }; });

  it('con conexión no ocupa lugar', () => {
    expect(renderToStaticMarkup(<ConnectionBand />)).toBe('');
  });

  it('sin conexión: el error, la cuenta regresiva, los intentos y el botón', () => {
    h.snap = { error: 'Failed to fetch', retryAt: Date.now() + 8_000, failures: 3, status: { phase: 'running' } };
    const html = renderToStaticMarkup(<ConnectionBand />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Failed to fetch');
    expect(html).toMatch(/Reintento en [78] s · 3 intentos/);
    expect(html).toContain('último estado conocido');
    expect(html).toContain('Reintentar ahora');
  });
});

describe('PageFrame', () => {
  it('sin estado y sin error: esqueleto en vez de la pantalla', () => {
    h.snap = { error: null, status: null };
    const html = renderToStaticMarkup(<PageFrame page="hdfs"><p>pantalla</p></PageFrame>);
    expect(html).not.toContain('pantalla');
    expect(html).toContain('aria-busy="true"');
  });

  it('sin estado y con error: el motivo y cómo seguir', () => {
    h.snap = { error: 'HTTP 502', status: null };
    const html = renderToStaticMarkup(<PageFrame page="hdfs"><p>pantalla</p></PageFrame>);
    expect(html).toContain('No hay conexión con el contenedor');
    expect(html).toContain('docker ps');
    expect(html).toContain('HTTP 502');
  });

  it('con estado: la pantalla', () => {
    h.snap = { error: null, status: { phase: 'stopped' } };
    expect(renderToStaticMarkup(<PageFrame page="hdfs"><p>pantalla</p></PageFrame>)).toContain('pantalla');
  });
});
