/* Guía 09: ZooKeeper y alta disponibilidad. Apagar el NameNode activo y ver el failover. */
import type { ClusterStatus } from '../../api/types';
import { waitFor } from './motor';
import type { Practice, StepCtx } from './tipos';
import { plural } from '../format';

const nns = (s: ClusterStatus) => s.processes.filter(p => p.kind === 'namenode');
const active = (s: ClusterStatus) => nns(s).find(p => p.state === 'up' && p.role === 'active');
const nnTable = (s: ClusterStatus) => ({ kind: 'table' as const, columns: ['NameNode', 'estado', 'rol'], rows: nns(s).map(p => [p.name, p.state, p.role ?? '']) });
const nnOf = async (c: StepCtx, id: string) => (await c.status()).processes.find(p => p.id === id);

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
      command: 'hdfs haadmin -getAllServiceState', input: 'Nada',
      does: 'Le pregunta a cada NameNode su rol.', expect: 'Uno active y los demás standby',
      run: async c => {
        const s = await c.status();
        const a = active(s);
        if (!a) throw new Error('No hay ningún NameNode activo ahora');
        return { summary: `Activo: ${a.name}`, out: nnTable(s), vars: { nn: a.id, nnName: a.name }, link: { label: 'Ver el cluster', page: 'cluster' } };
      },
      verify: async c => {
        const a = active(await c.status());
        return a ? { ok: true, detail: `${a.name} es el activo` } : { ok: false, detail: 'Ninguno activo' };
      },
    },
    {
      id: 'apagar', title: 'Apagar el activo',
      command: 'namenode stop $activo', input: 'El NameNode activo',
      does: 'Mata el proceso. ZooKeeper deja de ver su latido.', expect: 'Ese NameNode queda apagado',
      run: async c => {
        const id = c.vars.nn;
        if (!id) throw new Error('Primero mirá quién está activo (paso anterior)');
        await c.api.processAction(id, 'stop');
        await waitFor(c, () => nnOf(c, id), p => p?.state === 'down' || p?.state === 'off', { seconds: 30, every: 1000, what: `Apagando ${c.vars.nnName ?? id}…` });
        return { summary: `${c.vars.nnName ?? id} apagado` };
      },
      verify: async c => {
        const p = c.vars.nn ? await nnOf(c, c.vars.nn) : undefined;
        return p && p.state !== 'up' ? { ok: true, detail: `${p.name}: ${p.state}` } : { ok: false, detail: 'El que era activo sigue prendido' };
      },
    },
    {
      id: 'failover', title: 'Esperar el failover',
      command: 'hdfs haadmin -getAllServiceState', input: 'Nada: lo decide ZooKeeper',
      does: 'El ZKFC de un standby toma el lock en ZooKeeper y lo pasa a active.', expect: 'Otro NameNode queda active',
      run: async c => {
        const w = await waitFor(c, () => c.status(), s => { const a = active(s); return !!a && a.id !== c.vars.nn; }, { seconds: 90, every: 1500, what: 'Esperando a que ZooKeeper elija otro activo…' });
        const a = active(w.value);
        return { summary: w.ok && a ? `Nuevo activo: ${a.name}` : 'Todavía no hay otro activo: probá Verificar en unos segundos', out: nnTable(w.value) };
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
      run: async c => {
        const l = await c.api.hdfsList('/user/root');
        return { summary: `${plural(l.entries.length, 'entrada')} en /user/root: el cliente encontró al nuevo activo`, vars: { lsOk: '1' } };
      },
      verify: async c => {
        await c.api.hdfsList('/user/root');
        return { ok: true, detail: 'hdfs dfs -ls responde' };
      },
    },
    {
      id: 'volver', title: 'Prender el que se cayó',
      command: 'namenode start $activo', input: 'El NameNode apagado',
      does: 'Arranca, se pone al día con los JournalNodes y queda en standby: no le saca el puesto al nuevo.', expect: 'Vuelve como standby',
      run: async c => {
        const id = c.vars.nn;
        if (!id) throw new Error('No hay un NameNode apagado por esta práctica');
        await c.api.processAction(id, 'start');
        const w = await waitFor(c, () => nnOf(c, id), p => p?.state === 'up' && p.role === 'standby', { seconds: 120, every: 2000, what: 'Esperando a que vuelva como standby…' });
        return { summary: w.ok ? `${w.value?.name} volvió como standby` : `${w.value?.name ?? id}: ${w.value?.state}`, out: nnTable(await c.status()) };
      },
      verify: async c => {
        const p = c.vars.nn ? await nnOf(c, c.vars.nn) : undefined;
        return p?.state === 'up' && p.role === 'standby' ? { ok: true, detail: `${p.name}: standby` } : { ok: false, detail: p ? `${p.name}: ${p.state}${p.role ? ` (${p.role})` : ''}` : 'Sin datos' };
      },
    },
  ],
};
