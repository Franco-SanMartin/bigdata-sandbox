/* Guía 08: Spark. SparkPi, las ventas con DataFrames y el DAG de etapas. */
import { appCheck, appResult, submitTemplate, waitApp } from './comun';
import { notThere, waitFor } from './motor';
import type { Practice } from './tipos';
import { plural } from '../format';
import { SPARK_JAR } from '../jobs';

const PI = `spark-submit --class org.apache.spark.examples.SparkPi ${SPARK_JAR} 2`;
const HISTORY = 'http://localhost:18080';

export const spark: Practice = {
  id: 'spark', guide: '08', guideFile: '08-spark.md',
  title: 'Spark: el mismo cálculo en memoria',
  summary: 'Corrés SparkPi y ventas.py en YARN y mirás el DAG: etapas, tareas y el shuffle entre ellas.',
  minutes: 15, cap: 'spark',
  learn: ['Spark corre en contenedores de YARN: un driver y ejecutores', 'Cada shuffle corta el trabajo en etapas; el DAG lo muestra', 'Lo que en MapReduce escribe a disco, Spark lo deja en memoria'],
  steps: [
    {
      id: 'pi', title: 'Correr SparkPi',
      command: PI,
      input: '2 particiones', does: 'Tira puntos al azar en cada partición y estima π con los que caen adentro del círculo.', expect: 'Termina FINISHED',
      pregunta: {
        enunciado: 'Ahora queremos correr el ejemplo SparkPi del jar de ejemplos de Spark, con 2 particiones. ¿Cuál es el comando correcto?',
        opciones: [
          { cmd: PI, correcta: true, porque: 'spark-submit lanza el programa: --class dice cuál de los del jar correr, después va el jar y al final los argumentos del programa (2 particiones).' },
          { cmd: `spark-submit ${SPARK_JAR} 2`, porque: 'Falta --class: el jar de ejemplos tiene muchos programas y spark-submit no sabe cuál correr (No main class set in JAR).' },
          { cmd: `spark-submit --class org.apache.spark.examples.SparkPi 2 ${SPARK_JAR}`, porque: 'El jar va antes de los argumentos del programa: así toma 2 como el jar y no lo encuentra.' },
          { cmd: `hadoop jar ${SPARK_JAR} SparkPi 2`, porque: 'hadoop jar corre programas MapReduce; los de Spark se lanzan con spark-submit, que arma el driver y le pide los ejecutores a YARN.' },
        ],
      },
      donde: {
        contenedor: 'El driver corre acá (client mode): la estimación (Pi is roughly 3,14…) sale en su salida',
        yarn: 'El trabajo {pi}, de tipo SPARK: un contenedor para el ApplicationMaster y los ejecutores',
        compu: 'Trabajos → {pi}, o http://localhost:8088',
      },
      run: async c => {
        const id = await submitTemplate(c, 'spark-pi', { partitions: 2 });
        return { ...appResult(await waitApp(c, id), '', c.api.mode), vars: { pi: id } };
      },
      verify: c => appCheck(c, 'pi'),
      tip: 'El jar está en $SPARK_HOME/examples/jars: desde otra carpeta, poné la ruta completa.',
    },
    {
      id: 'ventas', title: 'Las ventas con DataFrames',
      command: 'spark-submit ejemplos/ventas.py', input: '/user/root/ventas (lo sube si falta)',
      does: 'Lee el CSV, agrupa por producto y suma: las mismas cuentas de MapReduce, Pig y Hive.', expect: 'Termina FINISHED con yerba arriba',
      pregunta: {
        enunciado: 'Ahora queremos correr el script de PySpark ejemplos/ventas.py en el cluster, de punta a punta. ¿Cuál es el comando correcto?',
        opciones: [
          { cmd: 'spark-submit ejemplos/ventas.py', correcta: true, porque: 'Un script de Python se le pasa directo a spark-submit (sin --class, que es para jars): arma el driver, pide los ejecutores a YARN y corre hasta terminar.' },
          { cmd: 'pyspark ejemplos/ventas.py', porque: 'pyspark abre la consola interactiva; desde Spark 2 no corre scripts y te dice que uses spark-submit.' },
          { cmd: 'hadoop jar ejemplos/ventas.py', porque: 'hadoop jar espera un .jar de Java con un programa MapReduce; un script de PySpark se manda con spark-submit.' },
          { cmd: 'spark-submit /user/root/ventas', porque: 'Le pasás los datos en vez del programa: spark-submit espera el script; la carpeta de las ventas la lee el script adentro.' },
        ],
      },
      donde: {
        contenedor: 'ejemplos/ventas.py está en el contenedor; el driver corre acá',
        yarn: 'El trabajo {ventas}, de tipo SPARK, con 2 ejecutores',
        hdfs: 'Lee /user/root/ventas y deja el resultado en /user/root/resultados/spark_por_producto',
        compu: 'Trabajos → {ventas}',
      },
      run: async c => {
        let id: string;
        try {
          id = await submitTemplate(c, 'spark-ventas', {});
        } catch (e) {
          if (!notThere(e)) throw e;
          id = await c.api.submitExample('spark-ventas');
        }
        return { ...appResult(await waitApp(c, id), '', c.api.mode), vars: { ventas: id } };
      },
      verify: c => appCheck(c, 'ventas'),
    },
    {
      id: 'dag', title: 'Mirar el DAG',
      command: HISTORY, en: 'En el navegador de tu compu', input: 'El trabajo de ventas',
      pregunta: {
        enunciado: 'Ahora queremos ver las etapas (el DAG) del trabajo de ventas que acaba de terminar. ¿Dónde lo mirás?',
        opciones: [
          { cmd: HISTORY, correcta: true, porque: 'Spark History guarda cada trabajo de Spark terminado: en Stages están las etapas y en cada una su DAG, con las tareas y el shuffle.' },
          { cmd: 'http://localhost:8088', porque: 'Es el ResourceManager de YARN: ves que el trabajo corrió y cuántos contenedores usó, pero no las etapas de Spark (de ahí hay un enlace a History).' },
          { cmd: 'http://localhost:9870', porque: 'Es el NameNode: muestra HDFS (archivos y DataNodes), no trabajos.' },
          { cmd: 'http://localhost:19888', porque: 'Es el JobHistory de MapReduce: guarda los trabajos MapReduce, no los de Spark.' },
        ],
      },
      donde: {
        compu: `${HISTORY} → el trabajo {ventas} → Stages; o acá, en Trabajos → {ventas}`,
      },
      does: 'Muestra las etapas: leer y agrupar parcial, shuffle, y sumar por producto.', expect: 'Dos etapas o más unidas por un shuffle',
      run: async c => {
        if (!c.vars.ventas) throw new Error('Primero corré las ventas (paso anterior)');
        // Spark History levanta el log de un trabajo recién terminado cada unos segundos
        const w = await waitFor(c, () => c.api.app(c.vars.ventas!), x => x.dag.vertices.length > 0,
          { seconds: 60, every: 2500, what: 'Esperando a que Spark History cargue el trabajo…' });
        const a = w.value;
        const v = a.dag.vertices;
        if (!v.length) throw new Error(`Spark History todavía no tiene ${a.id}: probá de nuevo en unos segundos`);
        return {
          summary: `${plural(v.length, 'etapa')}, ${plural(a.dag.edges.length, 'shuffle')}`,
          out: { kind: 'table', columns: ['etapa', 'qué hace', 'tareas', 'entran', 'salen'], rows: v.map(x => [x.name, x.operators.join(' → '), `${x.tasksDone}/${x.tasks}`, x.recordsIn ?? '', x.recordsOut ?? '']) },
          vars: { dag: String(v.length) }, link: { label: 'Ver el DAG', page: 'yarn', arg: a.id },
        };
      },
      verify: async c => (Number(c.vars.dag ?? 0) > 0 ? { ok: true, detail: plural(Number(c.vars.dag), 'etapa') } : { ok: false, detail: 'Todavía no se miró el DAG' }),
    },
  ],
};
