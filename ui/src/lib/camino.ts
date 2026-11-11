/* La franja de camino de datos: de dónde vienen los datos, qué los procesa y con
   qué motor, y dónde quedan. Cada tramo dice su capa (el color del mapa), adónde lleva y qué término del
   glosario lo explica. Funciones puras: las usan el detalle de un trabajo y el resultado de una consulta. */
import type { DataSource, ModelRun, QueryResult, StepRun, YarnAppDetail } from '../api/types';
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

/** Lo que entra o sale, dicho como un tramo: una ruta de HDFS lleva al explorador; lo demás (una tabla de MariaDB,
    un archivo local) queda como texto */
function lugar(k: string, texto: string | undefined, vacio: string): Tramo {
  const ruta = texto ? /^(\/[^\s·,]+)/.exec(texto)?.[1] : undefined;
  const resto = ruta ? texto!.slice(ruta.length).replace(/^\s*[·,]\s*/, '') : '';
  // /datos es la carpeta de la compu montada en el contenedor: un archivo local, todavía fuera de HDFS
  if (ruta?.startsWith('/datos/')) return { k, v: ruta, sub: resto || 'en el disco, fuera de HDFS', capa: 'maquina', glosario: 'subir-archivos-put' };
  if (ruta) return { k, v: ruta, sub: resto || 'en HDFS', capa: 'datos', ir: { page: 'hdfs', arg: sinBarra(ruta) }, glosario: 'hdfs' };
  return { k, v: texto || vacio, capa: 'datos' };
}

const GLO_MOTOR: Partial<Record<string, string>> = { mr: 'mapreduce', tez: 'tez', spark: 'spark', hdfs: 'hdfs' };
const NOMBRE_MOTOR: Record<string, string> = { mr: 'MapReduce en YARN', tez: 'Tez en YARN', spark: 'Spark en YARN', uno: 'una sola máquina, sin YARN', hdfs: 'el cliente de HDFS' };

/** Un paso del pipeline: lo que leyó, la herramienta y su motor, y lo que dejó */
export function caminoDePaso(run: Pick<StepRun, 'tool' | 'engine' | 'appIds' | 'output' | 'trace'>, herramienta: string): Camino {
  const app = run.appIds[0];
  return {
    de: lugar('De dónde', run.trace?.input, 'la etapa anterior'),
    proc: { k: 'Qué lo procesa', v: herramienta, sub: `${NOMBRE_MOTOR[run.engine] ?? run.engine}${app ? ` · ${app}` : ''}`,
      capa: run.engine === 'uno' ? 'maquina' : 'motores', ir: app ? { page: 'yarn', arg: app } : run.engine === 'uno' ? undefined : { page: 'motores' },
      glosario: GLO_MOTOR[run.engine] ?? (/sqoop/i.test(run.tool) ? 'sqoop' : undefined) },
    queda: lugar('Dónde queda', run.output?.path ?? run.trace?.output, 'todavía no dejó nada'),
  };
}

/** Un entrenamiento de ML: los datos, la librería y dónde corre, y el modelo que queda (nombre: el que ve la pantalla) */
export function caminoDeModelo(run: Pick<ModelRun, 'engine' | 'appId' | 'dataset' | 'model' | 'trace'>, nombre?: string): Camino {
  const mllib = run.engine === 'mllib';
  return {
    // dataset es el nombre del conjunto (senal, ventas…), no una ruta
    de: { k: 'De dónde', v: run.dataset ?? 'los datos elegidos', sub: 'el conjunto de entrenamiento', capa: 'datos' },
    proc: mllib
      ? { k: 'Qué lo entrena', v: 'Spark MLlib en YARN', sub: run.appId ?? 'repartido entre executors', capa: 'motores', ir: run.appId ? { page: 'yarn', arg: run.appId } : { page: 'motores' }, glosario: 'mllib' }
      : { k: 'Qué lo entrena', v: 'scikit-learn', sub: 'una sola máquina, sin YARN', capa: 'maquina', glosario: 'scikit-learn' },
    queda: { k: 'Dónde queda', v: nombre ?? run.model, sub: 'el modelo, con sus métricas, en esta pantalla', capa: 'puertas' },
  };
}
