/* Datos en el modo demo: catálogo, esquema, consultas y planes de Hive, MySQL, MongoDB y Pig.
   Las consultas de ejemplo devuelven lo que dan los scripts reales; las demás, una nota. */
import type { CatalogEntry, DataSample, DataSource, QueryExample, QueryPlan, QueryResult, TableSchema } from '../types';
import { ApiFailure, fail } from '../errors';
import type { DemoEngine, StageDef } from './engine';
import { EXAMPLES, LIMPIAS_HEAD, MONGO_COLLECTIONS, MYSQL_TABLES, POR_CATEGORIA, POR_PRODUCTO, POR_SUCURSAL, VENTAS_HEAD, answer } from './datasets';
import { LIMPIAS_COLS, POR, PRODUCTOS_ROWS, VENTAS_COLS, n, procUp, needProc, trace } from './common';

const PROC: Record<DataSource, [string, string]> = { hive: ['hiveserver2', 'HiveServer2'], mysql: ['mysql', 'MySQL'], mongodb: ['mongodb', 'MongoDB'], pig: ['rm', 'ResourceManager'] };

/* DDL de ejemplos/ventas.hql y ejemplos/tienda.hql */
const HIVE_DDL: Record<string, string> = {
  'default.ventas': "CREATE EXTERNAL TABLE ventas (\n  fecha    STRING,\n  sucursal STRING,\n  producto STRING,\n  cantidad INT,\n  precio   INT\n)\nROW FORMAT DELIMITED FIELDS TERMINATED BY ','\nSTORED AS TEXTFILE\nLOCATION '/user/root/ventas'\nTBLPROPERTIES ('skip.header.line.count' = '1');",
  'default.tienda_ventas': "CREATE EXTERNAL TABLE tienda_ventas (\n  id       INT,\n  fecha    STRING,\n  sucursal STRING,\n  producto STRING,\n  cantidad INT,\n  precio   INT\n)\nROW FORMAT DELIMITED FIELDS TERMINATED BY ','\nSTORED AS TEXTFILE\nLOCATION '/user/root/tienda/ventas';",
  'default.tienda_productos': "CREATE EXTERNAL TABLE tienda_productos (\n  producto  STRING,\n  categoria STRING,\n  precio    INT\n)\nROW FORMAT DELIMITED FIELDS TERMINATED BY ','\nSTORED AS TEXTFILE\nLOCATION '/user/root/tienda/productos';",
  'default.ventas_limpias': "CREATE EXTERNAL TABLE ventas_limpias (\n  ticket     BIGINT,\n  fecha      TIMESTAMP,\n  sucursal   STRING,\n  producto   STRING,\n  cantidad   BIGINT,\n  precio     BIGINT,\n  importe    BIGINT,\n  medio_pago STRING\n)\nSTORED AS PARQUET\nLOCATION '/user/root/ml/ventas_limpias';",
};
/* DDL de ejemplos/tienda.sql */
const MYSQL_DDL: Record<string, string> = {
  'tienda.productos': 'CREATE TABLE productos (\n  producto  VARCHAR(20) PRIMARY KEY,\n  categoria VARCHAR(20) NOT NULL,\n  precio    INT         NOT NULL\n);',
  'tienda.sucursales': 'CREATE TABLE sucursales (\n  sucursal  VARCHAR(20) PRIMARY KEY,\n  encargado VARCHAR(30) NOT NULL,\n  apertura  DATE        NOT NULL\n);',
  'tienda.ventas': 'CREATE TABLE ventas (\n  id       INT AUTO_INCREMENT PRIMARY KEY,\n  fecha    DATE        NOT NULL,\n  sucursal VARCHAR(20) NOT NULL,\n  producto VARCHAR(20) NOT NULL,\n  cantidad INT         NOT NULL,\n  precio   INT         NOT NULL\n);',
  'tienda.resumen_categoria': 'CREATE TABLE resumen_categoria (\n  categoria VARCHAR(20) PRIMARY KEY,\n  unidades  INT         NOT NULL,\n  facturado BIGINT      NOT NULL\n);',
};

