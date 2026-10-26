/* El catálogo de preguntas: cada paso que corre un comando pregunta cuál es, con una sola respuesta
   correcta que es justo el comando que corre, y cada opción explica por qué sí o por qué no. */
import { describe, expect, it } from 'vitest';
import { PRACTICES } from './index';
import { correctIndex, splitCommon } from './motor';

const conRun = PRACTICES.flatMap(p => p.steps.filter(s => s.run).map(s => ({ p, s, k: `${p.id}/${s.id}` })));

describe('preguntas de las prácticas', () => {
  it('todo paso que corre un comando tiene su pregunta', () => {
    const sin = conRun.filter(x => !x.s.pregunta).map(x => x.k);
    expect(sin).toEqual([]);
  });

  it.each(conRun.filter(x => x.s.pregunta).map(x => [x.k, x.s] as const))('%s: una sola correcta, que es el comando que corre', (_k, s) => {
    const q = s.pregunta!;
    expect(q.opciones.length).toBeGreaterThanOrEqual(3);
    expect(q.opciones.length).toBeLessThanOrEqual(4);
    expect(q.opciones.filter(o => o.correcta)).toHaveLength(1);
    expect(q.opciones[correctIndex(q)].cmd).toBe(s.command);
    for (const o of q.opciones) expect(o.porque.trim().length, o.cmd).toBeGreaterThan(20);
    expect(new Set(q.opciones.map(o => o.cmd.trim())).size).toBe(q.opciones.length);
    expect(q.enunciado).toMatch(/\?$/);
  });

  it('todo paso con pregunta dice dónde queda cada cosa', () => {
    const sin = conRun.filter(x => x.s.pregunta && !x.s.donde).map(x => x.k);
    expect(sin).toEqual([]);
  });
});

describe('splitCommon', () => {
  it('saca aparte las líneas que comparten todas las opciones', () => {
    const r = splitCommon(['a\nb\nX\ny\nz', 'a\nb\nY\ny\nz', 'a\nb\nZ1\nZ2\ny\nz']);
    expect(r).toEqual({ pre: ['a', 'b'], mid: ['X', 'Y', 'Z1\nZ2'], post: ['y', 'z'] });
  });
  it('con una sola línea en común no agrupa nada', () => {
    expect(splitCommon(['a\nX', 'a\nY'])).toEqual({ pre: [], mid: ['a\nX', 'a\nY'], post: [] });
  });
  it('siempre deja algo propio en cada opción', () => {
    const r = splitCommon(['a\nb\nc', 'a\nb\nc\nd']);
    expect(r.mid.every((m, i) => i === 0 || m.length > 0)).toBe(true);
  });
});
