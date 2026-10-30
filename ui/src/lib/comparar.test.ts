import { describe, expect, it } from 'vitest';
import type { YarnApp } from '../api/types';
import { COMPARAR } from './ecosistema';
import { VARIANTES, duracion, lineasDeCodigo, nucleo, ultimas } from './comparar';

const app = (p: Partial<YarnApp>): YarnApp => ({
  id: 'application_1_0001', name: '', type: 'MAPREDUCE', user: 'root', queue: 'default', state: 'FINISHED', progress: 100,
  submittedAt: 0, amMemoryMb: 512, containers: [], stages: [], log: [], ...p,
});

describe('Comparar: la misma cuenta con cada herramienta', () => {
  it('encuentra el núcleo de cada archivo de datos/ejemplos', () => {
    // Si alguien cambia un ejemplo y la marca deja de aparecer, nucleo() devuelve el archivo entero
    for (const v of VARIANTES) for (const a of v.archivos) {
      expect(a.nucleo.length, a.nombre).toBeLessThan(a.texto.length);
      expect(a.lineas, a.nombre).toBeGreaterThan(3);
    }
    const [pig] = VARIANTES.find(v => v.id === 'pig')!.archivos;
    expect(pig.nucleo.split('\n')[0]).toMatch(/^ventas = LOAD/);
    expect(pig.nucleo.split('\n').at(-1)).toMatch(/^STORE /);
    const [hql] = VARIANTES.find(v => v.id === 'hive')!.archivos;
    expect(hql.nucleo).toContain('GROUP BY producto');
    expect(hql.nucleo).not.toContain('sucursal,\n       COUNT');
  });

  it('cuenta líneas sin comentarios ni vacías', () => {
    expect(lineasDeCodigo('-- hola\n\nA = LOAD x;\n  -- otro\nSTORE A;', '--')).toBe(2);
    expect(nucleo('a\nb\nc\nd', /^b/, /^c/)).toBe('b\nc');
    expect(nucleo('a\nb', /^z/)).toBe('a\nb');
  });

  it('reconoce el último trabajo de cada versión en YARN', () => {
    const u = ultimas([
      app({ id: 'a1', name: 'streamjob123.jar', submittedAt: 1 }),
      app({ id: 'a2', name: 'streamjob456.jar', submittedAt: 5 }),
      app({ id: 'a3', name: 'PigLatin:ventas.pig', submittedAt: 2 }),
      app({ id: 'a4', name: 'HIVE-1f2e', type: 'TEZ', submittedAt: 3 }),
      app({ id: 'a5', name: 'ventas por producto', type: 'SPARK', submittedAt: 4 }),
      app({ id: 'a6', name: 'Spark Pi', type: 'SPARK', submittedAt: 9 }),
    ]);
    expect([u.streaming?.id, u.pig?.id, u.hive?.id, u.pyspark?.id]).toEqual(['a2', 'a3', 'a4', 'a5']);
    expect(duracion(app({ submittedAt: 10, startedAt: 20, finishedAt: 50 }), 99)).toBe(30);
    expect(duracion(app({ submittedAt: 10, state: 'RUNNING' }), 40)).toBe(30);
  });

  it('cada pregunta tiene un id para enlazarla', () => {
    expect(COMPARAR.map(c => c.id)).toContain('quien-hace-el-trabajo');
    expect(new Set(COMPARAR.map(c => c.id)).size).toBe(COMPARAR.length);
    expect(COMPARAR.every(c => c.pregunta.startsWith('¿') && c.cuales.length > 0)).toBe(true);
  });
});
