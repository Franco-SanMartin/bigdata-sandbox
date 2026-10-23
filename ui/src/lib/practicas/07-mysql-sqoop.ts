/* Guía 07: MariaDB y Sqoop. La base de origen y cómo pasar una tabla a HDFS. */
import { waitFor } from './motor';
import { lsOut, rowsCheck, runQuery } from './comun';
import type { Practice } from './tipos';

export const SQL_PRODUCTOS = 'SELECT * FROM productos';
export const SQL_JOIN = `SELECT p.categoria, SUM(v.cantidad) AS unidades,
       SUM(v.cantidad * v.precio) AS facturado
FROM ventas v JOIN productos p ON v.producto = p.producto
GROUP BY p.categoria
ORDER BY facturado DESC`;
const TARGET = '/user/root/tienda/ventas';

export const mysqlSqoop: Practice = {
  id: 'mysql-sqoop', guide: '07', guideFile: '07-mysql-sqoop.md',
  title: 'MariaDB y Sqoop: de la base a HDFS',
  summary: 'Consultás la base tienda, hacés un JOIN y traés la tabla ventas a HDFS con Sqoop.',
  minutes: 15, cap: 'mysql',
  learn: ['La base relacional es el origen: tablas chicas, con clave e índices', 'Sqoop lanza un MapReduce: cada mapper lee un pedazo de la tabla', 'En HDFS quedan archivos part-m-*, uno por mapper'],
  steps: [
    {
      id: 'productos', title: 'Ver los productos',
      command: `mysql tienda -e "${SQL_PRODUCTOS}"`, input: 'La tabla productos',
      does: 'MariaDB devuelve la tabla entera: es chica.', expect: '8 productos con su categoría y precio',
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
      command: SQL_JOIN, input: 'ventas y productos',
      does: 'Une cada venta con su producto por la clave y agrupa por categoría.', expect: 'Una fila por categoría',
      run: async c => {
        const r = await runQuery(c, 'mysql', SQL_JOIN);
        return { ...r, vars: { 'mysql.join': String(r.rows.length) } };
      },
      verify: async c => (Number(c.vars['mysql.join'] ?? 0) > 0 ? { ok: true, detail: `${c.vars['mysql.join']} categoría(s)` } : rowsCheck((await c.api.query('mysql', SQL_JOIN)).rows)),
    },
    {
      id: 'sqoop', title: 'Traer la tabla ventas a HDFS',
      command: `sqoop import --connect jdbc:mysql://localhost/tienda --table ventas -m 4 --target-dir ${TARGET} --delete-target-dir`,
      input: 'La tabla tienda.ventas', cap: 'sqoop',
      does: 'Lanza un MapReduce con 4 mappers; cada uno lee un rango de id y escribe un archivo.', expect: `${TARGET} con part-m-00000 a part-m-00003`,
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
          trace: s.trace, vars: s.appIds[0] ? { 'sqoop.app': s.appIds[0] } : undefined,
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
      run: async c => {
        const l = await c.api.hdfsList(TARGET);
        return { summary: `${l.entries.length} archivo(s) en ${TARGET}`, out: lsOut(l), link: { label: 'Ver en HDFS', page: 'hdfs', arg: TARGET } };
      },
    },
  ],
};
