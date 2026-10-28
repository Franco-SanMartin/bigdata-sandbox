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
