/* Biblioteca de modelos en el modo demo: los datos son de corridas reales y los cambios de estado siguen las reglas
   de sandbox_ml/biblioteca.py (promover archiva la anterior, volver atrás, comparar, guardar un experimento). */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDemoApi } from './index';
import type { MlResumenLote, SandboxApi } from '../types';

let api: SandboxApi;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout', 'performance'] });
  api = createDemoApi();
});
afterAll(() => { vi.useRealTimers(); });

describe('Biblioteca del demo', () => {
  it('trae modelos de corridas reales, con la versión en producción', async () => {
    const lista = await api.mlLibrary();
    const churn = lista.find(m => m.nombre === 'churn');
    expect(churn?.produccion).toBe(2);
    expect(churn?.versiones).toBe(3);
    const m = await api.mlLibraryModel('churn');
    expect(m.historial.map(h => h.accion)).toContain('volver');
    expect(m.versiones.every(v => v.linaje.experimento === v.experimento)).toBe(true);
    expect(m.versiones.find(v => v.version === 2)?.entrada?.length).toBeGreaterThan(3);
    expect(m.lotes.some(l => l.resumen?.deriva?.nivel === 'fuerte')).toBe(true);
  });

  it('promueve, archiva la anterior y vuelve atrás', async () => {
    let m = await api.mlLibraryState('churn', { accion: 'promover', version: 1, nota: 'prueba' });
    expect(m.versiones.map(v => v.estado)).toEqual(['produccion', 'archivado', 'archivado']);
    m = await api.mlLibraryState('churn', { accion: 'volver' });
    expect(m.versiones.find(v => v.estado === 'produccion')?.version).toBe(2);
    await expect(api.mlLibraryState('churn', { accion: 'promover', version: 2 })).rejects.toThrow(/ya está en producción/);
    await expect(api.mlLibraryState('churn', { accion: 'promover', version: 9 })).rejects.toThrow(/no tiene la versión 9/);
  });

  it('compara versiones y marca la mejor de cada métrica', async () => {
    const c = await api.mlLibraryCompare('churn', [1, 2, 3]);
    expect(c.metricas[0].principal).toBe(true);
    expect(c.metricas[0].mejor?.length).toBeGreaterThan(0);
    expect(c.params.some(p => p.cambia)).toBe(true);
  });

  it('guarda un experimento como versión nueva y valida el nombre', async () => {
    const exps = await api.mlExperiments();
    const gasto = exps.find(e => e.objetivo === 'gasto_mes_siguiente' && e.estado === 'listo')!;
    await expect(api.mlLibraryRegister({ nombre: 'Con Mayúsculas', experimento: gasto.id })).rejects.toThrow(/minúsculas/);
    await expect(api.mlLibraryRegister({ nombre: 'churn', experimento: gasto.id })).rejects.toThrow(/predice otra cosa/);
    const m = await api.mlLibraryRegister({ nombre: 'gasto-nuevo', experimento: gasto.id, nota: 'desde la demo' });
    expect(m.versiones).toHaveLength(1);
    expect(m.versiones[0].estado).toBe('candidato');
  });

  it('predice al instante con lo guardado y pide las columnas que faltan', async () => {
    const r = await api.mlLibraryPredict('churn', { filas: [{}], version: 2 }).catch(e => e as Error);
    expect(r instanceof Error && /Faltan columnas/.test(r.message)).toBe(true);
    const m = await api.mlLibraryModel('churn');
    const fila = Object.fromEntries((m.versiones[1].entrada ?? []).map(c => [c.columna, 1]));
    const p = await api.mlLibraryPredict('churn', { filas: [fila], version: 2 });
    expect(p.columnas).toContain('prediccion');
  });

  it('un lote simulado termina con el resumen de un lote real', async () => {
    const { run } = await api.mlLibraryBatch('churn', { version: 2, datos: { origen: 'hdfs', ruta: '/user/root/x', formato: 'parquet' }, salida: { tipo: 'hdfs' } });
    await vi.advanceTimersByTimeAsync(30_000);
    const c = await api.mlRun(run);
    expect(c.estado).toBe('listo');
    expect(c.resultado?.filas).toBeGreaterThan(0);
    expect((c.resultado as MlResumenLote | undefined)?.avisos[0]).toMatch(/demo/);
    expect((await api.mlLibraryBatches())[0].estado).toBe('listo');
  });
});
