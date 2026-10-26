/* Guía 09: ZooKeeper y alta disponibilidad. Apagar el NameNode activo y ver el failover. */
import type { ClusterStatus } from '../../api/types';
import { waitFor } from './motor';
import { actionRaw, armada, lsRaw, textLines } from './comun';
import type { Practice, StepCtx } from './tipos';
import { plural } from '../format';

const nns = (s: ClusterStatus) => s.processes.filter(p => p.kind === 'namenode');
const active = (s: ClusterStatus) => nns(s).find(p => p.state === 'up' && p.role === 'active');
const nnTable = (s: ClusterStatus) => ({ kind: 'table' as const, columns: ['NameNode', 'estado', 'rol'], rows: nns(s).map(p => [p.name, p.state, p.role ?? '']) });
const nnOf = async (c: StepCtx, id: string) => (await c.status()).processes.find(p => p.id === id);
const num = (id: string) => id.replace(/\D/g, '');
/** El NameNode de la práctica: el que estaba activo al empezar (lo que dejó el primer paso gana) */
const plan = (s: ClusterStatus): Record<string, string> => { const a = active(s); return a ? { nn: a.id, nnNum: num(a.id), nnName: a.name } : {}; };
/** hdfs haadmin -getAllServiceState, armado con el rol que informa cada NameNode */
const stateRaw = (c: StepCtx, s: ClusterStatus) => armada(
  textLines(nns(s).map(p => `${`NameNode ${num(p.id)} (${p.name})`.padEnd(44)}${p.state === 'up' ? (p.role ?? 'unknown') : 'Failed to connect: Connection refused'}`).join('\n')),
  c.api.mode === 'demo' ? 'Modo demo: salida simulada con el mismo formato que la terminal' : 'Armada con el rol que informa cada NameNode; en la terminal cada línea empieza con host:puerto');
const nnAction = async (c: StepCtx, id: string, a: 'start' | 'stop') => { const r = await c.api.processAction(id, a); return r && typeof r === 'object' ? r.id : undefined; };
const STATE = 'hdfs haadmin -getAllServiceState';

