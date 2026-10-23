/* Guía 06: Hive. Tabla externa sobre HDFS, consultas simples y con Tez, y el plan. */
import { VENTAS_DIR, ensureExample, fileCheck, rowsCheck, runQuery } from './comun';
import type { Practice } from './tipos';

export const HIVE_CREATE = `CREATE EXTERNAL TABLE IF NOT EXISTS ventas (
  fecha    STRING,
  sucursal STRING,
  producto STRING,
  cantidad INT,
  precio   INT
)
ROW FORMAT DELIMITED FIELDS TERMINATED BY ','
STORED AS TEXTFILE
LOCATION '${VENTAS_DIR}'
TBLPROPERTIES ('skip.header.line.count' = '1')`;
export const HIVE_LIMIT = 'SELECT * FROM ventas LIMIT 5';
export const HIVE_SUCURSAL = `SELECT sucursal, COUNT(*) AS tickets,
       SUM(CAST(cantidad AS BIGINT) * precio) AS facturado
FROM ventas
GROUP BY sucursal
ORDER BY facturado DESC`;
export const HIVE_PRODUCTO = `SELECT producto, SUM(cantidad) AS unidades,
       SUM(CAST(cantidad AS BIGINT) * precio) AS facturado
FROM ventas
GROUP BY producto
ORDER BY facturado DESC`;

export const hive: Practice = {
  id: 'hive', guide: '06', guideFile: '06-hive.md',
  title: 'Hive: SQL sobre HDFS',
  summary: 'Creás una tabla externa sobre las ventas, consultás con y sin Tez y mirás el plan con EXPLAIN.',
  minutes: 15, cap: 'hive',
  learn: ['Una tabla EXTERNAL solo anota el esquema: los datos siguen siendo los archivos de HDFS', 'Un SELECT con LIMIT lo resuelve HiveServer2 solo; un GROUP BY lanza un trabajo Tez', 'EXPLAIN muestra los vértices del trabajo antes de correrlo'],
  steps: [
    {
      id: 'datos', title: 'Tener las ventas en HDFS',
      command: `hdfs dfs -put ventas_grandes.csv ${VENTAS_DIR}/`, input: 'ventas_grandes.csv', cap: 'hdfs.write',
      does: 'La tabla va a apuntar a esta carpeta.', expect: `${VENTAS_DIR}/ventas_grandes.csv completo`,
      run: c => ensureExample(c, VENTAS_DIR, 'ventas_grandes.csv', 'ventas'),
      verify: c => fileCheck(c, VENTAS_DIR, 'ventas_grandes.csv'),
    },
    {
      id: 'create', title: 'Crear la tabla externa',
      command: HIVE_CREATE, input: `El esquema y la carpeta ${VENTAS_DIR}`,
      does: 'Anota en el metastore las columnas y dónde están los archivos. No mueve ni copia nada.', expect: 'default.ventas en el catálogo',
      run: async c => {
        const r = await c.api.query('hive', HIVE_CREATE);
        return { summary: r.note ?? 'Tabla default.ventas creada', trace: r.trace, link: { label: 'Ver en Consultas', page: 'datos' } };
      },
      verify: async c => {
        const t = (await c.api.catalog()).find(x => x.source === 'hive' && x.name === 'default.ventas');
        return t ? { ok: true, detail: `default.ventas → ${t.location ?? VENTAS_DIR}` } : { ok: false, detail: 'No aparece default.ventas en el catálogo de Hive' };
      },
      tip: 'Si borrás la tabla con DROP TABLE, los archivos quedan: es EXTERNAL.',
    },
    {
      id: 'limit', title: 'Las primeras filas',
      command: HIVE_LIMIT, input: 'La tabla ventas',
      does: 'HiveServer2 lee el principio del archivo directo (fetch task): no lanza nada en YARN.', expect: '5 filas, sin trabajo en YARN',
      run: async c => {
        const r = await runQuery(c, 'hive', HIVE_LIMIT);
        return { ...r, vars: { ...r.vars, 'hive.limit': String(r.rows.length) } };
      },
      verify: async c => (Number(c.vars['hive.limit'] ?? 0) > 0 ? { ok: true, detail: `${c.vars['hive.limit']} fila(s)` } : rowsCheck((await c.api.query('hive', HIVE_LIMIT)).rows)),
    },
    {
      id: 'sucursal', title: 'Agrupar por sucursal (Tez)',
      command: HIVE_SUCURSAL, input: '200.000 ventas',
      does: 'Hive arma un trabajo Tez: un vértice lee y agrupa parcial, otro junta y suma, otro ordena.', expect: 'Una fila por sucursal y un trabajo TEZ en YARN',
      run: async c => {
        const r = await runQuery(c, 'hive', HIVE_SUCURSAL);
        return { ...r, vars: { ...r.vars, 'hive.sucursal': String(r.rows.length) } };
      },
      verify: async c => (Number(c.vars['hive.sucursal'] ?? 0) > 0 ? { ok: true, detail: `${c.vars['hive.sucursal']} sucursal(es)` } : rowsCheck((await c.api.query('hive', HIVE_SUCURSAL)).rows)),
    },
    {
      id: 'producto', title: 'Facturado por producto',
      command: HIVE_PRODUCTO, input: '200.000 ventas',
      does: 'La misma cuenta que Pig y MapReduce, en SQL.', expect: 'yerba con 448.780.000 facturados',
      run: async c => {
        const r = await runQuery(c, 'hive', HIVE_PRODUCTO);
        const ck = rowsCheck(r.rows, { has: 'yerba' });
        return { ...r, vars: { ...r.vars, 'hive.producto': ck.ok ? '1' : '' } };
      },
      verify: async c => (c.vars['hive.producto'] ? { ok: true, detail: 'Aparece yerba' } : rowsCheck((await c.api.query('hive', HIVE_PRODUCTO)).rows, { has: 'yerba' })),
    },
    {
      id: 'explain', title: 'Mirar el plan con EXPLAIN',
      command: `EXPLAIN ${HIVE_SUCURSAL}`, input: 'La consulta por sucursal',
      does: 'Hive muestra los vértices (Map 1 → Reducer 2 → Reducer 3) sin correr nada.', expect: 'Un plan con vértices Map y Reducer',
      run: async c => {
        const p = await c.api.explain('hive', HIVE_SUCURSAL);
        return { summary: `Motor ${p.engine}${p.yarnStages ? `, ${p.yarnStages} etapas en YARN` : ''}`, out: { kind: 'text', text: p.raw.join('\n') }, vars: { 'hive.plan': p.raw.length ? '1' : '' } };
      },
      verify: async c => (c.vars['hive.plan'] ? { ok: true, detail: 'Se vio el plan' } : { ok: false, detail: 'Todavía no se pidió el plan' }),
    },
  ],
};
