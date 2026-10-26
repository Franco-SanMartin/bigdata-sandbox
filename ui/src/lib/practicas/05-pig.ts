/* Guía 05: Pig Latin sobre las ventas de HDFS. */
import { VENTAS_DIR, rowsCheck, runQuery, ventasEnHdfs } from './comun';
import type { Practice } from './tipos';

const LOAD = `ventas = LOAD '${VENTAS_DIR}' USING PigStorage(',')
         AS (fecha:chararray, sucursal:chararray, producto:chararray,
             cantidad:int, precio:int);
-- la primera línea del CSV es el encabezado
filas = FILTER ventas BY fecha != 'fecha';
`;

export const PIG_PRIMERAS = LOAD + 'primeras = LIMIT filas 10;\nDUMP primeras;';
export const PIG_PRODUCTO = LOAD + `lineas = FOREACH filas GENERATE producto, cantidad,
         (long) cantidad * precio AS importe;
por_producto = GROUP lineas BY producto;
totales = FOREACH por_producto GENERATE group AS producto,
          SUM(lineas.cantidad) AS unidades,
          SUM(lineas.importe) AS facturado;
ordenado = ORDER totales BY facturado DESC;
DUMP ordenado;`;

const EN = 'En la consola de Pig (pig, el prompt grunt>)';
const CENTRO = `centro = FILTER filas BY sucursal == 'Centro';
con_importe = FOREACH centro GENERATE fecha, producto, cantidad, (long) cantidad * precio AS importe;
`;
const ALGUNAS = 'algunas = LIMIT con_importe 10;\nDUMP algunas;';
export const PIG_CENTRO = LOAD + CENTRO + ALGUNAS;

