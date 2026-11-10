import { describe, expect, it } from 'vitest';
import { filasDelAula, LAMPARA } from './aula';
import { demoAula } from '../api/demo/aula';
import type { AulaPc } from '../api/types';

const pc = (nodo: string, numero: number | null, fila: string | null): AulaPc => ({ nodo, numero, fila, estado: 'arriba' });

describe('filasDelAula', () => {
  it('ordena las filas por número y las PCs adentro', () => {
    const f = filasDelAula([pc('pc12', 12, '/fila3'), pc('pc02', 2, '/fila1'), pc('pc01', 1, '/fila1'), pc('pc06', 6, '/fila2'), pc('otra', null, null)]);
    expect(f.map(([k, xs]) => [k, xs.map(x => x.nodo)])).toEqual([
      ['/fila1', ['pc01', 'pc02']], ['/fila2', ['pc06']], ['/fila3', ['pc12']], ['sin fila', ['otra']],
    ]);
  });
  it('fila 10 después de la 9 (no como texto)', () => {
    expect(filasDelAula([pc('pc46', 46, '/fila10'), pc('pc41', 41, '/fila9')]).map(([k]) => k)).toEqual(['/fila9', '/fila10']);
  });
});

describe('lámparas', () => {
  it('cada estado tiene color: verde arriba, rojo caída, ámbar el resto', () => {
    expect(LAMPARA.arriba.k).toBe('ok');
    expect(LAMPARA.caida.k).toBe('bad');
    expect([LAMPARA.sumandose.k, LAMPARA['sin-respuesta'].k]).toEqual(['run', 'run']);
  });
});

describe('el aula del modo demo', () => {
  it('se van sumando las 11 PCs y al final ya se puede apagar', () => {
    const t0 = 1_800_000_000_000;
    const al = demoAula(t0, t0 + 1000);
    expect(al.pcs).toHaveLength(1);
    expect(al.pcs[0].estado).toBe('sumandose');
    const fin = demoAula(t0, t0 + 120_000);
    expect(fin.pcs).toHaveLength(11);
    expect(fin.resumen.arriba).toBe(11);
    expect(fin.pcs.filter(p => p.nodemanager?.mb === 5120)).toHaveLength(3);   // las 3 de 16 GB
    expect(fin.apagar.listo).toBe(true);
    expect(fin.yarn.mb).toBe(8 * 2048 + 3 * 5120);
  });
});

describe('el plano del aula', () => {
  it('arranca con las PCs por número y se edita', async () => {
    const { planoInicial, moverEnPlano, sinUbicar, racksDelPlano, cambiarForma, leerPlano, sacarDelPlano } = await import('./aula');
    const p = planoInicial(['pc03', 'pc01', 'pc07', 'otra'], 5);
    expect(p.filas[0].slice(0, 3)).toEqual(['pc01', null, 'pc03']);
    expect(p.filas[1][1]).toBe('pc07');
    const q = moverEnPlano(p, 'pc07', 0, 1);
    expect(q.filas[0][1]).toBe('pc07');
    expect(q.filas[1].includes('pc07')).toBe(false);
    expect(racksDelPlano(q)).toEqual({ pc01: '/fila1', pc07: '/fila1', pc03: '/fila1' });
    expect(sinUbicar(sacarDelPlano(q, 'pc03'), ['pc01', 'pc03', 'pc07'])).toEqual(['pc03']);
    expect(cambiarForma(q, 1, 2).filas).toEqual([['pc01', 'pc07']]);
    expect(leerPlano('{"filas": [["pc01", null]]}').filas).toEqual([['pc01', null]]);
    expect(() => leerPlano('{"filas": [["maestro"]]}')).toThrow(/no es un plano/);
  });
});

