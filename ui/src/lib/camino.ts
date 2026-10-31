/* La franja de camino de datos (REDISENO-FULL.md §4): de dónde vienen los datos, qué los procesa y con
   qué motor, y dónde quedan. Cada tramo dice su capa (el color del mapa), adónde lleva y qué término del
   glosario lo explica. Funciones puras: las usan el detalle de un trabajo y el resultado de una consulta. */
import type { DataSource, QueryResult, YarnAppDetail } from '../api/types';
import type { CapaId } from './ecosistema';
import type { PageId } from './route';
import { nf } from './format';

export interface Tramo { k: string; v: string; sub?: string; capa: CapaId; ir?: { page: PageId; arg?: string }; glosario?: string }
export interface Camino { de: Tramo; proc: Tramo; queda: Tramo }

const MOTOR = { mr: ['MapReduce', 'mapreduce'], tez: ['Tez', 'tez'], spark: ['Spark', 'spark'] } as const;
const sinBarra = (p: string) => p.replace(/^\/+/, '');

/** Un trabajo de YARN: lo que leyó (trace.input), el motor que lo corrió y la carpeta del resultado */
export function caminoDeTrabajo(a: YarnAppDetail): Camino {
  const ruta = /^(\/[^\s·]+)/.exec(a.trace.input)?.[1];
  const [motor, glo] = a.engine === 'mr' || a.engine === 'tez' || a.engine === 'spark' ? MOTOR[a.engine] : ['YARN', 'yarn'];
  const pasos = a.dag.vertices.length;
  const unidad = a.engine === 'tez' ? 'vértices' : a.engine === 'spark' ? 'etapas' : 'fases';
  return {
    de: ruta
      ? { k: 'De dónde', v: ruta, sub: a.trace.input.slice(ruta.length).replace(/^\s*·\s*/, '') || 'en HDFS', capa: 'datos', ir: { page: 'hdfs', arg: sinBarra(ruta) }, glosario: 'hdfs' }
      : { k: 'De dónde', v: a.trace.input || '—', capa: 'datos' },
    proc: { k: 'Qué lo procesa', v: `${motor} en YARN`, sub: `${a.type}${pasos ? ` · ${pasos} ${unidad}` : ''}`, capa: 'motores', ir: { page: 'motores' }, glosario: glo },
    queda: a.outputPath
      ? { k: 'Dónde queda', v: a.outputPath, sub: a.state === 'FINISHED' ? 'en HDFS' : 'cuando termine', capa: 'datos', ir: { page: 'hdfs', arg: sinBarra(a.outputPath) }, glosario: 'hdfs' }
      : { k: 'Dónde queda', v: a.state === 'FINISHED' ? 'En la salida del comando' : 'Todavía corre', sub: 'no escribe en HDFS', capa: 'datos' },
  };
}

/** Una consulta en Lenguajes o Bases: la tabla (o carpeta) que lee, quién la resolvió y adónde va lo que da */
export function caminoDeConsulta(source: DataSource, texto: string, res: Pick<QueryResult, 'engine' | 'appId' | 'rows'>): Camino {
  const t = texto.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim();
  const desde = /\bfrom\s+([\w.]+)/i.exec(t)?.[1];
  const carpeta = /\bload\s+'([^']+)'/i.exec(t)?.[1];
  const coleccion = /\bdb\.(\w+)\./.exec(t)?.[1];
  const tabla = desde?.replace(/^default\./, '');

  const de: Tramo = source === 'pig'
    ? carpeta ? { k: 'De dónde', v: carpeta, sub: 'carpeta de HDFS (Pig no usa el Metastore)', capa: 'datos', ir: { page: 'hdfs', arg: sinBarra(carpeta) }, glosario: 'hdfs' } : { k: 'De dónde', v: 'HDFS', capa: 'datos', glosario: 'hdfs' }
    : source === 'hive'
      ? tabla ? { k: 'De dónde', v: tabla, sub: 'tabla del Metastore, archivos en HDFS', capa: 'datos', ir: { page: 'tablas', arg: tabla }, glosario: 'metastore' } : { k: 'De dónde', v: 'Hive', capa: 'datos' }
      : source === 'mysql'
        ? { k: 'De dónde', v: tabla ? `tienda.${tabla.replace(/^tienda\./, '')}` : 'la base tienda', sub: 'MariaDB, en su disco', capa: 'datos', glosario: 'mariadb' }
        : { k: 'De dónde', v: coleccion ? `tienda.${coleccion}` : 'la base tienda', sub: 'MongoDB, en su disco', capa: 'datos', glosario: 'mongodb' };

  const proc: Tramo = source === 'pig'
    ? { k: 'Qué lo procesa', v: 'Pig → MapReduce en YARN', sub: res.appId ?? 'uno o más trabajos', capa: 'motores', ir: res.appId ? { page: 'yarn', arg: res.appId } : { page: 'motores' }, glosario: 'pig' }
    : source === 'hive'
      ? res.engine === 'tez'
        ? { k: 'Qué lo procesa', v: 'Hive → Tez en YARN', sub: res.appId ?? 'un DAG', capa: 'motores', ir: res.appId ? { page: 'yarn', arg: res.appId } : { page: 'motores' }, glosario: 'tez' }
        : { k: 'Qué lo procesa', v: 'HiveServer2, sin YARN', sub: 'lee los archivos directo', capa: 'motores', glosario: 'hive' }
      : { k: 'Qué lo procesa', v: source === 'mysql' ? 'MariaDB' : 'MongoDB', sub: 'una sola máquina, sin YARN', capa: 'maquina', glosario: source === 'mysql' ? 'mariadb' : 'mongodb' };

  const destino = /\binsert\s+(?:overwrite|into)\s+(?:table\s+)?([\w.]+)/i.exec(t)?.[1] ?? /\bcreate\s+(?:external\s+)?table\s+(?:if\s+not\s+exists\s+)?([\w.]+)/i.exec(t)?.[1];
  const store = /\bstore\s+\w+\s+into\s+'([^']+)'/i.exec(t)?.[1];
  const queda: Tramo = store
    ? { k: 'Dónde queda', v: store, sub: 'en HDFS', capa: 'datos', ir: { page: 'hdfs', arg: sinBarra(store) }, glosario: 'hdfs' }
    : destino && source === 'hive'
      ? { k: 'Dónde queda', v: destino.replace(/^default\./, ''), sub: 'tabla del Metastore', capa: 'datos', ir: { page: 'tablas', arg: destino.replace(/^default\./, '') }, glosario: 'metastore' }
      : destino
        ? { k: 'Dónde queda', v: destino, sub: 'en la base', capa: 'datos' }
        : { k: 'Dónde queda', v: 'En pantalla', sub: `${nf(res.rows.length)} ${res.rows.length === 1 ? 'fila' : 'filas'} · no se guarda`, capa: 'puertas' };
  return { de, proc, queda };
}
