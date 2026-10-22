/* Piezas que comparten los módulos del demo: muestras de datos por ruta, chequeos y el rastro de cada acción. */
import type { ActionTrace, DataSample, Engine } from '../types';
import { fail } from '../errors';
import type { DemoEngine } from './engine';
import {
  CLIENTES_COLS, CLIENTES_HEAD, LIMPIAS_HEAD, LIMPIAS_POR_MES, LIMPIAS_POR_PAGO, LIMPIAS_POR_PRODUCTO, LIMPIAS_POR_SUCURSAL,
  POR_CATEGORIA, POR_PRODUCTO, SUCIAS_HEAD, VENTAS_HEAD,
} from './datasets';

export const n = (x: number) => x.toLocaleString('es-AR');
export const mb = (x: number) => (x > 0 && x < .01 ? `${n(Math.round(x * 1048576))} bytes` : `${x.toLocaleString('es-AR', { maximumFractionDigits: 2 })} MB`);

export const VENTAS_COLS = ['fecha', 'sucursal', 'producto', 'cantidad', 'precio'];
export const SUCIAS_COLS = ['ticket', 'fecha', 'sucursal', 'producto', 'cantidad', 'precio', 'medio_pago'];
export const LIMPIAS_COLS = ['ticket', 'fecha', 'sucursal', 'producto', 'cantidad', 'precio', 'importe', 'medio_pago'];
export const PRODUCTOS_ROWS = [['yerba', 'infusiones', 2500], ['cafe', 'infusiones', 6500], ['mate', 'accesorios', 8000], ['bombilla', 'accesorios', 3000], ['termo', 'accesorios', 35000], ['azucar', 'almacen', 1200], ['galletitas', 'almacen', 1800], ['facturas', 'panaderia', 900]];
/* datos/ejemplos/texto.txt, entero */
export const TEXTO = ['el big data no es magia', 'hadoop guarda los datos en bloques', 'spark procesa los datos en memoria', 'hive traduce sql a trabajos sobre los datos'];

/** Resúmenes de ventas_limpias por columna (etl_pandas.py los imprime al final) */
export const POR: Record<string, { label: string; columns: string[]; rows: (string | number | null)[][] }> = {
  sucursal: { label: 'Por sucursal', columns: ['sucursal', 'filas', 'facturado'], rows: LIMPIAS_POR_SUCURSAL },
  producto: { label: 'Por producto', columns: ['producto', 'unidades', 'facturado'], rows: LIMPIAS_POR_PRODUCTO },
  mes: { label: 'Por mes', columns: ['mes', 'facturado'], rows: LIMPIAS_POR_MES },
  pago: { label: 'Por medio de pago', columns: ['medio_pago', 'filas', 'facturado'], rows: LIMPIAS_POR_PAGO },
};

const sample = (columns: string[], rows: (string | number | null)[][], total: number, format: string, note?: string): DataSample => ({ columns, rows, total, format, note });

/** Las primeras filas de lo que hay en una ruta de HDFS (lo que mostraría hdfs dfs -cat | head) */
export function previewFor(path: string): DataSample {
  if (path.startsWith('/user/root/ventas/')) return sample(VENTAS_COLS, VENTAS_HEAD, 200000, 'csv');
  if (path === '/user/root/ml/ventas_sucias.csv') return sample(SUCIAS_COLS, SUCIAS_HEAD, 103000, 'csv', 'Fechas en tres formatos, productos en mayúsculas, precios con coma y medios de pago escritos de varias formas');
  if (path.startsWith('/user/root/ml/ventas_limpias')) return sample(LIMPIAS_COLS, LIMPIAS_HEAD, 97200, 'parquet');
  if (path === '/user/root/ml/clientes_senal.csv') return sample(CLIENTES_COLS, CLIENTES_HEAD, 20000, 'csv');
  if (path === '/user/root/numeros.txt') return sample(['línea'], [[1], [2], [3], [4], [5]], 1000000, 'texto', 'seq 1 1000000');
  if (path === '/user/root/texto.txt') return sample(['línea'], TEXTO.map(t => [t]), TEXTO.length, 'texto');
  if (path.startsWith('/user/root/tienda/ventas/')) return sample(['id', ...VENTAS_COLS], VENTAS_HEAD.map((r, i) => [i + 1, ...r]), 200000, 'csv (sqoop)');
  if (path.startsWith('/user/root/tienda/productos/')) return sample(['producto', 'categoria', 'precio'], PRODUCTOS_ROWS, 8, 'csv (sqoop)');
  const m = /\/resultados\/(?:hive_|mr_|spark_|pandas_)?por_(\w+)/.exec(path);
  if (m) {
    const raw = !/\/resultados\/por_/.test(path);
    if (raw && m[1] === 'producto') return sample(['producto', 'unidades', 'facturado'], POR_PRODUCTO, 8, 'csv');
    if (raw && m[1] === 'categoria') return sample(['categoria', 'unidades', 'facturado'], POR_CATEGORIA, 4, 'csv');
    const p = POR[m[1]]; if (p) return sample(p.columns, p.rows, p.rows.length, 'csv');
  }
  return { columns: [], rows: [], note: path.startsWith('/apps/') ? 'Archivo binario: librerías que YARN reparte a cada contenedor' : 'Sin vista previa en el modo demo' };
}

/** HDFS tiene que estar respondiendo */
export function needHdfs(e: DemoEngine) {
  if (e.phase !== 'running') fail('cluster_stopped', 'El cluster está apagado: arrancalo desde Cluster');
  if (e.hdfsDown) fail('service_down', 'HDFS no responde: no hay ningún NameNode activo');
}
/** Un proceso tiene que estar arriba (hiveserver2, mysql, mongodb, rm…) */
export function needProc(e: DemoEngine, id: string, name: string) {
  if (e.phase !== 'running') fail('cluster_stopped', 'El cluster está apagado: arrancalo desde Cluster');
  const p = e.procs.get(id);
  if (!p) fail('unsupported', `${name} no está en esta configuración`);
  if (p.state !== 'up') fail('service_down', `${name} está apagado`);
}
export const procUp = (e: DemoEngine, id: string) => e.phase === 'running' && e.procs.get(id)?.state === 'up';

export function trace(command: string, input: string, action: string, output: string, o: { engine?: Engine; before?: DataSample; after?: DataSample; appIds?: string[] } = {}): ActionTrace {
  return { command, input, action, output, ...o };
}

/** Carpeta padre de una ruta */
export const parentOf = (p: string) => (p === '/' ? null : p.slice(0, p.lastIndexOf('/')) || '/');
export const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1) || '/';
