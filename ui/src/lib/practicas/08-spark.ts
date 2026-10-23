/* Guía 08: Spark. SparkPi, las ventas con DataFrames y el DAG de etapas. */
import { appCheck, appResult, submitTemplate, waitApp } from './comun';
import { notThere } from './motor';
import type { Practice } from './tipos';

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
        const a = await c.api.app(c.vars.ventas);
        const v = a.dag.vertices;
        return {
          summary: `${v.length} etapa(s), ${a.dag.edges.length} shuffle(s)`,
          out: { kind: 'table', columns: ['etapa', 'qué hace', 'tareas', 'entran', 'salen'], rows: v.map(x => [x.name, x.operators.join(' → '), `${x.tasksDone}/${x.tasks}`, x.recordsIn ?? '', x.recordsOut ?? '']) },
          vars: { dag: String(v.length) }, link: { label: 'Ver el DAG', page: 'yarn', arg: a.id },
        };
      },
      verify: async c => (Number(c.vars.dag ?? 0) > 0 ? { ok: true, detail: `${c.vars.dag} etapa(s)` } : { ok: false, detail: 'Todavía no se miró el DAG' }),
    },
  ],
};
