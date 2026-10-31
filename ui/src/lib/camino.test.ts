import { describe, expect, it } from 'vitest';
import type { YarnAppDetail } from '../api/types';
import { TERMINOS } from '../help/glosario';
import { caminoDeConsulta, caminoDeTrabajo, type Camino } from './camino';

const glosarioExiste = (c: Camino) => [c.de, c.proc, c.queda].forEach(t => t.glosario && expect(TERMINOS.has(t.glosario), t.glosario).toBe(true));

describe('franja de camino de datos', () => {
  it('un trabajo de YARN: la carpeta que leyó, el motor y la carpeta del resultado', () => {
    const a = { engine: 'mr', type: 'MAPREDUCE', state: 'FINISHED', outputPath: '/user/root/resultados/mr_por_producto',
      trace: { input: '/user/root/ventas · 6 bloques', command: '', action: '', output: '' },
      dag: { vertices: [{}, {}], edges: [] } } as unknown as YarnAppDetail;
    const c = caminoDeTrabajo(a);
    expect(c.de).toMatchObject({ v: '/user/root/ventas', sub: '6 bloques', ir: { page: 'hdfs', arg: 'user/root/ventas' } });
    expect(c.proc).toMatchObject({ v: 'MapReduce en YARN', sub: 'MAPREDUCE · 2 fases', glosario: 'mapreduce' });
    expect(c.queda).toMatchObject({ v: '/user/root/resultados/mr_por_producto', ir: { page: 'hdfs', arg: 'user/root/resultados/mr_por_producto' } });
    glosarioExiste(c);
    const sinSalida = caminoDeTrabajo({ ...a, outputPath: undefined, trace: { ...a.trace, input: '200.000 filas' } } as YarnAppDetail);
    expect(sinSalida.de).toMatchObject({ v: '200.000 filas' });
    expect(sinSalida.queda.v).toBe('En la salida del comando');
  });
  it('Hive por Tez, Hive sin YARN y lo que escribe una tabla', () => {
    const tez = caminoDeConsulta('hive', 'SELECT producto, COUNT(*) FROM default.ventas GROUP BY producto', { engine: 'tez', appId: 'application_1_0002', rows: [[1], [2]] });
    expect(tez.de).toMatchObject({ v: 'ventas', ir: { page: 'tablas', arg: 'ventas' } });
    expect(tez.proc).toMatchObject({ v: 'Hive → Tez en YARN', ir: { page: 'yarn', arg: 'application_1_0002' } });
    expect(tez.queda).toMatchObject({ v: 'En pantalla', sub: '2 filas · no se guarda' });
    expect(caminoDeConsulta('hive', 'SELECT * FROM ventas LIMIT 5', { engine: 'uno', rows: [] }).proc.v).toBe('HiveServer2, sin YARN');
    const copia = caminoDeConsulta('hive', 'INSERT OVERWRITE TABLE ventas_parquet\nSELECT * FROM ventas;', { engine: 'tez', rows: [] });
    expect(copia.queda).toMatchObject({ v: 'ventas_parquet', ir: { page: 'tablas', arg: 'ventas_parquet' } });
    glosarioExiste(tez);
  });
  it('Pig lee una carpeta y guarda en otra; las bases, una sola máquina', () => {
    const pig = caminoDeConsulta('pig', "-- comentario\nv = LOAD '/user/root/ventas' USING PigStorage(',');\nSTORE v INTO '/user/root/salida';", { engine: 'mr', appId: 'application_1_0003', rows: [] });
    expect(pig.de).toMatchObject({ v: '/user/root/ventas', ir: { page: 'hdfs', arg: 'user/root/ventas' } });
    expect(pig.queda).toMatchObject({ v: '/user/root/salida' });
    glosarioExiste(pig);
    const maria = caminoDeConsulta('mysql', 'SELECT * FROM productos', { engine: 'uno', rows: [[1]] });
    expect(maria.de.v).toBe('tienda.productos');
    expect(maria.proc).toMatchObject({ v: 'MariaDB', capa: 'maquina' });
    expect(caminoDeConsulta('mongodb', 'db.pedidos.find({})', { engine: 'uno', rows: [] }).de.v).toBe('tienda.pedidos');
    glosarioExiste(maria);
  });
});
