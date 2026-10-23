/* Plantillas de trabajos: el formulario de "Nuevo trabajo" valida cada parámetro igual que el
   servidor (server/sandbox_server/yarn.py) y arma el comando equivalente mientras escribís. */
import type { JobParam, JobTemplate } from '../api/types';

export type JobValue = string | number | boolean;
export type JobValues = Record<string, JobValue>;

export const TEXTO = '/user/root/texto.txt';
export const GREP_PATTERN = String.raw`^[\w\s.\-\[\]\\]{1,64}$`;
export const EXAMPLES_JAR = 'hadoop-mapreduce-examples-3.3.6.jar';
export const SPARK_JAR = 'spark-examples_2.12-3.5.9.jar';
/** Carpetas que el arranque crea y que una salida no puede pisar */
export const PROTECTED = ['/', '/tmp', '/user', '/user/root', '/user/hive', '/user/hive/warehouse', '/apps', '/apps/tez', '/apps/spark', '/spark-logs'];

const p = (name: string, label: string, type: JobParam['type'], def: JobValue, help: string, kw: Partial<JobParam> = {}): JobParam =>
  ({ name, label, type, default: def, help, required: true, ...kw });
const OVERWRITE: JobParam = { name: 'overwrite', label: 'Pisar la salida si ya existe', type: 'bool', default: true, help: 'MapReduce no escribe sobre una carpeta que ya existe: si está tildado, se borra antes' };

/** Las mismas plantillas que GET /api/yarn/templates (el modo demo las usa tal cual) */
export const TEMPLATES: JobTemplate[] = [
  {
    id: 'mr-wordcount', label: 'Contar palabras (wordcount)', engine: 'mr',
    description: 'El clásico de MapReduce: cada mapper parte su bloque en palabras y emite (palabra, 1); los reducers suman. La salida es una línea por palabra con su cantidad.',
    params: [p('in', 'Entrada', 'hdfs-path', TEXTO, 'Archivo o carpeta de texto en HDFS'), p('out', 'Salida', 'hdfs-path', '/user/root/resultados/wordcount', 'Carpeta nueva en HDFS donde quedan los part-r-*'), OVERWRITE],
    command: `hadoop jar ${EXAMPLES_JAR} wordcount {in} {out}`, needs: ['yarn'],
  },
  {
    id: 'mr-pi', label: 'Estimar π (pi)', engine: 'mr',
    description: 'Monte Carlo: cada map tira puntos al azar en un cuadrado y cuenta cuántos caen en el círculo; el reducer junta todo. No lee nada de HDFS: sirve para ver contenedores y memoria.',
    params: [p('maps', 'Mappers', 'int', 4, 'Cuántos maps (contenedores) en paralelo', { min: 1, max: 16 }), p('samples', 'Muestras por map', 'int', 1000, 'Más muestras, más precisión y más tiempo', { min: 10, max: 100000 })],
    command: `hadoop jar ${EXAMPLES_JAR} pi {maps} {samples}`, needs: ['yarn'],
  },
  {
    id: 'mr-grep', label: 'Buscar un patrón (grep)', engine: 'mr',
    description: 'Dos trabajos encadenados: el primero cuenta las coincidencias de la expresión regular, el segundo las ordena de más a menos frecuente.',
    params: [p('in', 'Entrada', 'hdfs-path', TEXTO, 'Archivo o carpeta de texto en HDFS'), p('out', 'Salida', 'hdfs-path', '/user/root/resultados/grep', 'Carpeta nueva en HDFS'),
      p('regex', 'Expresión regular', 'text', 'datos', 'Letras, números, espacios y . - [ ] \\ (hasta 64)', { pattern: GREP_PATTERN }), OVERWRITE],
    command: `hadoop jar ${EXAMPLES_JAR} grep {in} {out} {regex}`, needs: ['yarn'],
  },
  {
    id: 'mr-ventas', label: 'Ventas por producto (MapReduce)', engine: 'mr',
    description: 'Hadoop Streaming con mapper.py y reducer.py sobre /user/root/ventas (lo sube si falta).',
    params: [], command: 'hadoop jar hadoop-streaming-3.3.6.jar -mapper mapper.py -reducer reducer.py -input /user/root/ventas -output /user/root/resultados/mr_por_producto', needs: ['yarn'],
  },
  {
    id: 'hive-ventas', label: 'Ventas por producto (Hive sobre Tez)', engine: 'tez',
    description: 'ventas.hql en beeline: HiveServer2 compila el SQL a un DAG de Tez.',
    params: [], command: 'beeline -u jdbc:hive2://localhost:10000 -f ejemplos/ventas.hql', needs: ['yarn', 'hiveserver2'],
  },
  {
    id: 'spark-pi', label: 'Estimar π (SparkPi)', engine: 'spark',
    description: 'El ejemplo de Spark: reparte las muestras en particiones (una tarea por partición) entre los executors.',
    params: [p('partitions', 'Particiones', 'int', 2, 'Tareas en paralelo', { min: 1, max: 16 })],
    command: `spark-submit --class org.apache.spark.examples.SparkPi ${SPARK_JAR} {partitions}`, needs: ['yarn'],
  },
  {
    id: 'spark-ventas', label: 'Ventas por producto (Spark)', engine: 'spark',
    description: 'ventas.py con spark-submit: lee /user/root/ventas y agrupa con DataFrames.',
    params: [], command: 'spark-submit ejemplos/ventas.py', needs: ['yarn'],
  },
];

