/* Guía 04: YARN y MapReduce. El wordcount de siempre, de la entrada al part-r-00000. */
import { errorCode } from '../../api/errors';
import { appCheck, appResult, ensureExample, entry, fileCheck, lsOut, waitApp } from './comun';
import type { Practice } from './tipos';

const IN = '/user/root/texto.txt';
const OUT = '/user/root/wc-out';
const PART = `${OUT}/part-r-00000`;

export const mapreduce: Practice = {
  id: 'mapreduce', guide: '04', guideFile: '04-yarn-mapreduce.md',
  title: 'MapReduce: contar palabras',
  summary: 'Lanzás el wordcount en YARN, seguís sus contenedores, leés sus logs y abrís el resultado en HDFS.',
  minutes: 15, cap: 'mapreduce',
  learn: ['Map emite (palabra, 1); el shuffle agrupa por palabra; reduce suma', 'YARN da contenedores: uno para el ApplicationMaster y uno por tarea', 'El resultado queda en HDFS, en archivos part-r-*'],
  steps: [
    {
      id: 'texto', title: 'Subir el texto de entrada',
      command: 'hdfs dfs -put -f ejemplos/texto.txt /user/root/', input: 'texto.txt: 4 líneas', cap: 'hdfs.write',
      does: 'Lo deja en HDFS, que es de donde leen los mappers.', expect: `${IN} existe`,
      run: c => ensureExample(c, '/user/root', 'texto.txt', 'texto'),
      verify: c => fileCheck(c, '/user/root', 'texto.txt'),
    },
    {
      id: 'lanzar', title: 'Lanzar el wordcount',
      command: `yarn jar $HADOOP_HOME/share/hadoop/mapreduce/hadoop-mapreduce-examples-3.3.6.jar wordcount ${IN} ${OUT}`,
      input: `${IN} → ${OUT}`,
      does: 'Le pide a YARN un contenedor para el ApplicationMaster, que después pide uno por cada map y reduce.',
      expect: 'Queda un trabajo application_… en la cola',
      run: async c => {
        const id = await c.api.submitJob({ template: 'mr-wordcount', params: { in: IN, out: OUT, overwrite: true } });
        return { summary: `Lanzado ${id}`, vars: { app: id }, link: { label: 'Ver el trabajo', page: 'yarn', arg: id } };
      },
      verify: async c => (c.vars.app ? { ok: true, detail: `Trabajo ${c.vars.app}` } : { ok: false, detail: 'Todavía no se lanzó' }),
      tip: 'Si la carpeta de salida ya existe, MapReduce no arranca: así no pisa un resultado sin querer.',
    },
    {
      id: 'seguir', title: 'Seguirlo hasta que termine',
      command: 'yarn application -status <id>', input: 'El id del trabajo',
      does: 'Pasa por ACCEPTED, RUNNING (maps, después reduces) y FINISHED.', expect: 'Estado FINISHED',
      run: async c => {
        if (!c.vars.app) throw new Error('Primero lanzá el trabajo (paso anterior)');
        return appResult(await waitApp(c, c.vars.app));
      },
      verify: c => appCheck(c, 'app'),
    },
    {
      id: 'logs', title: 'Leer los logs del contenedor',
      command: 'yarn logs -applicationId <id>', input: 'El id del trabajo',
      does: 'Junta stdout, stderr y syslog de cada contenedor que corrió.', expect: 'Las líneas del ApplicationMaster',
      run: async c => {
        if (!c.vars.app) throw new Error('Primero lanzá el trabajo');
        const l = await c.api.appLogs(c.vars.app);
        const f = l.files.find(x => x.name === 'syslog' && x.lines.length) ?? l.files.find(x => x.lines.length);
        return { summary: `${l.containers.length} contenedor(es); mostrando ${f?.name ?? 'nada'} de ${l.container}`, out: { kind: 'text', text: (f?.lines ?? ['(sin líneas)']).slice(-25).join('\n') }, link: { label: 'Ver todos los logs', page: 'yarn', arg: c.vars.app } };
      },
    },
    {
      id: 'resultado', title: 'Abrir el resultado',
      command: `hdfs dfs -cat ${PART} | sort -k2 -nr | head`, input: OUT, cap: 'hdfs.read',
      does: 'Cada reduce deja un archivo part-r-NNNNN; _SUCCESS dice que terminó bien.', expect: 'part-r-00000 con "datos 3"',
      run: async c => {
        const l = await c.api.hdfsList(OUT);
        let text = '';
        try {
          text = (await c.api.hdfsCat(PART, 0, 4096)).text;
        } catch (e) {
          if (errorCode(e) !== 'unsupported') throw e;
        }
        return { summary: `${l.entries.length} archivo(s) en ${OUT}`, out: text ? { kind: 'text', text: text.split('\n').slice(0, 20).join('\n') } : lsOut(l), link: { label: 'Ver en HDFS', page: 'hdfs', arg: OUT } };
      },
      verify: async c => {
        const part = await entry(c, OUT, 'part-r-00000');
        return part ? { ok: true, detail: `Está ${PART}` } : { ok: false, detail: `No está ${PART}` };
      },
    },
  ],
};
