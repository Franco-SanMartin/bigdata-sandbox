/* Guía 08: Spark. SparkPi, las ventas con DataFrames y el DAG de etapas. */
import { appCheck, appResult, submitTemplate, waitApp } from './comun';
import { notThere, waitFor } from './motor';
import type { Practice } from './tipos';
import { plural } from '../format';

export const spark: Practice = {
  id: 'spark', guide: '08', guideFile: '08-spark.md',
  title: 'Spark: el mismo cálculo en memoria',
  summary: 'Corrés SparkPi y ventas.py en YARN y mirás el DAG: etapas, tareas y el shuffle entre ellas.',
  minutes: 15, cap: 'spark',
  learn: ['Spark corre en contenedores de YARN: un driver y ejecutores', 'Cada shuffle corta el trabajo en etapas; el DAG lo muestra', 'Lo que en MapReduce escribe a disco, Spark lo deja en memoria'],
  steps: [
    {
      id: 'pi', title: 'Correr SparkPi',
      command: 'spark-submit --class org.apache.spark.examples.SparkPi $SPARK_HOME/examples/jars/spark-examples_*.jar 2',
      input: '2 particiones', does: 'Tira puntos al azar en cada partición y estima π con los que caen adentro del círculo.', expect: 'Termina FINISHED',
      run: async c => {
        const id = await submitTemplate(c, 'spark-pi', { partitions: 2 });
        return { ...appResult(await waitApp(c, id)), vars: { pi: id } };
      },
      verify: c => appCheck(c, 'pi'),
    },
    {
      id: 'ventas', title: 'Las ventas con DataFrames',
      command: 'spark-submit ejemplos/ventas.py', input: '/user/root/ventas (lo sube si falta)',
      does: 'Lee el CSV, agrupa por producto y suma: las mismas cuentas de MapReduce, Pig y Hive.', expect: 'Termina FINISHED con yerba arriba',
      run: async c => {
        let id: string;
        try {
          id = await submitTemplate(c, 'spark-ventas', {});
        } catch (e) {
          if (!notThere(e)) throw e;
          id = await c.api.submitExample('spark-ventas');
        }
        return { ...appResult(await waitApp(c, id)), vars: { ventas: id } };
      },
      verify: c => appCheck(c, 'ventas'),
    },
    {
      id: 'dag', title: 'Mirar el DAG',
      command: 'Spark History: http://localhost:18080', input: 'El trabajo de ventas',
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
