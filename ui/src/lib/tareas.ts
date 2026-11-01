/* Las otras tareas de Comparar (la tabla 5 de D-05): la misma cuenta con dos o tres herramientas, con el
   código real del repo (datos/ejemplos, y datos/comparar para lo que no estaba). Cada una dice qué mirar,
   qué hace falta antes, dónde corre cada variante y cómo se lanza (todas desde la terminal integrada). */
import tiendaHql from '../../../datos/ejemplos/tienda.hql?raw';
import ventasHql from '../../../datos/ejemplos/ventas.hql?raw';
import ventasPy from '../../../datos/ejemplos/ventas.py?raw';
import sqoopSh from '../../../datos/ejemplos/sqoop.sh?raw';
import etlPandas from '../../../datos/ejemplos/ml/etl_pandas.py?raw';
import etlSpark from '../../../datos/ejemplos/ml/etl_spark.py?raw';
import modSklearn from '../../../datos/ejemplos/ml/modelos_sklearn.py?raw';
import modSpark from '../../../datos/ejemplos/ml/modelos_spark.py?raw';
import catPig from '../../../datos/comparar/categoria.pig?raw';
import catPy from '../../../datos/comparar/categoria.py?raw';
import jdbcPy from '../../../datos/comparar/jdbc.py?raw';
import type { Engine } from '../api/types';
import { archivo, lineasDeCodigo, type Archivo } from './comparar';
import type { PageId } from './route';

export interface VarianteTarea {
  nombre: string; motor: Engine; donde: 'en el cluster' | 'en una sola máquina';
  archivos: Archivo[]; cmd: string; nota: string;
}
export interface Tarea {
  id: string; titulo: string; corto: string;
  /** Qué cambia entre las variantes: lo que hay que mirar (la última columna de la tabla 5) */
  mirar: string;
  /** Lo que tiene que estar hecho antes */
  antes?: { texto: string; cmd?: string; ir?: { page: PageId; arg?: string; label: string } };
  variantes: VarianteTarea[];
  /** Una pantalla que la corre con un clic */
  ir?: { page: PageId; arg?: string; label: string };
}

/** Un tramo de un archivo que no tiene una línea propia donde empezar: desde la línea anterior a la que cumple `ancla` */
function tramo(nombre: string, texto: string, comentario: string, ancla: RegExp, hasta: RegExp): Archivo {
  const ls = texto.replace(/\r\n/g, '\n').split('\n');
  const i = Math.max(0, ls.findIndex(l => ancla.test(l)) - 1);
  const j = ls.findIndex((l, k) => k > i && hasta.test(l));
  const n = ls.slice(i, j < 0 ? ls.length : j + 1).join('\n').trim();
  return { nombre, texto: texto.replace(/\r\n/g, '\n').trim(), nucleo: n, lineas: lineasDeCodigo(n, comentario) };
}

const SQL_SUCURSAL = 'SELECT sucursal, COUNT(*) AS tickets, SUM(CAST(cantidad AS BIGINT) * precio) AS facturado FROM ventas GROUP BY sucursal ORDER BY facturado DESC';
const SQOOP_ANTES = { texto: 'Las tablas de la base tienda tienen que estar en HDFS: las trae Sqoop (la etapa 1 del Pipeline, o el script).', cmd: 'bash ejemplos/sqoop.sh', ir: { page: 'pipeline' as PageId, label: 'Ir al Pipeline' } };