export const ha: Practice = {
  id: 'ha', guide: '09', guideFile: '09-zookeeper-ha.md',
  title: 'Alta disponibilidad: se cae el NameNode',
  summary: 'Apagás el NameNode activo, ZooKeeper elige otro y HDFS sigue andando. Después vuelve como standby.',
  minutes: 10, cap: 'ha',
  before: 'Hace falta un volumen con 2 NameNodes o más',
  learn: ['Hay un NameNode activo y los demás en standby, al día por los JournalNodes', 'ZooKeeper detecta la caída y promueve a otro: el failover', 'El que vuelve no recupera el puesto: queda en standby'],
  steps: [
    {
      id: 'activo', title: 'Ver quién está activo',
      command: STATE, input: 'Nada', plan,
      does: 'Le pregunta a cada NameNode su rol.', expect: 'Uno active y los demás standby',
      pregunta: {
        enunciado: 'Ahora queremos saber cuál de los NameNodes está activo y cuáles en standby. ¿Cuál es el comando correcto?',
        opciones: [
          { cmd: STATE, correcta: true, porque: 'haadmin es la herramienta de alta disponibilidad de HDFS: -getAllServiceState le pregunta a cada NameNode su rol y lo imprime (active o standby).' },
          { cmd: 'hdfs dfsadmin -report', porque: 'Muestra los DataNodes (vivos, muertos, bloques), no el rol de los NameNodes.' },
          { cmd: 'jps', porque: 'jps te dice que hay procesos NameNode corriendo, pero no cuál es el activo.' },
          { cmd: 'hdfs haadmin -failover nn1 nn2', porque: 'Eso fuerza a mano un cambio de activo; acá solo queremos mirar.' },
        ],
      },
      donde: {
        contenedor: 'Cada NameNode es un proceso del contenedor; ZooKeeper anota cuál tiene el lock de activo',
        compu: 'Cluster: el rol aparece al lado de cada NameNode',
      },
      run: async c => {
        const s = await c.status();
        const a = active(s);
        if (!a) throw new Error('No hay ningún NameNode activo ahora');
        return { summary: `Activo: ${a.name}`, out: nnTable(s), raw: stateRaw(c, s), vars: { nn: a.id, nnNum: num(a.id), nnName: a.name }, link: { label: 'Ver el cluster', page: 'cluster' } };
      },
      verify: async c => {
        const a = active(await c.status());
        return a ? { ok: true, detail: `${a.name} es el activo` } : { ok: false, detail: 'Ninguno activo' };
      },
    },
    {
      id: 'apagar', title: 'Apagar el activo',
      command: 'namenode stop {nnNum}', input: 'El NameNode activo', plan,
      does: 'Mata el proceso. ZooKeeper deja de ver su latido.', expect: 'Ese NameNode queda apagado',
      pregunta: {
        enunciado: 'Ahora queremos que se caiga el NameNode activo, el {nnNum}, para ver qué hace ZooKeeper. ¿Cuál es el comando correcto?',
        opciones: [
          { cmd: 'namenode stop {nnNum}', correcta: true, porque: 'namenode es el script del sandbox que prende y apaga NameNodes por número: stop {nnNum} mata el proceso, como si se cortara la luz.' },
          { cmd: 'hdfs haadmin -transitionToStandby nn{nnNum}', porque: 'Eso lo pasa a standby a mano, de forma prolija: no es una caída (y con el failover automático HDFS ni te deja sin --forcemanual).' },
          { cmd: 'datanode stop {nnNum}', porque: 'datanode apaga un DataNode: el NameNode activo sigue en su puesto y no hay failover.' },
          { cmd: 'namenode start {nnNum}', porque: 'start lo prende, y ya está prendido: queremos apagarlo.' },
        ],
      },
      donde: {
        contenedor: 'El proceso del NameNode {nnNum} ya no corre; sus metadatos siguen en el disco',
        compu: 'Cluster: el NameNode {nnNum} aparece apagado',
      },
      run: async c => {
        const id = c.vars.nn;
        if (!id) throw new Error('Primero mirá quién está activo (paso anterior)');
        const act = await nnAction(c, id, 'stop');
        await waitFor(c, () => nnOf(c, id), p => p?.state === 'down' || p?.state === 'off', { seconds: 30, every: 1000, what: `Apagando ${c.vars.nnName ?? id}…` });
        return { summary: `${c.vars.nnName ?? id} apagado`, raw: await actionRaw(c, act) };
      },
      verify: async c => {
        const p = c.vars.nn ? await nnOf(c, c.vars.nn) : undefined;
        return p && p.state !== 'up' ? { ok: true, detail: `${p.name}: ${p.state}` } : { ok: false, detail: 'El que era activo sigue prendido' };
      },
    },
    {
      id: 'failover', title: 'Esperar el failover',
      command: STATE, input: 'Nada: lo decide ZooKeeper',
      does: 'El ZKFC de un standby toma el lock en ZooKeeper y lo pasa a active.', expect: 'Otro NameNode queda active',
      pregunta: {
        enunciado: 'Ahora queremos ver si ZooKeeper ya eligió otro NameNode activo. ¿Cuál es el comando correcto?',
        opciones: [
          { cmd: STATE, correcta: true, porque: 'Le pregunta el rol a todos: el que apagaste no contesta y otro ya figura active. Puede tardar unos segundos.' },
          { cmd: 'hdfs haadmin -getServiceState nn{nnNum}', porque: 'Pregunta solo por el que apagaste: como está caído, no puede conectarse. No te dice quién tomó el puesto.' },
          { cmd: 'hdfs haadmin -transitionToActive nn{nnNum}', porque: 'Intenta poner activo a mano al que está apagado: no anda, y además el failover lo hace ZooKeeper solo.' },
          { cmd: 'namenode start {nnNum}', porque: 'Lo prende antes de tiempo: primero queremos ver cómo sigue el cluster sin él.' },
        ],
      },
      donde: {
        contenedor: 'ZooKeeper le dio el lock de activo a otro NameNode; el ZKFC de ese NameNode lo pasó a active',
        compu: 'Cluster: otro NameNode figura active',
      },
      run: async c => {
        const w = await waitFor(c, () => c.status(), s => { const a = active(s); return !!a && a.id !== c.vars.nn; }, { seconds: 90, every: 1500, what: 'Esperando a que ZooKeeper elija otro activo…' });
        const a = active(w.value);
        return { summary: w.ok && a ? `Nuevo activo: ${a.name}` : 'Todavía no hay otro activo: probá Verificar en unos segundos', out: nnTable(w.value), raw: stateRaw(c, w.value) };
      },
      verify: async c => {
        const a = active(await c.status());
        return a && a.id !== c.vars.nn ? { ok: true, detail: `${a.name} tomó el puesto` } : { ok: false, detail: 'No hay otro activo todavía' };
      },
    },
    {
      id: 'sigue', title: 'HDFS sigue andando',
      command: 'hdfs dfs -ls /user/root', input: 'Nada', cap: 'hdfs.read',
      does: 'El cliente prueba los NameNodes de la lista hasta dar con el activo.', expect: 'Lista la carpeta como siempre',
      pregunta: {
        enunciado: 'Ahora queremos comprobar que HDFS sigue andando: listar /user/root como siempre. ¿Cuál es el comando correcto?',
        opciones: [
          { cmd: 'hdfs dfs -ls /user/root', correcta: true, porque: 'El mismo de siempre: el cliente no apunta a un NameNode fijo sino al nombre del cluster, y prueba la lista hasta dar con el activo.' },
          { cmd: 'ls /user/root', porque: 'Es el ls de Linux: mira el disco del contenedor, no HDFS.' },
          { cmd: 'hdfs dfsadmin -safemode get', porque: 'Dice si el NameNode está en modo seguro; no lista nada.' },
          { cmd: 'hdfs dfs -cat /user/root', porque: '-cat muestra el contenido de un archivo; a una carpeta contesta que es un directorio (Is a directory).' },
        ],
      },
      donde: {
        hdfs: 'Todo sigue en su lugar: los metadatos estaban también en el standby, al día por los JournalNodes',
        compu: 'HDFS → Archivos responde igual que antes',
      },
      run: async c => {
        const l = await c.api.hdfsList('/user/root');
        return { summary: `${plural(l.entries.length, 'entrada')} en /user/root: el cliente encontró al nuevo activo`, raw: lsRaw(c, l), vars: { lsOk: '1' } };
      },
      verify: async c => {
        await c.api.hdfsList('/user/root');
        return { ok: true, detail: 'hdfs dfs -ls responde' };
      },
    },
    {
      id: 'volver', title: 'Prender el que se cayó',
      command: 'namenode start {nnNum}', input: 'El NameNode apagado', plan,
      does: 'Arranca, se pone al día con los JournalNodes y queda en standby: no le saca el puesto al nuevo.', expect: 'Vuelve como standby',
      pregunta: {
        enunciado: 'Ahora queremos volver a prender el NameNode {nnNum}, el que se cayó. ¿Cuál es el comando correcto?',
        opciones: [
          { cmd: 'namenode start {nnNum}', correcta: true, porque: 'start {nnNum} arranca el mismo NameNode que apagaste: se pone al día con los JournalNodes y queda en standby.' },
          { cmd: 'namenode stop {nnNum}', porque: 'stop lo apaga, y ya está apagado.' },
          { cmd: 'hdfs haadmin -transitionToActive nn{nnNum}', porque: 'Está apagado, así que no contesta; y aunque estuviera prendido, el puesto de activo ya lo tiene otro.' },
          { cmd: 'datanode start {nnNum}', porque: 'datanode prende un DataNode, no un NameNode.' },
        ],
      },
      donde: {
        contenedor: 'El proceso del NameNode {nnNum} vuelve a correr, ahora en standby',
        compu: 'Cluster: el NameNode {nnNum} vuelve, como standby',
      },
      run: async c => {
        const id = c.vars.nn;
        if (!id) throw new Error('No hay un NameNode apagado por esta práctica');
        const act = await nnAction(c, id, 'start');
        const w = await waitFor(c, () => nnOf(c, id), p => p?.state === 'up' && p.role === 'standby', { seconds: 120, every: 2000, what: 'Esperando a que vuelva como standby…' });
        return { summary: w.ok ? `${w.value?.name} volvió como standby` : `${w.value?.name ?? id}: ${w.value?.state}`, out: nnTable(await c.status()), raw: await actionRaw(c, act) };
      },
      verify: async c => {
        const p = c.vars.nn ? await nnOf(c, c.vars.nn) : undefined;
        return p?.state === 'up' && p.role === 'standby' ? { ok: true, detail: `${p.name}: standby` } : { ok: false, detail: p ? `${p.name}: ${p.state}${p.role ? ` (${p.role})` : ''}` : 'Sin datos' };
      },
    },
  ],
};
