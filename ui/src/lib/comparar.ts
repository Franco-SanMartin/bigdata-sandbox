/* La misma cuenta (ventas por producto) escrita con cada herramienta. El código sale de los archivos
   de datos/ejemplos, los mismos que la imagen copia a /datos/ejemplos: la pantalla muestra
   exactamente lo que se corre. De cada archivo se marca el núcleo (lo que hace la cuenta) para
   contar cuántas líneas lleva en cada herramienta. */
import mapper from '../../../datos/ejemplos/mapper.py?raw';
import reducer from '../../../datos/ejemplos/reducer.py?raw';
import pig from '../../../datos/ejemplos/ventas.pig?raw';
import hql from '../../../datos/ejemplos/ventas.hql?raw';
import py from '../../../datos/ejemplos/ventas.py?raw';
import type { AppType, ExampleJob, YarnApp, YarnMetrics } from '../api/types';
import type { ToolId } from './ecosistema';
import { nf } from './format';

/** Las líneas desde la primera que cumple `desde` hasta la primera (después) que cumple `hasta`.
    Si el archivo cambió y no aparece la marca, devuelve el archivo entero (lo avisa la prueba) */
export function nucleo(texto: string, desde: RegExp, hasta?: RegExp): string {
  const ls = texto.replace(/\r\n/g, '\n').split('\n');
  const i = ls.findIndex(l => desde.test(l));
  if (i < 0) return texto.trim();
  const j = hasta ? ls.findIndex((l, k) => k > i && hasta.test(l)) : -1;
  return ls.slice(i, j < 0 ? ls.length : j + 1).join('\n').trim();
}

/** Líneas que hacen algo: sin las vacías ni los comentarios */
export const lineasDeCodigo = (texto: string, comentario: string) =>
  texto.split('\n').filter(l => l.trim() && !l.trim().startsWith(comentario)).length;

export interface Archivo { nombre: string; texto: string; nucleo: string; lineas: number }
const archivo = (nombre: string, texto: string, comentario: string, desde: RegExp, hasta?: RegExp): Archivo => {
  const n = nucleo(texto, desde, hasta);
  return { nombre, texto: texto.replace(/\r\n/g, '\n').trim(), nucleo: n, lineas: lineasDeCodigo(n, comentario) };
};

export interface Variante {
  id: ToolId;
  nombre: string;
  /** Cómo se escribe, en una línea */
  estilo: string;
  motor: AppType;
  archivos: Archivo[];
  /** Lo que se escribe en la terminal (parado en /datos) */
  cmd: string;
  /** La plantilla de YARN que lo lanza desde la interfaz (Pig no tiene: va por Lenguajes) */
  plantilla?: ExampleJob;
  salida: string;
  /** Las fases que arma el motor; disco: el resultado intermedio pasa por HDFS */
  fases: { t: string; disco?: boolean }[];
  faseNota: string;
  nota: string;
  /** Cómo reconocer su trabajo en la lista de YARN */
  esSuya: (a: YarnApp) => boolean;
}

export const RESULTADOS = '/user/root/resultados';