/* Pig: los mismos ejemplos y los mismos controles que el server (sandbox_server/datos.py) */
const PIG_LOAD = "ventas = LOAD '/user/root/ventas' USING PigStorage(',')\n         AS (fecha:chararray, sucursal:chararray, producto:chararray,\n             cantidad:int, precio:int);\n-- la primera línea del CSV es el encabezado\nfilas = FILTER ventas BY fecha != 'fecha';\n";
const PIG_IMPORTE = "lineas = FOREACH filas GENERATE producto, cantidad,\n         (long) cantidad * precio AS importe;\npor_producto = GROUP lineas BY producto;\n";
export const PIG_EXAMPLES: QueryExample[] = [
  { source: 'pig', label: 'Ventas por sucursal', script: 'ejemplos/ventas.pig', text: PIG_LOAD + "lineas = FOREACH filas GENERATE sucursal, (long) cantidad * precio AS importe;\npor_sucursal = GROUP lineas BY sucursal;\nresumen = FOREACH por_sucursal GENERATE group AS sucursal,\n          COUNT(lineas) AS tickets,\n          SUM(lineas.importe) AS facturado;\nDUMP resumen;" },
  { source: 'pig', label: 'Ventas por producto, ordenado', script: 'ejemplos/ventas.pig', text: PIG_LOAD + PIG_IMPORTE + "totales = FOREACH por_producto GENERATE group AS producto,\n          SUM(lineas.cantidad) AS unidades,\n          SUM(lineas.importe) AS facturado;\nordenado = ORDER totales BY facturado DESC;\nDUMP ordenado;" },
  { source: 'pig', label: 'Primeras 10 filas', script: 'ejemplos/ventas.pig', text: PIG_LOAD + 'primeras = LIMIT filas 10;\nDUMP primeras;' },
  { source: 'pig', label: 'Guardar el resultado en HDFS (STORE)', script: 'ejemplos/ventas.pig', text: PIG_LOAD + PIG_IMPORTE + "totales = FOREACH por_producto GENERATE group AS producto, SUM(lineas.importe) AS facturado;\nfs -rm -r -f /user/root/resultados/pig_por_producto;\nSTORE totales INTO '/user/root/resultados/pig_por_producto' USING PigStorage(',');" },
];
const HIVE_CREATE_VENTAS: QueryExample = { source: 'hive', label: 'Crear tabla ventas desde HDFS', script: 'ejemplos/ventas.hql', text: "CREATE EXTERNAL TABLE IF NOT EXISTS ventas (\n  fecha STRING, sucursal STRING, producto STRING,\n  cantidad INT, precio INT\n)\nROW FORMAT DELIMITED FIELDS TERMINATED BY ','\nSTORED AS TEXTFILE\nLOCATION '/user/root/ventas'\nTBLPROPERTIES ('skip.header.line.count' = '1');" };

