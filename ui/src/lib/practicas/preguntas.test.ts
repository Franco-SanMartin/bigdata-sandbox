/* El catálogo de preguntas: cada paso que corre un comando pregunta cuál es, con una sola respuesta
   correcta que es justo el comando que corre, y cada opción explica por qué sí o por qué no. */
import { describe, expect, it } from 'vitest';
import { PRACTICES } from './index';
import { correctIndex } from './motor';

// TODO: sumar las guías 05-10 a medida que tengan sus preguntas
const LISTAS = ['03', '04'];
const conRun = PRACTICES.filter(p => LISTAS.includes(p.guide)).flatMap(p => p.steps.filter(s => s.run).map(s => ({ p, s, k: `${p.id}/${s.id}` })));

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
});