describe('los opcionales del aula', () => {
  it('resalta en el plano dónde estaba el bloque y dónde corrió la tarea', async () => {
    const { resalteDeTarea } = await import('./aula');
    const t = { id: 'm0', tipo: 'map' as const, bloque: ['pc01', 'pc03'], corrio: 'pc03', rack: '/fila1', localidad: 'data-local' as const, yarn: null, estado: 'ok' as const, intentos: 1, fallidos: 0 };
    expect(resalteDeTarea(t)).toEqual({ pc01: 'bloque', pc03: 'ambos' });
    expect(resalteDeTarea({ ...t, bloque: ['pc01'], corrio: 'pc02' })).toEqual({ pc01: 'bloque', pc02: 'corrio' });
    // Spark no dice dónde estaba el bloque; una tarea que todavía no corrió no resalta nada
    expect(resalteDeTarea({ ...t, bloque: null, corrio: 'pc04' })).toEqual({ pc04: 'corrio' });
    expect(resalteDeTarea({ ...t, bloque: null, corrio: null })).toEqual({});
    expect(resalteDeTarea(null)).toEqual({});
  });
  it('lee los grupos como los valida el maestro', async () => {
    const { leerGrupos } = await import('./aula');
    expect(leerGrupos('Grupo1, grupo2  equipo_rojo')).toEqual({ grupos: ['grupo1', 'grupo2', 'equipo_rojo'] });
    expect(leerGrupos('')).toEqual({ grupos: [] });
    expect(leerGrupos('grupo1, default').error).toMatch(/default/);
    expect(leerGrupos('g1 g1').error).toMatch(/dos veces/);
    expect(leerGrupos('con-guion').error).toMatch(/con-guion/);
    expect(leerGrupos(Array.from({ length: 13 }, (_, i) => `g${i}`).join(' ')).error).toMatch(/12/);
  });
  it('exporta las medidas de la escala a CSV (las que fallaron, sin segundos)', async () => {
    const { escalaCsv } = await import('./aula');
    const m = (id: string, pcs: number, segundos: number | null, estado: 'ok' | 'fallo') => ({
      id, trabajo: 'mr-pi' as const, entrada: null, cola: null, estado, inicio: Date.UTC(2026, 10, 10, 21, 0, 0), app: `application_1_${id}`,
      pcs, nodos: [], mb: pcs * 2048, vcores: pcs * 4, segundos, resultado: estado === 'ok' ? 'FINISHED' : 'FAILED', cambiaron: pcs === 5,
    });
    const csv = escalaCsv([m('2', 5, 41.5, 'ok'), m('1', 1, 120, 'ok'), m('3', 10, null, 'fallo')]);
    const filas = csv.trim().split('\r\n');
    expect(filas[0]).toBe('trabajo,pcs,segundos,estado,memoria_mb,cores,cambiaron_pcs,app,inicio');
    expect(filas).toHaveLength(4);
    expect(filas[1]).toMatch(/^mr-pi,1,120,ok,2048,4,no,application_1_1,2026-11-10T21:00:00/);   // ordenado por PCs
    expect(filas[2]).toMatch(/^mr-pi,5,41\.5,ok,10240,20,si,/);
    expect(filas[3]).toMatch(/^mr-pi,10,,fallo,/);
  });
});

describe('los opcionales en el modo demo', () => {
  it('apagar marca la PC (roja, sin NodeManager) y prender la devuelve', async () => {
    const { demoAula, demoEnergia } = await import('../api/demo/aula');
    const t0 = 1_800_000_000_000, t = t0 + 120_000;
    expect(demoEnergia('pc03', 'apagar', 'ordenado', t)).toMatchObject({ modo: 'ordenado', datanode: false });
    const pc = demoAula(t0, t + 1000).pcs.find(p => p.nodo === 'pc03')!;
    expect(pc.apagada?.modo).toBe('ordenado');
    expect(pc.estado).toBe('caida');
    expect(pc.nodemanager).toBeUndefined();
    demoEnergia('pc03', 'prender', undefined, t + 2000);
    expect(demoAula(t0, t + 3000).pcs.find(p => p.nodo === 'pc03')!.apagada).toBeUndefined();
    expect(() => demoEnergia('maestro', 'apagar', 'golpe', t)).toThrow(/no es una PC/);
    expect(() => demoEnergia('pc01', 'apagar', 'suave' as never, t)).toThrow(/ordenado o golpe/);
  });
  it('colas: arma los grupos, rechaza nombres malos y no manda a una cola que no existe', async () => {
    const { demoGuardarColas, demoTrabajoEnCola } = await import('../api/demo/aula');
    expect(demoGuardarColas(['grupo1', 'grupo2']).grupos).toEqual(['grupo1', 'grupo2']);
    expect(demoGuardarColas(['grupo1']).paradas).toEqual(['grupo2']);
    expect(() => demoGuardarColas(['root'])).toThrow(/root/);
    expect(demoTrabajoEnCola('grupo1', 'mr-pi').cola).toBe('grupo1');
    expect(() => demoTrabajoEnCola('grupo9', 'mr-pi')).toThrow(/No hay una cola/);
    demoGuardarColas([]);
  });
  it('medir: una a la vez, y la medida entra en la curva cuando termina', async () => {
    const { demoMedir, demoEscala, demoBorrarMedida } = await import('../api/demo/aula');
    const t0 = 1_800_000_000_000, t = t0 + 120_000;
    const m = demoMedir('mr-pi', null, t0, t);
    expect(m.pcs).toBe(11);
    expect(() => demoMedir('spark-pi', null, t0, t + 10)).toThrow(/Ya se está midiendo/);
    const e = demoEscala(t0, t + 60_000);
    expect(e.corriendo).toBeNull();
    expect(e.curva[0].puntos[0]).toMatchObject({ pcs: 11, aceleracion: 1 });
    expect(() => demoBorrarMedida('m-no', t0, t)).toThrow(/No hay una medida/);
    expect(demoBorrarMedida(undefined, t0, t).medidas).toEqual([]);
  });
});
