/* Acciones sobre el cluster: piden confirmación cuando corresponde y avisan el resultado. */
import { api } from '../api';
import type { ClusterConfig, ExampleJob, Process } from '../api/types';
import { getSnapshot } from './store';
import { confirm, navigate, toast } from './ui';
import { configSummary } from '../lib/cluster';
import { plural } from '../lib/format';

async function run(p: Promise<unknown>, ok?: { title: string; description?: string; kind?: 'ok' | 'run' }) {
  try { await p; if (ok) toast({ kind: 'run', ...ok }); }
  catch (e) { toast({ kind: 'bad', title: 'No se pudo', description: e instanceof Error ? e.message : String(e) }); }
}

export function startCluster(config?: ClusterConfig) {
  const s = getSnapshot().status; if (!s) return;
  const c = config || s.config;
  navigate('cluster');
  return run(api().start(c), { title: 'Arrancando el cluster', description: configSummary(c) });
}

export async function stopCluster() {
  const s = getSnapshot().status; if (!s || s.phase !== 'running') return;
  const up = s.processes.filter(p => p.state === 'up').length;
  const ok = await confirm({
    title: 'Detener el cluster', danger: true, confirmLabel: 'Detener',
    description: 'Se apagan todos los procesos en orden, como docker compose stop. Los datos quedan en el volumen.',
    facts: [['Procesos arriba', String(up)], ['Trabajos en curso', String(s.yarn.running + s.yarn.pending)]],
  });
  if (ok) await run(api().stop(), { title: 'Apagando el cluster' });
}

export async function applyConfig(config: ClusterConfig) {
  const s = getSnapshot().status; if (!s) return;
  if (s.phase === 'running') {
    const ok = await confirm({
      title: 'Aplicar y reiniciar', confirmLabel: 'Reiniciar',
      description: 'El cluster se apaga y vuelve a arrancar con la nueva configuración. HDFS, las tablas de Hive y las bases quedan en el volumen.',
      facts: [['Antes', configSummary(s.config)], ['Después', configSummary(config)]],
    });
    if (!ok) return;
    navigate('cluster');
    await run(api().apply(config), { title: 'Reiniciando con la nueva configuración' });
  } else {
    await run(api().saveConfig(config), { title: 'Configuración guardada', kind: 'ok' });
  }
}

export async function resetVolume() {
  const ok = await confirm({
    title: 'Borrar el volumen', danger: true, confirmLabel: 'Borrar todo',
    description: 'Se pierde todo HDFS, las tablas de Hive, la base tienda de MySQL y MongoDB. El próximo arranque formatea de cero. No se puede deshacer.',
    facts: [['Volumen', 'bigdata_hadoop'], ['Equivale a', 'docker compose down -v']],
  });
  if (ok) await run(api().resetVolume(), { title: 'Volumen borrado', kind: 'ok' });
}

/** Qué pasaría con los bloques si se apaga un DataNode */
function dataNodeImpact(id: number) {
  const s = getSnapshot();
  let blocks = 0, lastCopy = 0, fewer = 0;
  s.files.forEach(f => f.blocks.forEach(b => {
    if (!b.locations.includes(id)) return;
    blocks++;
    if (b.locations.length === 1) lastCopy++; else fewer++;
  }));
  return { blocks, lastCopy, fewer };
}

export async function processAction(p: Process, action: 'start' | 'stop') {
  const s = getSnapshot().status; if (!s || s.phase !== 'running') return;
  if (action === 'stop') {
    let description = 'Se detiene el proceso.';
    const facts: [string, string][] = [['Proceso', `${p.name} · pid ${p.pid ?? '—'}`], ['Puerto', p.ports.join(', ')]];
    if (p.kind === 'datanode') {
      const id = +p.id.slice(2); const im = dataNodeImpact(id);
      description = 'El NameNode no se entera enseguida: espera sus latidos (cada 3 s) y a los 40 s lo da por muerto. Ahí re-replica lo que tenía.';
      facts.push(['Bloques en este nodo', String(im.blocks)]);
      if (im.lastCopy) facts.push(['Quedan perdidos', `${plural(im.lastCopy, 'bloque')} (era su única copia)`]);
      if (im.fewer) facts.push(['Se re-replican', plural(im.fewer, 'bloque')]);
    } else if (p.kind === 'namenode') {
      const ha = s.config.namenodes > 1;
      description = !ha ? 'Es el único NameNode: HDFS deja de responder hasta que lo vuelvas a prender. Los datos siguen en los DataNodes.'
        : p.role === 'active' ? 'Es el activo: su ZKFC pierde el lock en ZooKeeper y otro NameNode toma el control en unos segundos.' : 'Está en espera: el activo sigue atendiendo, no cambia nada.';
    } else if (p.kind === 'hiveserver2') description = 'Hive deja de aceptar consultas en el 10000. Las tablas siguen en HDFS.';
    else if (p.kind === 'mysql') description = 'Sqoop no va a poder leer ni escribir la base tienda.';
    const ok = await confirm({ title: `Apagar ${p.name}`, description, facts, confirmLabel: 'Apagar', danger: true });
    if (!ok) return;
  }
  await run(api().processAction(p.id, action), action === 'stop' ? { title: `${p.name} apagado`, description: 'Seguí lo que pasa en la consola.' } : { title: `Arrancando ${p.name}` });
}

export const putExample = (x: 'ventas' | 'numeros') => run(api().putExample(x), { title: `Subiendo ${x === 'ventas' ? 'ventas_grandes.csv' : 'numeros.txt'} a HDFS` });
export const addDataNode = () => run(api().addDataNode(), { title: 'Sumando un DataNode en caliente' });
export const submitExample = (j: ExampleJob) => run(api().submitExample(j), { title: 'Trabajo enviado a YARN' });
