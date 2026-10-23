import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Capability } from '../../lib/capabilities';

/* PageGate decide qué ve una pantalla según su capacidad: se reemplazan el estado y la capacidad
   por valores armados a mano para recorrer los cuatro casos sin levantar el store. */
const h = vi.hoisted(() => ({ status: null as unknown, cap: null as unknown }));
vi.mock('../../state/store', () => ({ useStatus: () => h.status }));
vi.mock('../../state/capabilities', () => ({ useCapability: () => h.cap, runFix: vi.fn() }));
vi.mock('../../state/ui', () => ({ navigate: vi.fn() }));

const { PageGate, bootLine } = await import('./PageGate');

const page = () => renderToStaticMarkup(
  <PageGate cap="hive" title="Consultas en Hive" can={['Escribir SQL', 'Ver el plan', 'Bajar el resultado']} keep={<p>catálogo</p>}>
    <p>contenido real</p>
  </PageGate>);
const cap = (c: Partial<Capability>): Capability => ({ id: 'hive', state: 'ready', ...c });

describe('PageGate', () => {
  beforeEach(() => { h.status = { now: 0, boot: null }; h.cap = cap({}); });

  it('sin estado todavía: esqueleto, ni el contenido ni un aviso', () => {
    h.status = null;
    const html = page();
    expect(html).not.toContain('contenido real');
    expect(html).not.toContain('no está disponible');
    expect(html).toContain('aria-busy="true"');
  });

  it('lista: muestra la pantalla tal cual', () => {
    const html = page();
    expect(html).toContain('contenido real');
    expect(html).not.toContain('catálogo');
  });

  it('bloqueada: motivo, lo que se va a poder hacer, el arreglo y lo que se ve igual', () => {
    h.cap = cap({ state: 'blocked', reason: 'HiveServer2 está apagado', fix: { kind: 'process-start', process: 'hiveserver2' }, fixLabel: 'Prender HiveServer2' });
    const html = page();
    expect(html).toContain('Consultas en Hive no está disponible');
    expect(html).toContain('HiveServer2 está apagado');
    expect(html).toContain('Bajar el resultado');
    expect(html).toContain('Prender HiveServer2');
    expect(html).toContain('catálogo');
    expect(html).not.toContain('contenido real');
  });

  it('arrancando: sin botón de arreglo (no hay nada que hacer) y con el paso del arranque', () => {
    h.status = { now: 30_000, boot: { startedAt: 0, expectedSec: 120, steps: [{ name: 'HDFS', state: 'done', expectedSec: 20 }, { name: 'YARN', state: 'running', expectedSec: 20 }] } };
    h.cap = cap({ state: 'starting', reason: 'El cluster está arrancando', fix: { kind: 'wait' } as Capability['fix'], fixLabel: 'Esperar' });
    const html = page();
    expect(html).toContain('preparándose');
    expect(html).toContain('Paso 2 de 2: YARN');
    expect(html).not.toContain('>Esperar<');
  });
});

describe('bootLine', () => {
  it('dice el paso y cuánto falta; nada si terminó', () => {
    const boot = { startedAt: 0, expectedSec: 100, steps: [{ name: 'Formatear', state: 'running', expectedSec: 30 }] };
    expect(bootLine(boot, 40_000)).toBe('Paso 1 de 1: Formatear · faltan ~60 s');
    expect(bootLine({ ...boot, steps: [{ ...boot.steps[0], state: 'done' }] }, 0)).toBeNull();
    expect(bootLine(null, 0)).toBeNull();
  });
});