export const TAREAS: Tarea[] = [
  {
    id: 'join', titulo: 'Unir dos tablas', corto: 'Facturación por categoría: las ventas unidas con los productos',
    mirar: 'Cuántos shuffles hay y cuánto viaja por la red. Pig une del lado del reduce: las ventas viajan agrupadas por producto. Hive y Spark ven que productos es chica (8 filas) y la mandan entera a cada tarea (map join, broadcast join): las ventas no se mueven para unirse.',
    antes: SQOOP_ANTES,
    variantes: [
      { nombre: 'HiveQL', motor: 'tez', donde: 'en el cluster', archivos: [archivo('tienda.hql', tiendaHql, '--', /^SELECT p\.categoria/, /^ORDER BY facturado DESC;/)],
        cmd: 'beeline -u jdbc:hive2://localhost:10000 -f ejemplos/tienda.hql', nota: 'Un JOIN de SQL; Hive lo convierte en un map join porque productos entra en memoria.' },
      { nombre: 'Pig Latin', motor: 'mr', donde: 'en el cluster', archivos: [archivo('categoria.pig', catPig, '--', /^ventas = LOAD/, /^STORE /)],
        cmd: 'pig ejemplos/comparar/categoria.pig', nota: 'JOIN del lado del reduce. Con USING \'replicated\' sería un map join, como el de Hive.' },
      { nombre: 'PySpark', motor: 'spark', donde: 'en el cluster', archivos: [archivo('categoria.py', catPy, '#', /^from pyspark/, /^resumen\.write/)],
        cmd: 'spark-submit ejemplos/comparar/categoria.py', nota: 'explain() muestra BroadcastHashJoin: productos viaja a cada executor.' },
    ],
  },
  {
    id: 'sql', titulo: 'SQL sobre la misma tabla', corto: 'Ventas por sucursal: la misma consulta en Hive y en Spark SQL',
    mirar: 'Mismo SQL y misma tabla del Metastore; cambia el motor. Hive la corre en Tez, Spark SQL en sus executors. Con datos chicos casi todo es arrancar: Hive abre una sesión de Tez en YARN y Spark arranca su aplicación entera. Y ojo: en un :full real Spark devuelve una fila de más (sucursal 1 NULL), porque no aplica skip.header.line.count de la tabla y cuenta el encabezado del CSV como una venta.',
    antes: { texto: 'La tabla ventas tiene que existir en el Metastore (Tablas o Lenguajes la crean).', ir: { page: 'tablas', label: 'Ir a Tablas' } },
    ir: { page: 'lenguajes', arg: 'hive', label: 'Correrla en Lenguajes (Hive)' },
    variantes: [
      { nombre: 'Hive (Tez)', motor: 'tez', donde: 'en el cluster', archivos: [archivo('ventas.hql', ventasHql, '--', /^SELECT sucursal,/, /^ORDER BY facturado DESC;/)],
        cmd: `beeline -u jdbc:hive2://localhost:10000 -e "${SQL_SUCURSAL}"`, nota: 'beeline le manda el SQL a HiveServer2, que arma un DAG de Tez.' },
      { nombre: 'Spark SQL', motor: 'spark', donde: 'en el cluster', archivos: [tramo('ventas.py', ventasPy, '#', /spark\.sql\("""/, /"""\)\.show\(\)/)],
        cmd: `spark-sql -e "${SQL_SUCURSAL}"`, nota: 'Lee la tabla por el nombre (Spark usa el mismo Metastore que Hive), pero no saltea el encabezado: suma la fila sucursal 1 NULL.' },
    ],
  },
  {
    id: 'etl', titulo: 'Limpiar los datos (ETL)', corto: 'Ventas sucias: duplicados, fechas y nombres mal escritos',
    mirar: 'Una máquina contra el cluster. pandas tiene toda la tabla en memoria y es más rápido mientras entre; Spark reparte en particiones y gana cuando los datos no entran en una compu. Los pasos son los mismos.',
    antes: { texto: 'Los datos sucios se generan una vez (y para Spark se suben a HDFS).', cmd: 'python3 ejemplos/ml/generar_sucios.py\nhdfs dfs -mkdir -p /user/root/ml\nhdfs dfs -put -f ventas_sucias.csv /user/root/ml/' },
    ir: { page: 'pipeline', label: 'Correrlo en el Pipeline (etapa ETL)' },
    variantes: [
      { nombre: 'pandas', motor: 'uno', donde: 'en una sola máquina', archivos: [archivo('etl_pandas.py', etlPandas, '#', /^ventas = pd\.read_csv/, /\.to_parquet\(salida/)],
        cmd: 'python3 ejemplos/ml/etl_pandas.py', nota: 'Toda la tabla en la RAM de una compu, sin YARN.' },
      { nombre: 'PySpark', motor: 'spark', donde: 'en el cluster', archivos: [archivo('etl_spark.py', etlSpark, '#', /^ventas = spark\.read\.csv/, /\.parquet\(salida\)/)],
        cmd: 'spark-submit ejemplos/ml/etl_spark.py', nota: 'Cada count() es un trabajo de Spark: se ven en :4040 mientras corre.' },
    ],
  },
  {
    id: 'traer', titulo: 'Traer una tabla de MariaDB', corto: 'La tabla ventas de la base tienda, a HDFS',
    mirar: 'Sqoop es un comando: trae la tabla y termina. Spark lee por JDBC adentro de un programa, que después puede seguir procesando sin escribir en el medio. Los dos la leen en 4 pedazos en paralelo.',
    ir: { page: 'pipeline', label: 'Sqoop en el Pipeline (etapa 1)' },
    variantes: [
      { nombre: 'Sqoop', motor: 'mr', donde: 'en el cluster', archivos: [tramo('sqoop.sh', sqoopSh, '#', /--table ventas/, /-m 4\s*$/)],
        cmd: 'sqoop import --connect jdbc:mysql://localhost/tienda --username alumno --password alumno \\\n  --table ventas --target-dir /user/root/tienda/ventas --delete-target-dir -m 4', nota: 'Un trabajo de MapReduce sin reduce: cada map lee un rango de id.' },
      { nombre: 'Spark (JDBC)', motor: 'spark', donde: 'en el cluster', archivos: [archivo('jdbc.py', jdbcPy, '#', /^from pyspark/, /^ventas\.write/)],
        cmd: 'spark-submit --jars /opt/sqoop/lib/mysql-connector-java-5.1.49.jar \\\n  ejemplos/comparar/jdbc.py', nota: 'El mismo driver de MySQL que usa Sqoop, pasado con --jars.' },
    ],
  },
  {
    id: 'modelo', titulo: 'Entrenar un modelo', corto: 'Regresión, clasificación y clustering de clientes',
    mirar: 'scikit-learn entrena en una máquina con todo en memoria (y tiene más modelos); MLlib reparte los datos entre los executors y entrena con todo lo que hay en HDFS. Los resultados se parecen; el costo no.',
    antes: { texto: 'Los clientes se generan una vez (y para Spark se suben a HDFS).', cmd: 'python3 ejemplos/ml/generar_senal.py\nhdfs dfs -mkdir -p /user/root/ml\nhdfs dfs -put -f clientes_senal.csv /user/root/ml/' },
    ir: { page: 'ml', label: 'Entrenar en Machine Learning' },
    variantes: [
      { nombre: 'scikit-learn', motor: 'uno', donde: 'en una sola máquina', archivos: [archivo('modelos_sklearn.py', modSklearn, '#', /^import json/)],
        cmd: 'python3 ejemplos/ml/modelos_sklearn.py', nota: 'Deja metricas_sklearn.json para comparar con el de Spark.' },
      { nombre: 'Spark MLlib', motor: 'spark', donde: 'en el cluster', archivos: [archivo('modelos_spark.py', modSpark, '#', /^import json/)],
        cmd: 'spark-submit ejemplos/ml/modelos_spark.py', nota: 'Deja metricas_spark.json: mismas métricas, otro motor.' },
    ],
  },
];

/** Las tareas que se miran en otra pantalla (no tienen código para poner al lado) */
export const TAREAS_AFUERA: { id: string; titulo: string; corto: string; ir: { page: PageId; arg?: string; label: string } }[] = [
  { id: 'formatos', titulo: 'CSV contra Parquet', corto: 'La misma tabla en tres formatos: lo que ocupa y lo que tarda', ir: { page: 'formatos', label: 'Ir a Formatos' } },
];