export const VARIANTES: Variante[] = [
  {
    id: 'streaming', nombre: 'MapReduce a mano', estilo: 'Escribís vos el map y el reduce, en Python', motor: 'MAPREDUCE',
    archivos: [
      archivo('mapper.py', mapper, '#', /^import sys/),
      archivo('reducer.py', reducer, '#', /^import sys/),
    ],
    cmd: `hdfs dfs -rm -r -f ${RESULTADOS}/mr_por_producto\nhadoop jar $HADOOP_HOME/share/hadoop/tools/lib/hadoop-streaming-*.jar \\\n  -files ejemplos/mapper.py,ejemplos/reducer.py \\\n  -mapper "python3 mapper.py" -reducer "python3 reducer.py" \\\n  -input /user/root/ventas -output ${RESULTADOS}/mr_por_producto`,
    plantilla: 'mr-ventas', salida: `${RESULTADOS}/mr_por_producto`,
    fases: [{ t: 'map' }, { t: 'shuffle' }, { t: 'reduce' }],
    faseNota: 'Un trabajo: un map por bloque, el shuffle ordena y agrupa por producto y el reduce suma.',
    nota: 'No ordena por facturación: para eso haría falta un segundo trabajo entero.',
    esSuya: a => a.type === 'MAPREDUCE' && /streamjob|mapper\.py/i.test(a.name),
  },
  {
    id: 'pig', nombre: 'Pig Latin', estilo: 'Describís los pasos y Pig escribe el map y el reduce por vos', motor: 'MAPREDUCE',
    archivos: [archivo('ventas.pig', pig, '--', /^ventas = LOAD/, /^STORE /)],
    cmd: 'pig ejemplos/ventas.pig', salida: `${RESULTADOS}/pig_por_producto`,
    fases: [{ t: 'GROUP' }, { t: 'HDFS', disco: true }, { t: 'ORDER' }],
    faseNota: 'Varios trabajos MapReduce en fila: entre uno y otro, el resultado se escribe en HDFS.',
    nota: 'Nada corre hasta el STORE: recién ahí Pig arma el plan entero.',
    esSuya: a => a.type === 'MAPREDUCE' && /PigLatin:ventas\.pig/i.test(a.name),
  },
  {
    id: 'hive', nombre: 'HiveQL', estilo: 'SQL: decís qué querés y Hive arma el plan', motor: 'TEZ',
    archivos: [archivo('ventas.hql', hql, '--', /^CREATE EXTERNAL TABLE/, /^ORDER BY facturado DESC;/)],
    cmd: 'beeline -u jdbc:hive2://localhost:10000 -f ejemplos/ventas.hql',
    plantilla: 'hive-ventas', salida: `${RESULTADOS}/hive_por_producto`,
    fases: [{ t: 'Map 1' }, { t: 'Reducer 2' }, { t: 'Reducer 3' }],
    faseNota: 'Un solo DAG de Tez: agrupa y ordena sin escribir en HDFS en el medio.',
    nota: 'Casi todo es crear la tabla, y eso se hace una sola vez: queda en el Metastore y Spark SQL la lee igual.',
    esSuya: a => a.type === 'TEZ' && /^HIVE/i.test(a.name),
  },
  {
    id: 'pyspark', nombre: 'PySpark', estilo: 'Código Python que encadena operaciones sobre DataFrames', motor: 'SPARK',
    archivos: [archivo('ventas.py', py, '#', /^from pyspark/, /^\)\s*$/)],
    cmd: 'spark-submit ejemplos/ventas.py',
    plantilla: 'spark-ventas', salida: `${RESULTADOS}/spark_por_producto`,
    fases: [{ t: 'leer' }, { t: 'sumar' }, { t: 'ordenar' }],
    faseNota: 'Etapas en memoria separadas por shuffles; los executors viven mientras dura el programa.',
    nota: 'Nada corre hasta una acción (show, write): recién ahí Spark arma el plan.',
    esSuya: a => a.type === 'SPARK' && /ventas por producto/i.test(a.name),
  },
];

export const MOTOR: Record<AppType, { nombre: string; eng: 'mr' | 'tez' | 'spark' }> = {
  MAPREDUCE: { nombre: 'MapReduce', eng: 'mr' },
  TEZ: { nombre: 'Tez', eng: 'tez' },
  SPARK: { nombre: 'Spark', eng: 'spark' },
};

/** Antes de las cuatro: los datos, una sola vez en HDFS */
export const DATOS = {
  carpeta: '/user/root/ventas',
  cmd: 'hdfs dfs -mkdir -p /user/root/ventas\nhdfs dfs -put -f ejemplos/ventas.csv /user/root/ventas/',
};

/** Después: las cuatro tienen que dar lo mismo (cada una separa con otra cosa y ordena distinto) */
export const VERIFICAR = `for h in mr pig hive spark; do\n  echo "== $h"\n  hdfs dfs -cat "${RESULTADOS}/\${h}_por_producto/*" | tr '\\t' ',' | grep -v '^producto' | sort\ndone`;

/** El trabajo más nuevo de cada variante en la lista de YARN */
export function ultimas(apps: YarnApp[]): Partial<Record<ToolId, YarnApp>> {
  const out: Partial<Record<ToolId, YarnApp>> = {};
  for (const v of VARIANTES) {
    const suyas = apps.filter(v.esSuya).sort((a, b) => b.submittedAt - a.submittedAt);
    if (suyas[0]) out[v.id] = suyas[0];
  }
  return out;
}

/** Cuánto tardó (o lleva) un trabajo, en milisegundos */
export const duracion = (a: YarnApp, now: number) => Math.max(0, (a.finishedAt ?? now) - (a.startedAt ?? a.submittedAt));

