/* Guía 06: Hive. Tabla externa sobre HDFS, consultas simples y con Tez, y el plan. */
import { VENTAS_DIR, rowsCheck, runQuery, ventasEnHdfs } from './comun';
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

const EN = 'En beeline, la consola de Hive (beeline -u jdbc:hive2://localhost:10000)';

export const hive: Practice = {
  id: 'hive', guide: '06', guideFile: '06-hive.md',
  title: 'Hive: SQL sobre HDFS',
  summary: 'Creás una tabla externa sobre las ventas, consultás con y sin Tez y mirás el plan con EXPLAIN.',
  minutes: 15, cap: 'hive',
  learn: ['Una tabla EXTERNAL solo anota el esquema: los datos siguen siendo los archivos de HDFS', 'Un SELECT con LIMIT lo resuelve HiveServer2 solo; un GROUP BY lanza un trabajo Tez', 'EXPLAIN muestra los vértices del trabajo antes de correrlo'],
  steps: [
    ventasEnHdfs('La tabla va a apuntar a esta carpeta: Hive lee los archivos que haya adentro.'),
    {
      id: 'create', title: 'Crear la tabla externa',
      command: HIVE_CREATE, en: EN, input: `El esquema y la carpeta ${VENTAS_DIR}`,
      does: 'Anota en el metastore las columnas y dónde están los archivos. No mueve ni copia nada.', expect: 'default.ventas en el catálogo',
      pregunta: {
        enunciado: `Ahora queremos que Hive lea las ventas de ${VENTAS_DIR} como una tabla, sin mover ni copiar los archivos y sin que la tabla se quede con ellos. ¿Cuál es la sentencia correcta?`,
        opciones: [
          { cmd: HIVE_CREATE, correcta: true, porque: "EXTERNAL anota el esquema sin adueñarse de los archivos; FIELDS TERMINATED BY ',' dice que el CSV va con comas, LOCATION apunta a la carpeta y skip.header.line.count saltea el encabezado." },
          { cmd: HIVE_CREATE.replace('CREATE EXTERNAL TABLE', 'CREATE TABLE'), porque: 'Sin EXTERNAL la tabla es administrada: Hive la considera suya y un DROP TABLE borra los archivos de HDFS. Para datos que ya estaban y no son de Hive, va EXTERNAL.' },
          { cmd: HIVE_CREATE.replace("ROW FORMAT DELIMITED FIELDS TERMINATED BY ','\n", ''), porque: "Sin FIELDS TERMINATED BY ',' Hive separa por su delimitador de siempre (\\001, un carácter invisible): la línea entera cae en fecha y las demás columnas dan NULL." },
          { cmd: HIVE_CREATE.replace("\nTBLPROPERTIES ('skip.header.line.count' = '1')", ''), porque: 'Le falta saltear el encabezado: la primera línea del CSV (fecha,sucursal,…) aparece como una venta más, con cantidad y precio en NULL.' },
        ],
      },
      donde: {
        hdfs: `Nada cambia: los archivos siguen en ${VENTAS_DIR}`,
        contenedor: 'El metastore de Hive anota la tabla default.ventas: columnas, formato y carpeta',
        compu: 'Consultas → catálogo: aparece default.ventas',
      },
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
      command: HIVE_LIMIT, en: EN, input: 'La tabla ventas',
      pregunta: {
        enunciado: 'Ahora queremos ver las primeras 5 filas de la tabla ventas. ¿Cuál es la consulta correcta?',
        opciones: [
          { cmd: HIVE_LIMIT, correcta: true, porque: 'SELECT * trae todas las columnas y LIMIT 5, al final, corta en 5 filas. Como no hay que calcular nada, HiveServer2 lee el principio del archivo él solo.' },
          { cmd: 'SELECT TOP 5 * FROM ventas', porque: 'TOP es de SQL Server: en HiveQL (y en MySQL) se corta con LIMIT al final. Hive da error de sintaxis.' },
          { cmd: `SELECT * FROM ${VENTAS_DIR} LIMIT 5`, porque: 'En SQL se consulta la tabla, no la carpeta: la ruta de HDFS ya quedó anotada en la tabla con LOCATION.' },
          { cmd: 'DESCRIBE ventas', porque: 'DESCRIBE muestra las columnas y sus tipos, no las filas.' },
        ],
      },
      donde: {
        hdfs: `Lee el principio de ${VENTAS_DIR}/ventas_grandes.csv`,
        yarn: 'Nada: es una fetch task, HiveServer2 lo resuelve sin lanzar trabajos',
        compu: 'Las 5 filas, acá abajo',
      },
      does: 'HiveServer2 lee el principio del archivo directo (fetch task): no lanza nada en YARN.', expect: '5 filas, sin trabajo en YARN',
      run: async c => {
        const r = await runQuery(c, 'hive', HIVE_LIMIT);
        return { ...r, vars: { ...r.vars, 'hive.limit': String(r.rows.length) } };
      },
      verify: async c => (Number(c.vars['hive.limit'] ?? 0) > 0 ? { ok: true, detail: `${c.vars['hive.limit']} fila(s)` } : rowsCheck((await c.api.query('hive', HIVE_LIMIT)).rows)),
    },
    {
      id: 'sucursal', title: 'Agrupar por sucursal (Tez)',
      command: HIVE_SUCURSAL, en: EN, input: '200.000 ventas',
      pregunta: {
        enunciado: 'Ahora queremos, por sucursal, cuántas ventas hubo y cuánto se facturó, de la que más facturó a la que menos. ¿Cuál es la consulta correcta?',
        opciones: [
          { cmd: HIVE_SUCURSAL, correcta: true, porque: 'GROUP BY sucursal junta las filas de cada sucursal; COUNT(*) cuenta las ventas y SUM suma el importe fila por fila (el CAST a BIGINT es para que un total grande no desborde). ORDER BY ... DESC deja arriba la que más facturó.' },
          { cmd: HIVE_SUCURSAL.replace('GROUP BY sucursal\n', ''), porque: 'Sin GROUP BY, COUNT y SUM resumen toda la tabla en una fila, y Hive no sabe qué sucursal poner: da error (Expression not in GROUP BY key).' },
          { cmd: HIVE_SUCURSAL.replace('ORDER BY facturado DESC', 'ORDER BY facturado'), porque: 'Sin DESC ordena de menor a mayor: la sucursal que más facturó queda última.' },
          { cmd: HIVE_SUCURSAL.replace('SUM(CAST(cantidad AS BIGINT) * precio)', 'SUM(cantidad) * precio'), porque: 'precio quedó afuera del SUM y no está en el GROUP BY: Hive no sabe qué precio usar para toda la sucursal y da error. El importe se calcula fila por fila, adentro del SUM.' },
        ],
      },
      donde: {
        hdfs: `Lee ${VENTAS_DIR}; el resultado no se guarda (vuelve a la consola)`,
        yarn: 'Un trabajo TEZ: vértices Map 1 → Reducer 2 → Reducer 3, cada uno en contenedores',
        compu: 'Una fila por sucursal acá abajo, y el trabajo en Trabajos',
      },
      does: 'Hive arma un trabajo Tez: un vértice lee y agrupa parcial, otro junta y suma, otro ordena.', expect: 'Una fila por sucursal y un trabajo TEZ en YARN',
      run: async c => {
        const r = await runQuery(c, 'hive', HIVE_SUCURSAL);
        return { ...r, vars: { ...r.vars, 'hive.sucursal': String(r.rows.length) } };
      },
      verify: async c => (Number(c.vars['hive.sucursal'] ?? 0) > 0 ? { ok: true, detail: `${c.vars['hive.sucursal']} sucursal(es)` } : rowsCheck((await c.api.query('hive', HIVE_SUCURSAL)).rows)),
    },
    {
      id: 'producto', title: 'Facturado por producto',
      command: HIVE_PRODUCTO, en: EN, input: '200.000 ventas',
      pregunta: {
        enunciado: 'Ahora queremos el total de unidades y de facturado de cada producto. ¿Cuál es la consulta correcta?',
        opciones: [
          { cmd: HIVE_PRODUCTO, correcta: true, porque: 'Agrupa por producto y suma las unidades (SUM(cantidad)) y el importe de cada venta: la misma cuenta que hiciste con Pig y con MapReduce.' },
          { cmd: HIVE_PRODUCTO.replace('GROUP BY producto', 'GROUP BY sucursal'), porque: 'Agrupa por sucursal pero muestra producto: Hive no sabe qué producto poner en cada grupo y da error (Expression not in GROUP BY key).' },
          { cmd: HIVE_PRODUCTO.replace('SUM(cantidad) AS unidades', 'COUNT(cantidad) AS unidades'), porque: 'COUNT cuenta filas (cuántas ventas hubo), no suma unidades: una venta de 5 yerbas contaría 1.' },
          { cmd: HIVE_PRODUCTO.replace('GROUP BY producto\nORDER BY facturado DESC', 'ORDER BY facturado DESC\nGROUP BY producto'), porque: 'El orden de las cláusulas importa: GROUP BY va antes que ORDER BY. Así es un error de sintaxis.' },
        ],
      },
      donde: {
        yarn: 'Otro trabajo TEZ, con los mismos tres vértices',
        compu: 'Una fila por producto, acá abajo: yerba arriba',
      },
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
      command: `EXPLAIN ${HIVE_SUCURSAL}`, en: EN, input: 'La consulta por sucursal',
      pregunta: {
        enunciado: 'Ahora queremos ver cómo va a correr la consulta por sucursal (sus vértices de Tez) sin correrla. ¿Cuál es la sentencia correcta?',
        opciones: [
          { cmd: `EXPLAIN ${HIVE_SUCURSAL}`, correcta: true, porque: 'EXPLAIN delante de una consulta la planifica sin correrla: muestra los vértices (Map 1, Reducer 2…) y cómo se pasan los datos.' },
          { cmd: HIVE_SUCURSAL, porque: 'Así la corre de verdad: ves el resultado, no el plan.' },
          { cmd: `DESCRIBE ${HIVE_SUCURSAL}`, porque: 'DESCRIBE es para tablas (columnas y tipos), no para consultas: da error de sintaxis.' },
          { cmd: 'EXPLAIN ventas', porque: 'EXPLAIN va seguido de una consulta, no del nombre de una tabla.' },
        ],
      },
      donde: {
        yarn: 'Nada: EXPLAIN no lanza trabajos',
        compu: 'El plan, acá abajo',
      },
      does: 'Hive muestra los vértices (Map 1 → Reducer 2 → Reducer 3) sin correr nada.', expect: 'Un plan con vértices Map y Reducer',
      run: async c => {
        const p = await c.api.explain('hive', HIVE_SUCURSAL);
        return { summary: `Motor ${p.engine}${p.yarnStages ? `, ${p.yarnStages} etapas en YARN` : ''}`, out: { kind: 'text', text: p.raw.join('\n') }, vars: { 'hive.plan': p.raw.length ? '1' : '' } };
      },
      verify: async c => (c.vars['hive.plan'] ? { ok: true, detail: 'Se vio el plan' } : { ok: false, detail: 'Todavía no se pidió el plan' }),
    },
  ],
};