/** Sin comentarios y con lo de adentro de las comillas en blanco, para buscar palabras clave */
const pigMask = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/--[^\n]*/g, m => ' '.repeat(m.length));
const PIG_HINT = ' Si lo necesitás, corrélo con pig en la terminal del contenedor.';
/** Un borrado solo puede ir adentro de /user/<alguien>/… (no /user entero, ni /tmp, ni el warehouse de Hive) */
export function pigPathOk(raw: string): boolean {
  let p = raw.replace(/^['"]|['"]$/g, '').replace(/^hdfs:\/\/[^/]*/, '') || '/';
  if (p.includes('$')) return false;
  if (!p.startsWith('/')) p = `/user/root/${p}`;
  const parts: string[] = [];
  for (const c of p.split('/')) { if (c === '..') parts.pop(); else if (c && c !== '.') parts.push(c); }
  return parts.length >= 3 && parts[0] === 'user' && parts[1] !== 'hive' && !/[*?[{]/.test(parts.slice(0, 2).join('/'));
}
/** Lo que el server no deja correr desde la interfaz */
export function pigCheck(text: string) {
  const m = pigMask(text).replace(/'[^'\n]*'/g, q => `'${' '.repeat(q.length - 2)}'`);
  if (m.includes('`')) fail('invalid', 'Pig desde la interfaz no corre comandos entre comillas invertidas (`…`): ni STREAM, ni DEFINE ni %declare con un comando.' + PIG_HINT);
  const sh = /(?:^|;)[ \t]*(sh|exec|run)\b/im.exec(m);
  if (sh) fail('invalid', `Pig desde la interfaz no permite ${sh[1].toLowerCase()}: ${sh[1].toLowerCase() === 'sh' ? 'corre comandos del sistema' : 'corre otro script'}.` + PIG_HINT);
  if (/\bstream\b[^;]*\bthrough\b/i.test(m)) fail('invalid', 'Pig desde la interfaz no permite STREAM … THROUGH (pasa los datos por un programa del sistema).' + PIG_HINT);
  const params = Object.fromEntries([...pigMask(text).matchAll(/^[ \t]*%(?:default|declare)[ \t]+(\w+)[ \t]+['"]?([^'"\n]*?)['"]?[ \t]*$/gim)].map(x => [x[1], x[2]]));
  for (const st of pigMask(text).split(';').map(x => x.replace(/^[ \t]*%[^\n]*$/gm, '').trim())) {
    if (/^register\b/i.test(st) && !/^register\s+['"]?[^\s'"]+\.jar['"]?$/i.test(st)) fail('invalid', 'Desde la interfaz, REGISTER solo acepta .jar (los UDF en Python o JavaScript corren código del sistema).' + PIG_HINT);
    const f = /^(fs\s+(-\w+)|rmf|rm|copytolocal)\b(?!\s*=)([\s\S]*)$/i.exec(st);
    if (!f) continue;
    const sub = (f[2] || f[1]).toLowerCase();
    if (['-get', '-copytolocal', '-movetolocal', '-getmerge', 'copytolocal'].includes(sub)) fail('invalid', 'Desde la interfaz Pig no escribe en el disco del contenedor (fs -get, copyToLocal).' + PIG_HINT);
    if (!['-rm', '-rmr', '-rmdir', 'rmf', 'rm'].includes(sub)) continue;
    const paths = f[3].replace(/\$\{?(\w+)\}?/g, (x, k) => params[k] ?? x).split(/\s+/).filter(a => a && !a.startsWith('-'));
    const bad = paths.find(a => !pigPathOk(a)) ?? (paths.length ? undefined : '(sin ruta)');
    if (bad) fail('invalid', `Pig desde la interfaz solo borra adentro de /user/<usuario>/…: ${bad} no se puede borrar desde acá.` + PIG_HINT);
  }
}

const hiveCols = (ddl: string) => [...ddl.matchAll(/^\s+(\w+)\s+(STRING|INT|BIGINT|TIMESTAMP)/gm)].map(m => ({ name: m[1], type: m[2] }));

export class DemoData {
  /** Tablas que creó el pipeline (ventas_limpias en Hive, resumen_<por> en MySQL) */
  hiveExtra = new Set<string>();
  mysqlExtra = new Map<string, { rows: number; columns: { name: string; type: string }[] }>();
  /** sqoop export ya llenó resumen_categoria */
  resumenCategoria = false;
  constructor(private e: DemoEngine) {}

  private has(prefix: string) { return this.e.files.some(f => f.path.startsWith(prefix) && !f.writing); }

  catalog(): CatalogEntry[] {
    if (this.e.phase !== 'running') fail('cluster_stopped', 'El cluster está apagado: arrancalo desde Cluster');
    const out: CatalogEntry[] = [];
    if (procUp(this.e, 'hiveserver2')) {
      const t = (name: string, rows: number, location: string) => out.push({ source: 'hive', name, kind: 'externa', rows, location, columns: hiveCols(HIVE_DDL[name]) });
      if (this.has('/user/root/ventas/') || this.hiveExtra.has('default.ventas')) t('default.ventas', this.has('/user/root/ventas/') ? 200000 : 0, '/user/root/ventas');
      if (this.has('/user/root/tienda/ventas/')) t('default.tienda_ventas', 200000, '/user/root/tienda/ventas');
      if (this.has('/user/root/tienda/productos/')) t('default.tienda_productos', 8, '/user/root/tienda/productos');
      if (this.hiveExtra.has('default.ventas_limpias')) t('default.ventas_limpias', 97200, '/user/root/ml/ventas_limpias');
    }
    if (procUp(this.e, 'mysql')) {
      out.push(...MYSQL_TABLES.map(t => (t.name === 'tienda.resumen_categoria' && this.resumenCategoria ? { ...t, rows: 4 } : t)));
      this.mysqlExtra.forEach((v, name) => out.push({ source: 'mysql', name, kind: 'tabla', rows: v.rows, columns: v.columns }));
    }
    if (procUp(this.e, 'mongodb')) out.push(...MONGO_COLLECTIONS);
    return out;
  }

  schema(source: DataSource, name: string): TableSchema {
    if (source === 'pig') fail('invalid', 'Pig no tiene catálogo propio: lee y escribe archivos de HDFS');
    needProc(this.e, ...PROC[source]);
    const entry = this.catalog().find(c => c.source === source && c.name === name);
    if (!entry) fail('not_found', `No existe ${name} en ${PROC[source][1]}`);
    const s = (columns: string[], rows: (string | number | null)[][], total: number | undefined, note?: string): DataSample => ({ columns, rows, total, note });
    if (source === 'hive') {
      const ddl = HIVE_DDL[name];
      const sample = name === 'default.ventas' ? s(VENTAS_COLS, VENTAS_HEAD, 200000) : name === 'default.tienda_ventas' ? s(['id', ...VENTAS_COLS], VENTAS_HEAD.map((r, i) => [i + 1, ...r]), 200000)
        : name === 'default.tienda_productos' ? s(['producto', 'categoria', 'precio'], PRODUCTOS_ROWS, 8) : s(LIMPIAS_COLS, LIMPIAS_HEAD, 97200);
      return { ...entry, columns: entry.columns, format: /PARQUET/.test(ddl) ? 'parquet' : 'textfile', ddl, sample, partitions: [], sizeMb: this.e.files.filter(f => f.path.startsWith(entry.location + '/')).reduce((a, f) => a + f.sizeMb, 0) };
    }
    if (source === 'mysql') {
      const ddl = MYSQL_DDL[name];
      const cols = ddl ? [...ddl.matchAll(/^\s+(\w+)\s+([A-Z]+(?:\(\d+\))?)(.*)$/gm)].map(m => ({ name: m[1], type: m[2], nullable: !/NOT NULL|PRIMARY KEY/.test(m[3]), key: /PRIMARY KEY/.test(m[3]) ? 'PK' as const : undefined })) : entry.columns;
      const short = name.split('.')[1];
      const r = answer('mysql', short === 'ventas' ? 'select * from ventas limit 5' : `select * from ${short}`);
      return { ...entry, columns: cols, format: 'InnoDB', ddl: ddl || this.mysqlExtraDdl(name), indexes: [{ name: 'PRIMARY', columns: [cols[0]?.name || 'id'], unique: true }],
        sample: r.rows.length ? s(r.columns, r.rows, entry.rows) : s([], [], entry.rows, name === 'tienda.resumen_categoria' && !this.resumenCategoria ? 'Vacía: acá vuelve el resultado de Hadoop con sqoop export' : undefined) };
    }
    const coll = name.split('.')[1];
    const idx = coll === 'pedidos' ? [{ name: '_id_', columns: ['_id'], unique: true }, { name: 'cliente_id_1', columns: ['cliente_id'], unique: false }, { name: 'items.producto_1', columns: ['items.producto'], unique: false }] : [{ name: '_id_', columns: ['_id'], unique: true }];
    const r = coll === 'productos' ? answer('mongodb', 'db.productos.find({ categoria: "accesorios" }, { precio: 1 })') : null;
    return { ...entry, format: 'WiredTiger', indexes: idx, ddl: idx.filter(i => i.name !== '_id_').map(i => `db.${coll}.createIndex({ ${i.columns[0].includes('.') ? `"${i.columns[0]}"` : i.columns[0]}: 1 })`).join('\n') || undefined,
      sample: r ? s(r.columns, r.rows, entry.rows) : s([], [], entry.rows, `En el modo demo no hay documentos de ${coll}: con el cluster real, db.${coll}.findOne()`) };
  }
  private mysqlExtraDdl(name: string) {
    const t = this.mysqlExtra.get(name);
    return t ? `CREATE TABLE ${name.split('.')[1]} (\n${t.columns.map((c, i) => `  ${c.name} ${c.type}${i === 0 ? ' PRIMARY KEY' : ' NOT NULL'}`).join(',\n')}\n);` : undefined;
  }

  /** Resultado para una consulta: los ejemplos reales, más los resúmenes de ventas_limpias */
  private resolve(source: DataSource, text: string): Omit<QueryResult, 'ms'> {
    const q = text.toLowerCase().replace(/\s+/g, ' ');
    if (source === 'hive' && /ventas_limpias/.test(q)) {
      const by = /group by (\w+)/.exec(q)?.[1];
      const key = by === 'medio_pago' ? 'pago' : by === 'month' || /month\(/.test(q) ? 'mes' : by;
      if (key && POR[key]) return { columns: POR[key].columns, rows: POR[key].rows };
      if (/limit/.test(q)) return { columns: LIMPIAS_COLS, rows: LIMPIAS_HEAD };
    }
    const created = source === 'hive' ? /^create (external )?table (if not exists )?(?:default\.)?(\w+)/.exec(q.trim()) : null;
    if (created) {
      const name = `default.${created[3]}`;
      const had = this.catalog().some(c => c.source === 'hive' && c.name === name);
      if (had && !created[2]) fail('failed', `Error: Error while processing statement: FAILED: Execution Error, return code 1 from org.apache.hadoop.hive.ql.exec.DDLTask. AlreadyExistsException(message:Table hive.default.${created[3]} already exists)`);
      if (name === 'default.ventas') this.hiveExtra.add(name);
      return { columns: [], rows: [], note: had ? `La tabla ${name} ya existía: IF NOT EXISTS no la toca` : `Tabla ${name} creada: apunta a los archivos de HDFS, no los copia` };
    }
    if (source === 'hive' && /join/.test(q) && /categoria/.test(q)) return { columns: ['categoria', 'unidades', 'facturado'], rows: POR_CATEGORIA };
    if (source === 'hive' && /from tienda_productos/.test(q)) return { columns: ['producto', 'categoria', 'precio'], rows: PRODUCTOS_ROWS };
    if (source === 'mysql' && /from resumen_categoria/.test(q)) return this.resumenCategoria ? { columns: ['categoria', 'unidades', 'facturado'], rows: POR_CATEGORIA } : { columns: ['categoria', 'unidades', 'facturado'], rows: [], note: 'Vacía hasta que sqoop export traiga el resultado de Hadoop' };
    const extra = source === 'mysql' ? /from (resumen_(\w+))/.exec(q) : null;
    if (extra && this.mysqlExtra.has(`tienda.${extra[1]}`) && POR[extra[2]]) return { columns: POR[extra[2]].columns, rows: POR[extra[2]].rows };
    return answer(source, text);
  }

  private command(source: DataSource, text: string) {
    const one = text.trim().replace(/\s+/g, ' ');
    return source === 'hive' ? `beeline -u jdbc:hive2://localhost:10000 -e "${one}"` : source === 'mysql' ? `mysql tienda -e "${one}"` : `mongosh --quiet tienda --eval '${one}'`;
  }
  /** Lo que contesta el motor si la consulta no compila o la tabla no existe (la última línea de su salida) */
  private check(source: DataSource, text: string) {
    const t = text.trim();
    const first = t.split(/\s+/)[0];
    if (source === 'mongodb') {
      if (!/^(db\.|show\s)/.test(t)) fail('failed', `SyntaxError: Unexpected token (1:${first.length}) · mongosh espera db.<colección>.find(…) o db.<colección>.aggregate([…])`);
      return;
    }
    if (!/^(select|with|show|describe|desc|explain|insert|create|drop|use)$/i.test(first)) {
      fail('failed', source === 'hive' ? `Error: Error while compiling statement: FAILED: ParseException line 1:0 cannot recognize input near '${first}' '${t.split(/\s+/)[1] ?? '<EOF>'}'`
        : `ERROR 1064 (42000): You have an error in your SQL syntax; check the manual that corresponds to your MariaDB server version for the right syntax to use near '${t.slice(0, 30)}' at line 1`);
    }
    const known = this.catalog().filter(c => c.source === source).map(c => c.name.split('.')[1]);
    for (const m of t.matchAll(/\b(?:from|join)\s+(\w+)(?:\.(\w+))?/gi)) {
      const tab = (m[2] ?? m[1]).toLowerCase();
      if (!known.includes(tab)) fail('failed', source === 'hive' ? `Error: Error while compiling statement: FAILED: SemanticException [Error 10001]: Line 1:${m.index} Table not found '${tab}'` : `ERROR 1146 (42S02): Table 'tienda.${tab}' doesn't exist`);
    }
  }

  /** Hive lanza un trabajo Tez si hay que agrupar, unir u ordenar; un SELECT con LIMIT lo resuelve solo (fetch task) */
  private needsJob(text: string) { return /group by|join|order by|count\(|sum\(|insert/i.test(text); }

  query(source: DataSource, text: string): Promise<QueryResult> {
    if (!text.trim()) fail('invalid', 'La consulta está vacía');
    if (source === 'pig') return this.pig(text);
    needProc(this.e, ...PROC[source]);
    this.check(source, text);
    const t0 = this.e.now();
    const r = this.resolve(source, text);
    const command = this.command(source, text);
    const big = /ventas/i.test(text) && !/limit/i.test(text);
    const tableRows = /ventas_limpias/i.test(text) ? 97200 : /pedidos/i.test(text) ? 20000 : /clientes/i.test(text) ? 2000 : 200000;
    const out = (o: Partial<QueryResult>): QueryResult => {
      const res: QueryResult = { ...r, ms: Math.round(this.e.now() - t0), ...o };
      res.trace = trace(command, o.scanned ? `${n(o.scanned)} filas leídas` : 'la consulta', o.appId ? 'HiveServer2 la convierte en un trabajo Tez y lo manda a YARN' : source === 'hive' ? 'HiveServer2 la resuelve leyendo directo de HDFS, sin YARN (fetch task)' : source === 'mysql' ? 'MySQL la resuelve en su propio proceso' : 'MongoDB la resuelve en su propio proceso',
        r.note && !r.rows.length ? r.note : `${n(r.rows.length)} fila${r.rows.length !== 1 ? 's' : ''} · ${(res.ms / 1000).toLocaleString('es-AR')} s`,
        { engine: res.engine, appIds: o.appId ? [o.appId] : undefined, after: { columns: r.columns, rows: r.rows.slice(0, 20), total: r.rows.length, note: r.note } });
      this.e.act('Vos', 'info', `Consulta en ${PROC[source][1]}`, { command, input: res.trace.input, action: res.trace.action, output: res.trace.output, appId: o.appId });
      return res;
    };
    if (source === 'hive' && this.needsJob(text) && r.rows.length) {
      needProc(this.e, 'rm', 'YARN');
      const bl = this.e.files.filter(f => f.path.startsWith(/limpias/i.test(text) ? '/user/root/ml/ventas_limpias' : '/user/root/ventas/')).flatMap(f => f.blocks.map(b => b.id));
      const nb = Math.max(1, bl.length);
      const st: StageDef[] = [
        { id: 'm1', name: 'Map 1', description: 'Lee la tabla, un bloque por tarea, y agrupa parcial', dependsOn: [], durSec: 4, n: nb, blocks: bl, ops: ['TableScan', 'Select Operator', 'Group By Operator (parcial)', 'Reduce Output Operator'] },
        { id: 'r2', name: 'Reducer 2', description: 'GROUP BY: junta los parciales', dependsOn: ['m1'], edge: 'SCATTER_GATHER', durSec: 3, n: 2, ops: ['Group By Operator (final)', 'Reduce Output Operator'] },
        { id: 'r3', name: 'Reducer 3', description: 'ORDER BY: una tarea ordena el resultado', dependsOn: ['r2'], edge: 'SCATTER_GATHER', durSec: 2, n: 1, ops: ['Select Operator', 'File Output Operator'] },
      ];
      const appId = this.e.submitApp({ type: 'TEZ', name: `HIVE: ${text.trim().replace(/\s+/g, ' ').slice(0, 60)}`, am: 1024, amStart: 8, taskMb: 1024, executors: 0, stages: st, rowsIn: tableRows, rowsOut: r.rows.length }, { command, input: `${n(tableRows)} filas`, quiet: true });
      return new Promise((ok, ko) => this.e.watch(appId, { done: () => ok(out({ appId, engine: 'tez', scanned: tableRows })), fail: why => ko(new ApiFailure(why, 'failed')) }));
    }
    const ms = source === 'hive' ? 400 : big ? 180 : 3;
    return new Promise(ok => this.e.at(ms / 1000, () => ok(out({ engine: 'uno', ms, scanned: big ? tableRows : r.rows.length }))));
  }

  explain(source: DataSource, text: string): QueryPlan {
    if (!text.trim()) fail('invalid', 'La consulta está vacía');
    if (source === 'pig') return this.pigExplain(text);
    needProc(this.e, ...PROC[source]);
    this.check(source, text);
    const q = text.toLowerCase().replace(/\s+/g, ' ');
    const table = /from (\w+)/.exec(q)?.[1] || /db\.(\w+)/.exec(q)?.[1] || '?';
    if (source === 'hive') {
      const key = /group by ([\w.]+)/.exec(q)?.[1];
      if (!this.needsJob(text)) {
        return { source, engine: 'uno', nodes: [{ id: 0, label: 'Fetch Operator', detail: 'sin YARN: HiveServer2 lee el archivo directo', children: [1] }, { id: 1, label: 'Limit', children: [2] }, { id: 2, label: 'Select Operator', children: [3] }, { id: 3, label: 'TableScan', detail: `alias: ${table}`, children: [] }],
          raw: ['STAGE DEPENDENCIES:', '  Stage-0 is a root stage', '', 'STAGE PLANS:', '  Stage: Stage-0', '    Fetch Operator', '      limit: 5', '      Processor Tree:', '        TableScan', `          alias: ${table}`, '          Select Operator', '            Limit', '              ListSink'] };
      }
      return {
        source, engine: 'tez', yarnStages: 3,
        nodes: [{ id: 0, label: 'Reducer 3', detail: 'ORDER BY', children: [1] }, { id: 1, label: 'Reducer 2', detail: key ? `Group By Operator · keys: ${key}` : 'Group By Operator', children: [2] }, { id: 2, label: 'Map 1', detail: `TableScan ${table} → Group By parcial`, children: [] }],
        raw: ['STAGE DEPENDENCIES:', '  Stage-1 is a root stage', '  Stage-0 depends on stages: Stage-1', '', 'STAGE PLANS:', '  Stage: Stage-1', '    Tez', '      Edges:', '        Reducer 2 <- Map 1 (SIMPLE_EDGE)', '        Reducer 3 <- Reducer 2 (SIMPLE_EDGE)', '      Vertices:', '        Map 1', '            Map Operator Tree:', '                TableScan', `                  alias: ${table}`, '                  Select Operator', '                    Group By Operator', `                      keys: ${key || '—'}`, '                      Reduce Output Operator', '        Reducer 2', '            Reduce Operator Tree:', '              Group By Operator', '                Reduce Output Operator', '        Reducer 3', '            Reduce Operator Tree:', '              Select Operator', '                File Output Operator', '', '  Stage: Stage-0', '    Fetch Operator'],
      };
    }
    if (source === 'mysql') {
      const rows: Record<string, number> = { ventas: 200000, productos: 8, sucursales: 4, resumen_categoria: this.resumenCategoria ? 4 : 0 };
      const join = /join (\w+)/.exec(q)?.[1];
      const head = 'id | select_type | table | type   | possible_keys | key     | rows   | Extra';
      const lines = [`1  | SIMPLE      | ${table.padEnd(5)} | ALL    | NULL          | NULL    | ${String(rows[table] ?? '?').padEnd(6)} | ${/group by/.test(q) ? 'Using temporary; Using filesort' : ''}`];
      if (join) lines.push(`1  | SIMPLE      | ${join.slice(0, 5).padEnd(5)} | eq_ref | PRIMARY       | PRIMARY | 1      | `);
      return { source, engine: 'uno', nodes: [{ id: 0, label: /group by/.test(q) ? 'Agrupa (tabla temporal + orden)' : 'Devuelve filas', children: join ? [1, 2] : [1] }, { id: 1, label: `Recorre ${table} entera (ALL)`, rows: rows[table], children: [] }, ...(join ? [{ id: 2, label: `Busca en ${join} por clave primaria (eq_ref)`, rows: 1, children: [] }] : [])], raw: [head, ...lines] };
    }
    const ix = /cliente_id/.test(q) ? 'cliente_id_1' : /items\.producto/.test(q) ? 'items.producto_1' : /_id/.test(q) ? '_id_' : null;
    const docs: Record<string, number> = { pedidos: 20000, clientes: 2000, productos: 9 };
    return {
      source, engine: 'uno',
      nodes: ix ? [{ id: 0, label: 'FETCH', detail: 'trae el documento entero', children: [1] }, { id: 1, label: 'IXSCAN', detail: `índice ${ix}: solo lee lo que coincide`, children: [] }] : [{ id: 0, label: 'COLLSCAN', detail: `lee los ${n(docs[table] ?? 0)} documentos`, rows: docs[table], children: [] }],
      raw: ix ? ['queryPlanner.winningPlan:', '  stage: FETCH', '  inputStage:', '    stage: IXSCAN', `    indexName: ${ix}`] : ['queryPlanner.winningPlan:', '  stage: COLLSCAN', `executionStats.totalDocsExamined: ${docs[table] ?? '?'}`],
    };
  }

  /** Qué haría el script: trabajos MapReduce, alias que se muestra y sus filas */
  private pigPlan(text: string) {
    needProc(this.e, 'rm', 'YARN');
    needProc(this.e, 'nm', 'El NodeManager');
    pigCheck(text);
    const m = pigMask(text);
    const load = /\bload\s+'([^']+)'/i.exec(m);
    if (!load) fail('failed', "ERROR 1000: Error during parsing. El script no lee nada: falta un alias = LOAD '/ruta' …;");
    const path = load[1].replace(/\/$/, '');
    if (!this.e.files.some(f => f.path.startsWith(path + '/') && !f.writing)) fail('failed', `ERROR 2118: Input path does not exist: hdfs://nn:8020${path}`);
    const dumps = [...m.matchAll(/^\s*dump\s+(\w+)/gim)].map(x => x[1]);
    const stores = [...m.matchAll(/^\s*store\s+(\w+)\s+into\s+'([^']+)'/gim)].map(x => ({ alias: x[1], path: x[2] }));
    const group = /\bgroup\s+\w+\s+by\s+(\w+)/i.exec(m)?.[1]?.toLowerCase();
    const order = /\border\s+\w+\s+by\s+\w+(\s+desc)?/i.exec(m);
    const limit = /\blimit\s+\w+\s+(\d+)/i.exec(m);
    const jobs: { name: string; ops: { map: string[]; reduce: string[] } }[] = [];
    if (group) jobs.push({ name: `GROUP BY ${group}`, ops: { map: ['Load', 'Filter', 'New For Each', 'Local Rearrange'], reduce: ['Package', 'New For Each', order ? 'Store (temporal)' : 'Store'] } });
    if (order) jobs.push({ name: 'ORDER BY (muestreo)', ops: { map: ['Load', 'Local Rearrange'], reduce: ['Package', 'Store (temporal)'] } }, { name: 'ORDER BY (orden)', ops: { map: ['Load', 'Local Rearrange'], reduce: ['Package', 'Store'] } });
    if (!jobs.length) jobs.push({ name: limit ? 'LIMIT' : 'Load', ops: { map: ['Load', 'Filter', ...(limit ? ['Limit'] : [])], reduce: limit ? ['Limit', 'Store'] : [] } });
    let columns: string[] = ['fecha', 'sucursal', 'producto', 'cantidad', 'precio'];
    let rows: (string | number | null)[][] = VENTAS_HEAD.map(r => [...r]);
    if (group === 'sucursal' || group === 'producto') {
      rows = (group === 'sucursal' ? POR_SUCURSAL : POR_PRODUCTO).map(r => [...r]);
      if (order) rows.sort((a, b) => (order[1] ? -1 : 1) * (Number(a[a.length - 1]) - Number(b[b.length - 1])));
      else rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      const names = [...(/generate\s+([\s\S]*?);/i.exec(m.slice(m.search(/\bgroup\s+\w+\s+by/i)))?.[1] ?? '').matchAll(/\bas\s+(\w+)/gi)].map(x => x[1]);
      columns = names.length >= 2 ? names : [group, 'tickets', 'facturado'];
      rows = rows.map(r => columns.map((_, i) => r[i] ?? null));
    } else if (limit) rows = rows.slice(0, Number(limit[1]));
    if (columns.length !== (rows[0]?.length ?? columns.length)) columns = rows[0].map((_, i) => `$${i}`);
    return { dumps, stores, jobs, columns, rows, path };
  }

  /** Pig compila el script a trabajos MapReduce: acá se corre uno solo con todas sus etapas */
  private pig(text: string): Promise<QueryResult> {
    const p = this.pigPlan(text);
    const t0 = this.e.now();
    const command = 'pig -x mapreduce -f consulta.pig';
    const bl = this.e.files.filter(f => f.path.startsWith(p.path + '/')).flatMap(f => f.blocks.map(b => b.id));
    const stages: StageDef[] = p.jobs.flatMap((j, i) => [
      { id: `m${i}`, name: `Map ${i + 1}`, description: `${j.name}: ${j.ops.map.join(' → ')}`, dependsOn: i ? [`r${i - 1}`] : [], durSec: 5, n: i ? 1 : Math.max(1, bl.length), blocks: i ? undefined : bl, ops: j.ops.map },
      ...(j.ops.reduce.length ? [{ id: `r${i}`, name: `Reduce ${i + 1}`, description: `${j.name}: ${j.ops.reduce.join(' → ')}`, dependsOn: [`m${i}`], edge: 'shuffle + sort', durSec: 4, n: 1, ops: j.ops.reduce }] : []),
    ]);
    for (const s of stages) if (s.dependsOn[0] && !stages.some(x => x.id === s.dependsOn[0])) s.dependsOn = [`m${Number(s.dependsOn[0].slice(1))}`];
    const store = p.stores[p.stores.length - 1];
    const appId = this.e.submitApp({ type: 'MAPREDUCE', name: 'PigLatin:consulta.pig', am: 512, amStart: 6, taskMb: 512, executors: 0, stages, rowsIn: 200000, rowsOut: p.rows.length, out: store?.path }, { command, input: `${p.path} · ${Math.max(1, bl.length)} bloques`, quiet: true });
    return new Promise((ok, ko) => this.e.watch(appId, {
      done: () => {
        const shown = p.dumps.length > 0;
        const columns = shown ? p.columns : [];
        const rows = shown ? p.rows : [];
        const note = !shown ? 'El script no tiene DUMP: lo que guardó con STORE quedó en HDFS'
          : p.dumps.length > 1 ? `El script tiene ${p.dumps.length} DUMP: se muestra el último (${p.dumps[p.dumps.length - 1]})`
            : !/\bgroup\b/i.test(text) ? 'En el modo demo se muestran unas pocas filas de ejemplo' : undefined;
        const ms = Math.round(this.e.now() - t0);
        const output = shown ? `${n(rows.length)} fila${rows.length !== 1 ? 's' : ''} · ${(ms / 1000).toLocaleString('es-AR')} s` : `Listo · ${(ms / 1000).toLocaleString('es-AR')} s`;
        const action = `Pig compila el script a ${p.jobs.length} trabajo${p.jobs.length !== 1 ? 's' : ''} MapReduce y los manda a YARN`;
        const res: QueryResult = { columns, rows, ms, appId, engine: 'mr', note,
          trace: trace(command, 'el script', action, output, { engine: 'mr', appIds: [appId], after: { columns, rows: rows.slice(0, 20), total: rows.length, note } }) };
        this.e.act('Vos', 'info', 'Script de Pig', { command, input: 'el script', action, output, appId });
        ok(res);
      },
      fail: why => ko(new ApiFailure(why, 'failed')),
    }));
  }

  private pigExplain(text: string): QueryPlan {
    const p = this.pigPlan(text);
    const nodes = [...p.jobs].reverse().map((j, i, all) => ({ id: i, label: `Trabajo MapReduce ${all.length - i}`, detail: `map: ${j.ops.map.join(' → ')}${j.ops.reduce.length ? ` · reduce: ${j.ops.reduce.join(' → ')}` : ''}`, children: i + 1 < all.length ? [i + 1] : [] }));
    const raw = ['#--------------------------------------------------', '# Map Reduce Plan', '#--------------------------------------------------',
      ...p.jobs.flatMap((j, i) => [`MapReduce node scope-${10 * (i + 1)}`, 'Map Plan', ...[...j.ops.map].reverse().map((o, k) => `${'    '.repeat(k)}${k ? '|---' : ''}${o} - scope-${10 * (i + 1) + k}`), ...(j.ops.reduce.length ? ['Reduce Plan', ...[...j.ops.reduce].reverse().map((o, k) => `${'    '.repeat(k)}${k ? '|---' : ''}${o} - scope-${10 * (i + 1) + 5 + k}`)] : []), '----------------', ''])];
    return { source: 'pig', engine: 'mr', yarnStages: p.jobs.length, nodes, raw };
  }

  examples(): QueryExample[] {
    const hql: QueryExample[] = EXAMPLES.hive.map(x => ({ source: 'hive' as const, ...x, script: 'ejemplos/ventas.hql' }));
    hql.push({ source: 'hive', label: 'JOIN de lo que trajo Sqoop: por categoría', script: 'ejemplos/tienda.hql', text: 'SELECT p.categoria,\n       SUM(v.cantidad) AS unidades,\n       SUM(CAST(v.cantidad AS BIGINT) * v.precio) AS facturado\nFROM tienda_ventas v\nJOIN tienda_productos p ON v.producto = p.producto\nGROUP BY p.categoria\nORDER BY facturado DESC;' });
    const sql: QueryExample[] = EXAMPLES.mysql.map(x => ({ source: 'mysql' as const, ...x, script: 'ejemplos/tienda.sql' }));
    sql.push({ source: 'mysql', label: 'Lo que devolvió sqoop export', text: 'SELECT * FROM resumen_categoria ORDER BY facturado DESC;', script: 'ejemplos/sqoop.sh' });
    /* ejemplos/consultas_mongo.js, de a una */
    const js = 'ejemplos/consultas_mongo.js';
    const mongo: QueryExample[] = [
      ...EXAMPLES.mongodb.map(x => ({ source: 'mongodb' as const, ...x, script: js })),
      { source: 'mongodb', label: 'Campos que solo algunos tienen ($exists)', text: 'db.clientes.countDocuments({ email: { $exists: true } })', script: js },
      { source: 'mongodb', label: 'Adentro de un subdocumento', text: 'db.clientes.countDocuments({ "mayorista.descuento_pct": 15 })', script: js },
      { source: 'mongodb', label: 'Por producto ($unwind + $group)', text: 'db.pedidos.aggregate([\n  { $unwind: "$items" },\n  { $group: { _id: "$items.producto",\n              unidades: { $sum: "$items.cantidad" },\n              facturado: { $sum: { $multiply: ["$items.cantidad", "$items.precio"] } } } },\n  { $sort: { facturado: -1 } }\n])', script: js },
      { source: 'mongodb', label: 'JOIN con $lookup: mejores clientes', text: 'db.pedidos.aggregate([\n  { $group: { _id: "$cliente_id", gastado: { $sum: "$total" }, pedidos: { $sum: 1 } } },\n  { $sort: { gastado: -1 } },\n  { $limit: 3 },\n  { $lookup: { from: "clientes", localField: "_id", foreignField: "_id", as: "cliente" } },\n  { $project: { gastado: 1, pedidos: 1, nombre: { $first: "$cliente.nombre" } } }\n])', script: js },
      { source: 'mongodb', label: 'Índice: IXSCAN en vez de COLLSCAN', text: 'db.pedidos.find({ cliente_id: 42 }).explain("executionStats")', script: js },
    ];
    return [...hql, HIVE_CREATE_VENTAS, ...sql, ...mongo, ...PIG_EXAMPLES];
  }
}