/** Los trabajos de la última corrida de cada versión. Pig manda uno atrás del otro (agrupar, muestrear
    para ordenar, ordenar): son de la misma corrida si cada uno arrancó a menos de 30 s de que terminó el anterior */
export function ultimaCorrida(apps: YarnApp[]): Partial<Record<ToolId, YarnApp[]>> {
  const out: Partial<Record<ToolId, YarnApp[]>> = {};
  for (const v of VARIANTES) {
    const suyas = apps.filter(v.esSuya).sort((a, b) => b.submittedAt - a.submittedAt);
    if (!suyas.length) continue;
    const run = [suyas[0]];
    if (v.id === 'pig') {
      for (const a of suyas.slice(1)) {
        if (a.finishedAt == null || run[run.length - 1].submittedAt - a.finishedAt > 30_000) break;
        run.push(a);
      }
    }
    out[v.id] = run.reverse();
  }
  return out;
}

/** Cuánto tardó (o lleva) una corrida: del primer trabajo al último */
export const duracionCorrida = (run: YarnApp[], now: number) =>
  Math.max(0, (run[run.length - 1].finishedAt ?? now) - (run[0].startedAt ?? run[0].submittedAt));

/** Lo que movió una corrida entera (la suma de sus trabajos). Lo que falta en alguno, falta en la suma */
export interface Movido { trabajos: number; ms: number; mbSeconds: number; leido?: number; escrito?: number; shuffle?: number; discoLocal?: number; tareas?: number }

export function sumar(ms: YarnMetrics[]): Movido | undefined {
  const ok = ms.filter(m => !m.error && m.state === 'FINISHED');
  if (!ok.length || ok.length < ms.length) return undefined;
  const tot = (k: keyof YarnMetrics) => (ok.every(m => typeof m[k] === 'number') ? ok.reduce((x, m) => x + (m[k] as number), 0) : undefined);
  return { trabajos: ok.length, ms: tot('elapsedMs') ?? 0, mbSeconds: tot('mbSeconds') ?? 0, leido: tot('hdfsReadBytes'),
    escrito: tot('hdfsWrittenBytes'), shuffle: tot('shuffleBytes'), discoLocal: tot('localDiskBytes'), tareas: tot('tasks') };
}

const mb = (b: number) => (b < 1024 * 1024 ? `${nf(b / 1024, b < 10240 ? 1 : 0)} KB` : `${nf(b / 1048576, 1)} MB`);
export const bytesLabel = (b: number) => (b < 1024 ? `${nf(b)} bytes` : mb(b));

/** Lo que dicen los números, en palabras: solo lo que se puede afirmar con lo que hay */
export function observaciones(m: Partial<Record<ToolId, Movido>>): string[] {
  const out: string[] = [];
  const s = m.streaming, sp = m.pyspark, pg = m.pig;
  if (s?.shuffle != null && sp?.shuffle != null && s.shuffle > sp.shuffle * 10) {
    out.push(`MapReduce a mano mandó ${bytesLabel(s.shuffle)} por el shuffle y PySpark ${bytesLabel(sp.shuffle)}: mapper.py emite una línea por venta, y Spark suma por producto en cada partición antes de mandar.`);
  }
  // La entrada es lo que leyó la versión que la recorre una sola vez (MapReduce a mano)
  const entrada = s?.leido;
  if (entrada && sp?.leido && sp.leido > entrada * 1.8) {
    out.push(`PySpark leyó ${bytesLabel(sp.leido)} de HDFS, ${nf(sp.leido / entrada, 1)} veces la entrada: inferSchema la recorre entera para adivinar los tipos y cada acción (show, write) la vuelve a leer, porque no hay cache().`);
  }
  if (s?.discoLocal != null && sp?.discoLocal != null && s.discoLocal > sp.discoLocal * 10) {
    out.push(`MapReduce escribió ${bytesLabel(s.discoLocal)} en el disco local de los nodos (los spills del map y la mezcla del reduce); PySpark, ${bytesLabel(sp.discoLocal)}.`);
  }
  if (pg && pg.trabajos > 1) out.push(`Pig lanzó ${pg.trabajos} trabajos MapReduce para un solo script: uno agrupa y suma, y ORDER BY necesita otros (muestrear las claves y ordenar).`);
  return out;
}