export const pig: Practice = {
  id: 'pig', guide: '05', guideFile: '05-pig.md',
  title: 'Pig: las ventas en Pig Latin',
  summary: 'Cargás las ventas desde HDFS, filtrás una sucursal y agrupás por producto con LOAD, FILTER, GROUP y DUMP.',
  minutes: 15, cap: 'pig',
  learn: ['Cada línea arma una relación; nada corre hasta el DUMP o el STORE', 'Pig traduce el script a trabajos MapReduce en YARN', 'GROUP deja una bolsa por clave y SUM la resume'],
  steps: [
    ventasEnHdfs('Pig lee de HDFS: el LOAD apunta a la carpeta, no al archivo del contenedor.'),
    {
      id: 'load', title: 'LOAD y las primeras filas',
      command: PIG_PRIMERAS, en: EN, input: `${VENTAS_DIR} con su esquema`,
      does: 'Lee la carpeta con PigStorage, saca el encabezado y muestra 10 filas.', expect: '10 ventas con fecha, sucursal, producto, cantidad y precio',
      pregunta: {
        enunciado: 'Ahora queremos cargar las ventas con su esquema, sacar el encabezado y ver las primeras 10 filas. ¿Cuál es el script correcto?',
        opciones: [
          { cmd: PIG_PRIMERAS, correcta: true, porque: 'LOAD arma la relación con el esquema, FILTER saca la fila del encabezado, LIMIT se queda con 10 y DUMP es el que hace correr todo y muestra el resultado.' },
          { cmd: LOAD + 'primeras = LIMIT filas 10;', porque: 'Falta el DUMP: en Pig cada línea solo arma el plan y nada corre hasta un DUMP o un STORE. No ves ninguna fila.' },
          { cmd: LOAD.replace(/filas = FILTER[^\n]*\n/, '') + 'primeras = LIMIT ventas 10;\nDUMP primeras;', porque: 'Toma de ventas, sin el FILTER: la primera fila es el encabezado del CSV, y como "cantidad" y "precio" no son números, quedan vacíos (null).' },
          { cmd: LOAD + 'primeras = LIMIT filas 10;\nSELECT * FROM primeras;', porque: 'Pig Latin no tiene SELECT: eso es SQL (lo vas a usar en Hive). Para ver una relación se usa DUMP.' },
        ],
      },
      donde: {
        hdfs: `Lee ${VENTAS_DIR}; no escribe nada (DUMP muestra, STORE guardaría)`,
        yarn: 'Pig lo traduce a un trabajo MapReduce: lo ves en Trabajos o en http://localhost:8088',
        compu: 'Las 10 filas, acá abajo y en la consola de Pig',
      },
      run: async c => {
        const r = await runQuery(c, 'pig', PIG_PRIMERAS);
        return { ...r, vars: { ...r.vars, 'pig.load': String(r.rows.length) } };
      },
      verify: async c => (Number(c.vars['pig.load'] ?? 0) > 0 ? { ok: true, detail: `${c.vars['pig.load']} fila(s)` } : rowsCheck((await c.api.query('pig', PIG_PRIMERAS)).rows)),
    },
    {
      id: 'filter', title: 'FILTER y FOREACH: las ventas del Centro',
      command: PIG_CENTRO, en: EN, input: 'Las ventas sin encabezado',
      does: 'Se queda con la sucursal Centro y calcula el importe de cada venta.', expect: 'Filas con fecha, producto, cantidad e importe',
      pregunta: {
        enunciado: 'Ahora queremos quedarnos con las ventas de la sucursal Centro y calcular el importe (cantidad × precio) de cada una. ¿Cuál es el script correcto?',
        opciones: [
          { cmd: PIG_CENTRO, correcta: true, porque: "FILTER ... BY sucursal == 'Centro' se queda con esa sucursal (en Pig se compara con == y los textos van entre comillas simples) y FOREACH ... GENERATE calcula el importe de cada fila." },
          { cmd: LOAD + CENTRO.replace("== 'Centro'", "= 'Centro'") + ALGUNAS, porque: 'Con un solo = no es una comparación: en Pig se compara con == (como en Java) y así da error de sintaxis.' },
          { cmd: LOAD + CENTRO.replace("'Centro'", '"Centro"') + ALGUNAS, porque: 'En Pig Latin los textos van entre comillas simples; con comillas dobles da error de sintaxis.' },
          { cmd: LOAD + CENTRO.replace('FOREACH centro', 'FOREACH filas') + ALGUNAS, porque: 'El FOREACH recorre filas, no centro: calcula el importe de todas las sucursales y el FILTER queda sin usar.' },
        ],
      },
      donde: {
        hdfs: `Lee ${VENTAS_DIR}; no escribe nada`,
        yarn: 'Otro trabajo MapReduce, solo de map: filtrar y calcular no necesita juntar nada',
        compu: 'Las 10 ventas del Centro con su importe, acá abajo',
      },
      run: c => runQuery(c, 'pig', PIG_CENTRO),
      verify: async c => rowsCheck((await c.api.query('pig', PIG_CENTRO)).rows),
    },
    {
      id: 'group', title: 'GROUP y SUM: facturado por producto',
      command: PIG_PRODUCTO, en: EN, input: 'Las ventas sin encabezado',
      does: 'Agrupa por producto, suma unidades e importe y ordena de mayor a menor.', expect: 'yerba con 179.512 unidades y 448.780.000 facturados',
      pregunta: {
        enunciado: 'Ahora queremos el total de unidades y de facturado de cada producto, del que más facturó al que menos. ¿Cuál es el script correcto?',
        opciones: [
          { cmd: PIG_PRODUCTO, correcta: true, porque: 'GROUP deja una bolsa (lineas) por producto; en el FOREACH la clave se llama group y SUM(lineas.cantidad) suma adentro de cada bolsa. ORDER ... DESC deja arriba al que más facturó.' },
          { cmd: PIG_PRODUCTO.replace('GENERATE group AS producto', 'GENERATE producto'), porque: 'Después de un GROUP la clave se llama group: producto quedó adentro de la bolsa lineas. Pig contesta que el campo producto no existe en ese esquema.' },
          { cmd: PIG_PRODUCTO.replace('SUM(lineas.cantidad)', 'SUM(cantidad)'), porque: 'cantidad ahora vive dentro de la bolsa lineas: hay que decir SUM(lineas.cantidad). Así Pig no encuentra cantidad y da error.' },
          { cmd: PIG_PRODUCTO.replace('BY facturado DESC', 'BY facturado ASC'), porque: 'ASC ordena de menor a mayor: arriba quedaría el producto que menos facturó.' },
        ],
      },
      donde: {
        hdfs: `Lee ${VENTAS_DIR}; en el medio, el shuffle del GROUP pasa por los discos de los nodos, no por HDFS`,
        yarn: 'Varios trabajos MapReduce: uno agrupa y suma (con reduce) y el ORDER agrega otros (uno muestrea, otro ordena)',
        compu: 'Una fila por producto, acá abajo',
      },
      run: c => runQuery(c, 'pig', PIG_PRODUCTO),
      verify: async c => rowsCheck((await c.api.query('pig', PIG_PRODUCTO)).rows, { has: 'yerba' }),
      tip: 'El mismo número sale en MapReduce (guía 4), Hive (guía 6) y Spark (guía 8): cambia el motor, no el resultado.',
    },
  ],
};
