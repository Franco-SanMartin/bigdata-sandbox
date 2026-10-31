import { describe, expect, it } from 'vitest';
import type { YarnApp, YarnMetrics } from '../api/types';
import { COMPARAR } from './ecosistema';
import { VARIANTES, bytesLabel, duracion, lineasDeCodigo, nucleo, observaciones, sumar, ultimaCorrida, ultimas } from './comparar';

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

// Lo que devolvió el servidor con las salidas reales (server/tests/test_yarn.py)
const MR: YarnMetrics = { id: 'a1', type: 'MAPREDUCE', state: 'FINISHED', elapsedMs: 18645, mbSeconds: 19457, vcoreSeconds: 36, hdfsReadBytes: 6217505,
  hdfsWrittenBytes: 188, shuffleBytes: 3347314, localDiskBytes: 7535908, tasks: 3, dataLocalTasks: 2, source: 'jobhistory' };
const SPARK: YarnMetrics = { id: 'a2', type: 'SPARK', state: 'FINISHED', elapsedMs: 27747, mbSeconds: 74474, vcoreSeconds: 71, hdfsReadBytes: 18822508,
  hdfsWrittenBytes: 216, shuffleBytes: 3102, localDiskBytes: 2214, tasks: 11, source: 'spark-history' };
const TEZ: YarnMetrics = { id: 'a3', type: 'TEZ', state: 'FINISHED', elapsedMs: 17685, mbSeconds: 24613, vcoreSeconds: 29, source: 'rm' };

describe('Comparar: lo que movió cada corrida', () => {
  it('Pig: los trabajos seguidos son una corrida; uno de hace rato, otra', () => {
    const pig = (id: string, sub: number, fin?: number) => app({ id, name: 'PigLatin:ventas.pig', submittedAt: sub, finishedAt: fin });
    const r = ultimaCorrida([pig('p0', 0, 20_000), pig('p1', 500_000, 530_000), pig('p2', 535_000, 560_000), pig('p3', 570_000),
      app({ id: 'h', type: 'TEZ', name: 'HIVE-1', submittedAt: 1 })]);
    expect(r.pig?.map(a => a.id)).toEqual(['p1', 'p2', 'p3']);
    expect(r.hive?.map(a => a.id)).toEqual(['h']);
    expect(r.pyspark).toBeUndefined();
  });
  it('suma los trabajos; lo que no tiene uno (Tez sin contadores) no se inventa', () => {
    expect(sumar([MR, { ...MR, id: 'b', shuffleBytes: 1 }])).toMatchObject({ trabajos: 2, ms: 37290, leido: 12435010, shuffle: 3347315 });
    expect(sumar([TEZ])).toMatchObject({ trabajos: 1, mbSeconds: 24613, leido: undefined, shuffle: undefined });
    expect(sumar([MR, { id: 'x', error: 'No existe' }])).toBeUndefined();
    expect(sumar([{ ...MR, state: 'RUNNING' }])).toBeUndefined();
  });
  it('lo que dicen los números reales', () => {
    const o = observaciones({ streaming: sumar([MR]), pyspark: sumar([SPARK]), hive: sumar([TEZ]) });
    expect(o).toHaveLength(3);
    expect(o[0]).toContain('3,2 MB por el shuffle y PySpark 3,0 KB');
    expect(o[1]).toContain('3,0 veces la entrada');
    expect(o[2]).toContain('7,2 MB en el disco local');
    expect(observaciones({ hive: sumar([TEZ]) })).toEqual([]);
    expect(bytesLabel(188)).toBe('188 bytes');
  });
});
