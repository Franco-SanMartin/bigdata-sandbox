/* Guía 04: YARN y MapReduce. El wordcount de siempre, de la entrada al part-r-00000.
   El id del trabajo que se lanza queda en {app}: los pasos que siguen lo muestran en el comando. */
import { appCheck, appResult, armada, ensureExample, entry, fileCheck, logsRaw, lsOut, statusRaw, submitTemplate, textLines, waitApp } from './comun';
import { notThere } from './motor';
import type { Practice } from './tipos';
import { plural } from '../format';

const LOCAL = '/datos/ejemplos/texto.txt';
const IN = '/user/root/texto.txt';
const OUT = '/user/root/wc-out';
const PART = `${OUT}/part-r-00000`;
const JAR = 'hadoop-mapreduce-examples-3.3.6.jar';

/** sort -k2 -nr | head: las palabras que más aparecen primero */
const top = (text: string, n = 10) => text.split('\n').filter(Boolean)
  .map(l => { const [w, k] = l.split('\t'); return { l, k: Number(k) || 0, w }; })
  .sort((a, b) => b.k - a.k || (a.w < b.w ? 1 : -1)).slice(0, n).map(x => x.l);

export const mapreduce: Practice = {
  id: 'mapreduce', guide: '04', guideFile: '04-yarn-mapreduce.md',
  title: 'MapReduce: contar palabras',
  summary: 'Lanzás el wordcount en YARN, seguís sus contenedores, leés sus logs y abrís el resultado en HDFS.',
  minutes: 15, cap: 'mapreduce', after: ['hdfs-basico'],
  learn: ['Map emite (palabra, 1); el shuffle agrupa por palabra; reduce suma', 'YARN da contenedores: uno para el ApplicationMaster y uno por tarea', 'El resultado queda en HDFS, en archivos part-r-*'],
  steps: [
    {
      id: 'texto', title: 'Subir el texto de entrada',
      command: `hdfs dfs -put -f ${LOCAL} /user/root/`, input: `${LOCAL} (en el contenedor): 4 líneas`, cap: 'hdfs.write',
      does: 'Lo deja en HDFS, que es de donde leen los mappers.', expect: `${IN} existe`,
      pregunta: {
        enunciado: `Ahora queremos llevar el texto que está en el contenedor (${LOCAL}) a HDFS, a /user/root, para que lo lea MapReduce. ¿Cuál es el comando correcto?`,
        opciones: [
          { cmd: `hdfs dfs -put -f ${LOCAL} /user/root/`, correcta: true, porque: '-put copia del disco del contenedor a HDFS: primero el archivo local, después la carpeta de HDFS. -f lo pisa si ya estaba.' },
          { cmd: `cp ${LOCAL} /user/root/`, porque: 'cp copia dentro del disco del contenedor: el archivo queda en /user/root del contenedor, no en HDFS, y MapReduce no lo encuentra.' },
          { cmd: `hdfs dfs -copyToLocal ${LOCAL} /user/root/`, porque: '-copyToLocal es como -get: baja de HDFS al contenedor, el camino contrario.' },
          { cmd: `hdfs dfs -put -f /user/root/ ${LOCAL}`, porque: 'Los argumentos están al revés: el origen (el archivo local) va primero y el destino en HDFS después.' },
        ],
      },
      donde: {
        contenedor: `${LOCAL} sigue ahí: -put copia, no mueve`,
        hdfs: `${IN}: un solo bloque (es chico), con sus copias en los DataNodes`,
        compu: 'HDFS → Archivos → /user/root',
      },
      run: c => ensureExample(c, '/user/root', 'texto.txt', 'texto'),
      verify: c => fileCheck(c, '/user/root', 'texto.txt'),
    },
    {
      id: 'lanzar', title: 'Lanzar el wordcount',
      command: `hadoop jar ${JAR} wordcount ${IN} ${OUT}`,
      input: `${IN} → ${OUT}`,
      does: 'Le pide a YARN un contenedor para el ApplicationMaster, que después pide uno por cada map y reduce. Si la salida ya estaba, la interfaz la borra antes (hdfs dfs -rm -r) para que el trabajo arranque.',
      expect: 'Queda un trabajo application_… en la cola',
      pregunta: {
        enunciado: `Ahora queremos correr el wordcount de los ejemplos de Hadoop: que lea ${IN} y deje el resultado en ${OUT}. ¿Cuál es el comando correcto?`,
        opciones: [
          { cmd: `hadoop jar ${JAR} wordcount ${IN} ${OUT}`, correcta: true, porque: 'hadoop jar corre un programa empaquetado en un .jar; adentro del jar de ejemplos se elige cuál (wordcount) y después van la entrada y la carpeta de salida, en ese orden.' },
          { cmd: `hadoop jar ${JAR} wordcount ${OUT} ${IN}`, porque: `Entrada y salida al revés: buscaría la entrada en ${OUT}, que no existe (Input path does not exist).` },
          { cmd: `hadoop jar ${JAR} ${IN} ${OUT}`, porque: 'Falta decir qué programa del jar correr: el jar de ejemplos tiene varios (wordcount, pi, grep…) y contesta "Valid program names are…".' },
          { cmd: `hdfs dfs -wordcount ${IN} ${OUT}`, porque: 'hdfs dfs maneja archivos, no corre programas: -wordcount no existe. Los trabajos se mandan a YARN con hadoop jar (o yarn jar).' },
        ],
      },
      donde: {
        yarn: 'El trabajo {app} en la cola default: primero el contenedor del ApplicationMaster, después uno por map y por reduce',
        hdfs: `Mientras corre, ${OUT}/_temporary; al terminar, el resultado`,
        compu: 'Trabajos → {app}, o http://localhost:8088 (la interfaz del ResourceManager)',
      },
      run: async c => {
        const id = await submitTemplate(c, 'mr-wordcount', { in: IN, out: OUT, overwrite: true });
        return {
          summary: `Lanzado ${id}`, vars: { app: id }, link: { label: 'Ver el trabajo', page: 'yarn', arg: id },
          raw: armada([{ stream: 'err', text: `INFO impl.YarnClientImpl: Submitted application ${id}` }, { stream: 'err', text: `INFO mapreduce.Job: Running job: job_${id.replace(/^application_/, '')}` }],
            'El comando sigue corriendo hasta que termina el trabajo: el estado y los contadores los ves en el paso siguiente'),
        };
      },
      verify: async c => (c.vars.app ? { ok: true, detail: `Trabajo ${c.vars.app}` } : { ok: false, detail: 'Todavía no se lanzó' }),
      tip: 'El jar está en $HADOOP_HOME/share/hadoop/mapreduce. Si la carpeta de salida ya existe, MapReduce no arranca: así no pisa un resultado sin querer.',
    },
    {
      id: 'seguir', title: 'Seguirlo hasta que termine',
      command: 'yarn application -status {app}', input: 'El id del trabajo',
      does: 'Pasa por ACCEPTED, RUNNING (maps, después reduces) y FINISHED.', expect: 'Estado FINISHED',
      pregunta: {
        enunciado: 'Ahora queremos saber en qué estado está el trabajo {app} (si sigue corriendo o ya terminó). ¿Cuál es el comando correcto?',
        opciones: [
          { cmd: 'yarn application -status {app}', correcta: true, porque: '-status le pide al ResourceManager el informe de ese trabajo: estado (State), resultado (Final-State) y progreso.' },
          { cmd: 'yarn application -list', porque: '-list muestra solo los que están corriendo o en cola: cuando el trabajo termina, deja de aparecer y no te dice cómo terminó.' },
          { cmd: `hdfs dfs -ls ${OUT}`, porque: 'Muestra la carpeta de salida, no el estado: mientras corre ves _temporary y no sabés si va a terminar bien.' },
          { cmd: 'yarn logs -applicationId {app}', porque: 'Trae los logs de los contenedores, no el estado; y mientras el trabajo corre, todavía no están todos.' },
        ],
      },
      donde: {
        yarn: '{app} en FINISHED, con Final-State SUCCEEDED',
        hdfs: `${OUT} con _SUCCESS y part-r-00000`,
        compu: 'Trabajos → {app}: contenedores, contadores y el DAG',
      },
      run: async c => {
        if (!c.vars.app) throw new Error('Primero lanzá el trabajo (paso anterior)');
        const a = await waitApp(c, c.vars.app);
        return { ...appResult(a, '', c.api.mode), raw: statusRaw(c.api.mode, a) };
      },
      verify: c => appCheck(c, 'app'),
    },
    {
      id: 'logs', title: 'Leer los logs del contenedor',
      command: 'yarn logs -applicationId {app}', input: 'El id del trabajo',
      does: 'Junta stdout, stderr y syslog de cada contenedor que corrió.', expect: 'Las líneas del ApplicationMaster',
      pregunta: {
        enunciado: 'Ahora queremos leer lo que escribió cada contenedor del trabajo {app} (stdout, stderr y syslog). ¿Cuál es el comando correcto?',
        opciones: [
          { cmd: 'yarn logs -applicationId {app}', correcta: true, porque: 'yarn logs junta los logs de todos los contenedores del trabajo, uno detrás del otro, con un encabezado por archivo.' },
          { cmd: 'yarn logs {app}', porque: 'Falta -applicationId: yarn logs necesita que le digas qué es ese id, y sin la opción muestra cómo se usa.' },
          { cmd: 'yarn application -status {app}', porque: 'Da el estado del trabajo, no lo que escribieron sus contenedores.' },
          { cmd: 'cat /var/log/{app}.log', porque: 'No hay un archivo así: cada contenedor escribe sus logs en el NodeManager donde corrió, y yarn logs los junta.' },
        ],
      },
      donde: {
        yarn: 'Los logs de cada contenedor: los guarda YARN, por trabajo y por contenedor',
        contenedor: 'Nada nuevo: yarn logs solo los imprime',
        compu: 'Trabajos → {app} → Logs',
      },
      run: async c => {
        if (!c.vars.app) throw new Error('Primero lanzá el trabajo');
        const l = await c.api.appLogs(c.vars.app);
        const f = l.files.find(x => x.name === 'syslog' && x.lines.length) ?? l.files.find(x => x.lines.length);
        return {
          summary: `${l.containers.length} contenedor(es); mostrando ${f?.name ?? 'nada'} de ${l.container}`, out: { kind: 'text', text: (f?.lines ?? ['(sin líneas)']).slice(-25).join('\n') },
          raw: logsRaw(c.api.mode, l), link: { label: 'Ver todos los logs', page: 'yarn', arg: c.vars.app },
        };
      },
    },
    {
      id: 'resultado', title: 'Abrir el resultado',
      command: `hdfs dfs -cat ${PART} | sort -k2 -nr | head`, input: OUT, cap: 'hdfs.read',
      does: 'Cada reduce deja un archivo part-r-NNNNN (palabra, tabulador, cantidad); _SUCCESS dice que terminó bien.', expect: 'part-r-00000 con "datos 3"',
      pregunta: {
        enunciado: 'Ahora queremos ver las palabras que más aparecen, de mayor a menor. ¿Cuál es el comando correcto?',
        opciones: [
          { cmd: `hdfs dfs -cat ${PART} | sort -k2 -nr | head`, correcta: true, porque: '-cat lee el resultado de HDFS; sort -k2 -nr ordena por la segunda columna (la cantidad), como número y de mayor a menor; head deja las 10 primeras.' },
          { cmd: `hdfs dfs -cat ${PART} | sort -nr | head`, porque: 'Sin -k2, sort mira la primera columna, que es la palabra: no queda ordenado por cantidad.' },
          { cmd: `hdfs dfs -cat ${OUT} | sort -k2 -nr | head`, porque: `${OUT} es una carpeta: -cat no lee carpetas (Is a directory). Hay que apuntar al part-r-00000 de adentro.` },
          { cmd: `cat ${PART} | sort -k2 -nr | head`, porque: 'El cat de Linux busca en el disco del contenedor, y el resultado está en HDFS.' },
        ],
      },
      donde: {
        hdfs: `${OUT}: part-r-00000 (el resultado) y _SUCCESS (vacío: marca que terminó bien)`,
        contenedor: 'Nada: el resultado solo está en HDFS',
        compu: `HDFS → Archivos → ${OUT}`,
      },
      run: async c => {
        const l = await c.api.hdfsList(OUT);
        let text = '';
        try {
          text = (await c.api.hdfsCat(PART, 0, 4096)).text;
        } catch (e) {
          if (!notThere(e)) throw e;
        }
        const best = top(text);
        return {
          summary: `${plural(l.entries.length, 'archivo')} en ${OUT}`, out: text ? { kind: 'text', text: best.join('\n') } : lsOut(l),
          raw: armada(textLines(best.join('\n')), c.api.mode === 'demo' ? 'Modo demo: salida simulada con el mismo formato que la terminal' : 'Leído por WebHDFS y ordenado como sort -k2 -nr | head'),
          link: { label: 'Ver en HDFS', page: 'hdfs', arg: OUT },
        };
      },
      verify: async c => {
        const part = await entry(c, OUT, 'part-r-00000');
        return part ? { ok: true, detail: `Está ${PART}` } : { ok: false, detail: `No está ${PART}` };
      },
    },
  ],
};
