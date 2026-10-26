/* Guía 07: MariaDB y Sqoop. La base de origen y cómo pasar una tabla a HDFS. */
import { waitFor } from './motor';
import { armada, lsOut, lsRaw, rowsCheck, runQuery } from './comun';
import type { Practice } from './tipos';

export const SQL_PRODUCTOS = 'SELECT * FROM productos';
export const SQL_JOIN = `SELECT p.categoria, SUM(v.cantidad) AS unidades,
       SUM(v.cantidad * v.precio) AS facturado
FROM ventas v JOIN productos p ON v.producto = p.producto
GROUP BY p.categoria
ORDER BY facturado DESC`;
const TARGET = '/user/root/tienda/ventas';
const PRODUCTOS = `mysql tienda -e "${SQL_PRODUCTOS}"`;
/** Usuario y clave: los de la guía (los mismos que usa el servidor si no le cambiaron la configuración) */
const SQOOP = `sqoop import --connect jdbc:mysql://localhost/tienda --username alumno --password alumno --table ventas -m 4 --target-dir ${TARGET} --delete-target-dir`;

export const mysqlSqoop: Practice = {
  id: 'mysql-sqoop', guide: '07', guideFile: '07-mysql-sqoop.md',
  title: 'MariaDB y Sqoop: de la base a HDFS',
  summary: 'Consultás la base tienda, hacés un JOIN y traés la tabla ventas a HDFS con Sqoop.',
  minutes: 15, cap: 'mysql',
  learn: ['La base relacional es el origen: tablas chicas, con clave e índices', 'Sqoop lanza un MapReduce: cada mapper lee un pedazo de la tabla', 'En HDFS quedan archivos part-m-*, uno por mapper'],
  steps: [
    {
      id: 'productos', title: 'Ver los productos',
      command: PRODUCTOS, input: 'La tabla productos',
      does: 'MariaDB devuelve la tabla entera: es chica.', expect: '8 productos con su categoría y precio',
      pregunta: {
        enunciado: 'Ahora queremos ver, desde la terminal del contenedor, la tabla productos de la base tienda. ¿Cuál es el comando correcto?',
        opciones: [
          { cmd: PRODUCTOS, correcta: true, porque: 'mysql tienda entra a la base tienda y -e "…" ejecuta esa consulta y sale. Sin -e te deja en la consola de MySQL.' },
          { cmd: `mysql -e "${SQL_PRODUCTOS}"`, porque: 'Falta decir la base: sin tienda, MySQL no sabe dónde buscar productos y contesta No database selected.' },
          { cmd: `mysql tienda "${SQL_PRODUCTOS}"`, porque: 'Sin -e, mysql toma la consulta como otro argumento y no la ejecuta: da error de uso. -e es el que dice "ejecutá esto".' },
          { cmd: 'hdfs dfs -cat /user/root/tienda/productos', porque: 'La tabla vive en MariaDB, no en HDFS: hasta que no la traigas con Sqoop no hay ningún archivo en HDFS.' },
        ],
      },
      donde: {
        contenedor: 'La base tienda vive en MariaDB, en el contenedor (sus archivos en /var/lib/mysql): no está en HDFS',
        compu: 'Los 8 productos, acá abajo (y en Consultas, eligiendo MySQL)',
      },
      run: async c => {
        const r = await runQuery(c, 'mysql', SQL_PRODUCTOS);
        return { ...r, vars: { 'mysql.productos': String(r.rows.length) } };
      },
      verify: async c => {
        const n = Number(c.vars['mysql.productos'] ?? (await c.api.query('mysql', SQL_PRODUCTOS)).rows.length);
        return n === 8 ? { ok: true, detail: '8 productos' } : { ok: n > 0, detail: `${n} producto(s)` };
      },
    },
    {
      id: 'join', title: 'Facturado por categoría (JOIN)',
      command: SQL_JOIN, en: 'En la consola de MySQL (mysql tienda)', input: 'ventas y productos',
      pregunta: {
        enunciado: 'Ahora queremos el facturado por categoría: cada venta tiene el producto, y la categoría está en la tabla productos. ¿Cuál es la consulta correcta?',
        opciones: [
          { cmd: SQL_JOIN, correcta: true, porque: 'JOIN ... ON v.producto = p.producto une cada venta con su producto por la clave; después GROUP BY p.categoria suma por categoría.' },
          { cmd: SQL_JOIN.replace(' ON v.producto = p.producto', ''), porque: 'Sin ON, el JOIN cruza cada venta con todos los productos (8 veces cada una): los totales salen multiplicados.' },
          { cmd: SQL_JOIN.replace('ON v.producto = p.producto', 'ON v.producto = p.categoria'), porque: 'Une por columnas que no tienen nada que ver: el producto de una venta nunca es igual a una categoría y no queda ninguna fila.' },
          { cmd: SQL_JOIN.replace('GROUP BY p.categoria', 'GROUP BY v.producto'), porque: 'Agrupa por producto, no por categoría: da una fila por producto en vez de una por categoría.' },
        ],
      },
      donde: {
        contenedor: 'Todo pasa adentro de MariaDB: usa la clave de productos para unir rápido',
        compu: 'Una fila por categoría, acá abajo',
      },
      does: 'Une cada venta con su producto por la clave y agrupa por categoría.', expect: 'Una fila por categoría',
      run: async c => {
        const r = await runQuery(c, 'mysql', SQL_JOIN);
        return { ...r, vars: { 'mysql.join': String(r.rows.length) } };
      },
      verify: async c => (Number(c.vars['mysql.join'] ?? 0) > 0 ? { ok: true, detail: `${c.vars['mysql.join']} categoría(s)` } : rowsCheck((await c.api.query('mysql', SQL_JOIN)).rows)),
    },
    {
      id: 'sqoop', title: 'Traer la tabla ventas a HDFS',
      command: SQOOP,
      input: 'La tabla tienda.ventas', cap: 'sqoop',
      does: 'Lanza un MapReduce con 4 mappers; cada uno lee un rango de id y escribe un archivo. Entra con el usuario alumno.', expect: `${TARGET} con part-m-00000 a part-m-00003`,
      pregunta: {
        enunciado: `Ahora queremos traer la tabla ventas de MariaDB a HDFS, en ${TARGET}, con 4 mappers. ¿Cuál es el comando correcto?`,
        opciones: [
          { cmd: SQOOP, correcta: true, porque: 'sqoop import va de la base a HDFS: --connect dice qué base, --table qué tabla, -m 4 cuántos mappers leen en paralelo y --delete-target-dir borra la carpeta de destino si ya estaba.' },
          { cmd: SQOOP.replace('sqoop import', 'sqoop export'), porque: 'export hace el camino contrario: de HDFS a la base. Para traer la tabla a HDFS es import.' },
          { cmd: SQOOP.replace(' --delete-target-dir', ''), porque: `Si ${TARGET} ya existe (la segunda vez que lo corrés, por ejemplo), Sqoop no arranca: avisa que la carpeta ya existe. --delete-target-dir la borra antes.` },
          { cmd: SQOOP.replace('jdbc:mysql://localhost/tienda', 'jdbc:mysql://localhost:9870/tienda'), porque: '9870 es la web del NameNode, no MariaDB: el conector no puede hablar con eso y no conecta. MariaDB escucha en su puerto de siempre (3306), que no hace falta escribir.' },
        ],
      },
      donde: {
        contenedor: 'MariaDB no cambia: Sqoop solo lee la tabla',
        yarn: 'El trabajo {sqoopApp}: MapReduce sin reduce, con 4 mappers',
        hdfs: `${TARGET}: _SUCCESS y part-m-00000 a part-m-00003, uno por mapper`,
        compu: `HDFS → Archivos → ${TARGET}`,
      },
      run: async c => {
        const id = await c.api.runStep({ stage: 'ingesta', tool: 'sqoop', options: { mappers: 4 } });
        const w = await waitFor(c, async () => (await c.api.steps()).find(s => s.id === id), s => !!s && s.state !== 'running',
          { seconds: 300, every: 2500, what: 'Sqoop está leyendo la tabla…' });
        const s = w.value;
        if (!s) throw new Error('No aparece el paso de Sqoop');
        if (s.state === 'running') throw new Error(`Sqoop sigue corriendo (${Math.round(s.progress * 100)} %): probá Verificar en un rato`);
        if (s.state === 'failed') throw new Error(s.error ?? 'Sqoop falló');
        return {
          summary: `Listo: ${s.output?.path ?? TARGET}${s.output?.rows ? `, ${s.output.rows.toLocaleString('es-AR')} filas` : ''}`,
          trace: s.trace, vars: { sqoopApp: s.appIds[0] ?? '(ver Trabajos)' },
          raw: armada([
            ...(s.appIds[0] ? [{ stream: 'err' as const, text: `INFO impl.YarnClientImpl: Submitted application ${s.appIds[0]}` }] : []),
            ...(s.output?.rows != null ? [{ stream: 'err' as const, text: `INFO mapreduce.ImportJobBase: Retrieved ${s.output.rows} records.` }] : []),
          ], c.api.mode === 'demo' ? 'Modo demo: salida simulada con el mismo formato que la terminal' : 'Resumida: las dos líneas que importan de lo que imprime Sqoop (el resto son INFO de Hadoop)'),
          link: s.appIds[0] ? { label: 'Ver el trabajo', page: 'yarn', arg: s.appIds[0] } : { label: 'Ver en HDFS', page: 'hdfs', arg: TARGET },
        };
      },
      verify: async c => {
        try {
          const l = await c.api.hdfsList(TARGET);
          const parts = l.entries.filter(e => /^part-m-/.test(e.name)).length;
          return parts ? { ok: true, detail: `${parts} archivo(s) part-m-* en ${TARGET}` } : { ok: false, detail: `${TARGET} está, pero sin part-m-*` };
        } catch {
          return { ok: false, detail: `No está ${TARGET}` };
        }
      },
      tip: 'Con -m 1 queda un solo archivo; con más mappers lee más rápido si la tabla es grande.',
    },
    {
      id: 'ls', title: 'Mirar lo que dejó en HDFS',
      command: `hdfs dfs -ls ${TARGET}`, input: TARGET, cap: 'hdfs.read',
      does: 'Lista los archivos: _SUCCESS y un part-m-* por mapper.', expect: 'Los part-m-* con las filas de la tabla',
      pregunta: {
        enunciado: `Ahora queremos ver qué archivos dejó Sqoop en ${TARGET}. ¿Cuál es el comando correcto?`,
        opciones: [
          { cmd: `hdfs dfs -ls ${TARGET}`, correcta: true, porque: '-ls le pregunta al NameNode qué hay en esa carpeta de HDFS: ves _SUCCESS y un part-m-* por cada mapper.' },
          { cmd: `ls ${TARGET}`, porque: 'Es el ls de Linux: mira el disco del contenedor, y Sqoop escribió en HDFS.' },
          { cmd: `hdfs dfs -cat ${TARGET}`, porque: '-cat muestra el contenido de un archivo; a una carpeta contesta que es un directorio (Is a directory).' },
          { cmd: 'mysql tienda -e "SHOW TABLES"', porque: 'Eso mira la base, que no cambió: lo que dejó Sqoop está en HDFS.' },
        ],
      },
      donde: {
        hdfs: `${TARGET}: un part-m-* por mapper, cada uno con un rango de filas`,
        compu: `HDFS → Archivos → ${TARGET}`,
      },
      run: async c => {
        const l = await c.api.hdfsList(TARGET);
        return { summary: `${l.entries.length} archivo(s) en ${TARGET}`, out: lsOut(l), raw: lsRaw(c, l), link: { label: 'Ver en HDFS', page: 'hdfs', arg: TARGET } };
      },
    },
  ],
};
