/* Guía 05: Pig Latin sobre las ventas de HDFS. */
import { VENTAS_DIR, ensureExample, fileCheck, rowsCheck, runQuery } from './comun';
import type { Practice } from './tipos';

const LOAD = `ventas = LOAD '${VENTAS_DIR}' USING PigStorage(',')
         AS (fecha:chararray, sucursal:chararray, producto:chararray,
             cantidad:int, precio:int);
-- la primera línea del CSV es el encabezado
filas = FILTER ventas BY fecha != 'fecha';
`;

export const PIG_PRIMERAS = LOAD + 'primeras = LIMIT filas 10;\nDUMP primeras;';
export const PIG_CENTRO = LOAD + `centro = FILTER filas BY sucursal == 'Centro';
con_importe = FOREACH centro GENERATE fecha, producto, cantidad, (long) cantidad * precio AS importe;
algunas = LIMIT con_importe 10;
DUMP algunas;`;
export const PIG_PRODUCTO = LOAD + `lineas = FOREACH filas GENERATE producto, cantidad,
         (long) cantidad * precio AS importe;
por_producto = GROUP lineas BY producto;
totales = FOREACH por_producto GENERATE group AS producto,
          SUM(lineas.cantidad) AS unidades,
          SUM(lineas.importe) AS facturado;
ordenado = ORDER totales BY facturado DESC;
DUMP ordenado;`;

export const pig: Practice = {
  id: 'pig', guide: '05', guideFile: '05-pig.md',
  title: 'Pig: las ventas en Pig Latin',
  summary: 'Cargás las ventas desde HDFS, filtrás una sucursal y agrupás por producto con LOAD, FILTER, GROUP y DUMP.',
  minutes: 15, cap: 'pig',
  learn: ['Cada línea arma una relación; nada corre hasta el DUMP o el STORE', 'Pig traduce el script a trabajos MapReduce en YARN', 'GROUP deja una bolsa por clave y SUM la resume'],
  steps: [
    {
      id: 'datos', title: 'Tener las ventas en HDFS',
      command: `hdfs dfs -put ventas_grandes.csv ${VENTAS_DIR}/`, input: 'ventas_grandes.csv', cap: 'hdfs.write',
      does: 'Pig lee de HDFS: el LOAD apunta a la carpeta.', expect: `${VENTAS_DIR}/ventas_grandes.csv completo`,
      run: c => ensureExample(c, VENTAS_DIR, 'ventas_grandes.csv', 'ventas'),
      verify: c => fileCheck(c, VENTAS_DIR, 'ventas_grandes.csv'),
    },
    {
      id: 'load', title: 'LOAD y las primeras filas',
      command: PIG_PRIMERAS, input: `${VENTAS_DIR} con su esquema`,
      does: 'Lee la carpeta con PigStorage, saca el encabezado y muestra 10 filas.', expect: '10 ventas con fecha, sucursal, producto, cantidad y precio',
      run: async c => {
        const r = await runQuery(c, 'pig', PIG_PRIMERAS);
        return { ...r, vars: { ...r.vars, 'pig.load': String(r.rows.length) } };
      },
      verify: async c => (Number(c.vars['pig.load'] ?? 0) > 0 ? { ok: true, detail: `${c.vars['pig.load']} fila(s)` } : rowsCheck((await c.api.query('pig', PIG_PRIMERAS)).rows)),
    },
    {
      id: 'filter', title: 'FILTER y FOREACH: las ventas del Centro',
      command: PIG_CENTRO, input: 'Las ventas sin encabezado',
      does: 'Se queda con la sucursal Centro y calcula el importe de cada venta.', expect: 'Filas con fecha, producto, cantidad e importe',
      run: c => runQuery(c, 'pig', PIG_CENTRO),
      verify: async c => rowsCheck((await c.api.query('pig', PIG_CENTRO)).rows),
    },
    {
      id: 'group', title: 'GROUP y SUM: facturado por producto',
      command: PIG_PRODUCTO, input: 'Las ventas sin encabezado',
      does: 'Agrupa por producto, suma unidades e importe y ordena de mayor a menor.', expect: 'yerba con 179.512 unidades y 448.780.000 facturados',
      run: c => runQuery(c, 'pig', PIG_PRODUCTO),
      verify: async c => rowsCheck((await c.api.query('pig', PIG_PRODUCTO)).rows, { has: 'yerba' }),
      tip: 'El mismo número sale en MapReduce (guía 4), Hive (guía 6) y Spark (guía 8): cambia el motor, no el resultado.',
    },
  ],
};