/** Ruta de HDFS normalizada como hdfs.clean() del servidor: absoluta, sin barras repetidas ni . / .. */
export function cleanPath(raw: string): string {
  const m = /^hdfs:\/\/[^/]*(\/.*)?$/.exec(raw.trim());
  const parts: string[] = [];
  for (const s of (m ? m[1] || '/' : raw.trim()).split('/')) {
    if (!s || s === '.') continue;
    if (s === '..') parts.pop(); else parts.push(s);
  }
  return '/' + parts.join('/');
}
export const inside = (path: string, dir: string) => dir === '/' || path === dir || path.startsWith(dir + '/');

/** Los valores iniciales del formulario: los default de cada parámetro */
export const initialValues = (t: JobTemplate): JobValues => Object.fromEntries(t.params.map(x => [x.name, x.default]));

/** Qué está mal en un valor (o null si está bien). Mismas reglas que validate_params del servidor */
export function paramError(prm: JobParam, raw: JobValue | undefined): string | null {
  const v = raw === undefined || raw === '' ? prm.default : raw;
  if (prm.type === 'int') {
    const s = String(v).trim();
    if (!/^-?\d+$/.test(s)) return `${prm.label} tiene que ser un número entero`;
    const k = Number(s);
    if ((prm.min != null && k < prm.min) || (prm.max != null && k > prm.max)) return `${prm.label} va de ${prm.min} a ${prm.max}`;
    return null;
  }
  if (prm.type === 'bool') return null;
  if (prm.type === 'select') return prm.options?.some(o => o.value === String(v)) ? null : `${prm.label}: opción desconocida`;
  const s = String(v);
  if (prm.type === 'hdfs-path') return !s.trim() ? `Falta ${prm.label.toLowerCase()}` : /[\0\n\r:]/.test(s.replace(/^hdfs:\/\/[^/]*/, '')) ? `${prm.label}: ruta de HDFS inválida` : null;
  // \w de Python también acepta letras con tilde y ñ
  if (prm.pattern && !new RegExp(prm.pattern.replace(/\\w/g, '\\p{L}\\p{N}_'), 'u').test(s)) return `${prm.label} solo admite ${(prm.help ?? '').replace(/^\p{Lu}/u, c => c.toLowerCase())}`;
  if (s.startsWith('-') || /[\0\n\r]/.test(s)) return `${prm.label} no puede empezar con - ni tener saltos de línea`;
  return null;
}

/** Errores de todo el formulario, por nombre de parámetro (incluye la regla de entrada y salida) */
export function formErrors(t: JobTemplate, values: JobValues): Record<string, string> {
  const out: Record<string, string> = {};
  t.params.forEach(x => { const e = paramError(x, values[x.name]); if (e) out[x.name] = e; });
  const has = (k: string) => t.params.some(x => x.name === k);
  const val = (k: string) => { const v = values[k]; return String(v === undefined || v === '' ? t.params.find(x => x.name === k)!.default : v); };
  if (has('out') && !out.out) {
    const dst = cleanPath(val('out'));
    if (!(dst.startsWith('/user/') || dst.startsWith('/tmp/')) || PROTECTED.includes(dst)) out.out = `La salida va en una carpeta nueva adentro de /user o /tmp (no ${dst})`;
    else if (has('in') && !out.in) {
      const src = cleanPath(val('in'));
      if (src === dst || inside(src, dst) || inside(dst, src)) out.out = 'La salida no puede ser la entrada ni estar adentro de ella';
    }
  }
  return out;
}

/** Comillas como shlex.quote: solo si hace falta */
export function quote(s: string): string {
  if (s === '') return "''";
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'"'"'`)}'`;
}

/** El comando con los valores puestos (las rutas normalizadas), tal cual lo va a mostrar la consola */
export function fillCommand(t: JobTemplate, values: JobValues): string {
  return t.command.replace(/\{(\w+)\}/g, (all, name: string) => {
    const prm = t.params.find(x => x.name === name);
    if (!prm) return all;
    const v = values[name] === undefined || values[name] === '' ? prm.default : values[name];
    return quote(prm.type === 'hdfs-path' ? cleanPath(String(v)) : String(v).trim());
  });
}

/** Lo que se manda a POST /api/yarn/apps: enteros como número, rutas normalizadas */
export function toParams(t: JobTemplate, values: JobValues): JobValues {
  return Object.fromEntries(t.params.map(x => {
    const v = values[x.name] === undefined || values[x.name] === '' ? x.default : values[x.name];
    return [x.name, x.type === 'int' ? Number(String(v).trim()) : x.type === 'hdfs-path' ? cleanPath(String(v)) : v];
  }));
}
