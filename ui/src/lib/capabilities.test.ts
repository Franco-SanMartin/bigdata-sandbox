import { describe, expect, it } from 'vitest';
import type { ClusterConfig, ClusterPhase, ClusterStatus, ProcState } from '../api/types';
import { CAP_INFO, capabilities, capSummary } from './capabilities';
import { DEFAULT_CONFIG, processSpecs } from './cluster';

/** Un estado armado a mano: todos los procesos de la configuración en el mismo estado, salvo los que se pisen */
function status(phase: ClusterPhase, cfg: Partial<ClusterConfig> = {}, procs: Record<string, ProcState> = {}, extra: Partial<ClusterStatus['hdfs']> = {}): ClusterStatus {
  const config = { ...DEFAULT_CONFIG, ...cfg };
  const base: ProcState = phase === 'running' ? 'up' : phase === 'starting' ? 'starting' : 'off';
  const processes = processSpecs(config).map(p => ({ id: p.id, kind: p.kind, name: p.name, layer: p.layer, ports: p.ports, controllable: p.controllable, state: procs[p.id] ?? base }));
  const nnUp = processes.some(p => p.kind === 'namenode' && p.state === 'up');
  const dnUp = processes.filter(p => p.kind === 'datanode' && p.state === 'up').length;
  return {
    phase, config, volumeNameNodes: null, startedAt: null, now: 0,
    memory: { limitMb: 7884, usedMb: 0, estimateMb: 0, history: [] },
    processes,
    hdfs: { available: nnUp, safeMode: false, liveDataNodes: dnUp, staleDataNodes: 0, deadDataNodes: 0, files: 0, blocks: 0, replicas: 0, underReplicated: 0, missing: 0, overReplicated: 0, usedMb: 0, ...extra },
    yarn: { totalMb: 0, usedMb: 0, running: 0, pending: 0, finished: 0 },
    boot: null,
    image: { name: 'x', tag: 'full', hadoop: '3.3.6', hive: '4.0.0', spark: '3.5.9' },
  };
}

describe('capabilities', () => {
  it('sin conexión: todo bloqueado con motivo', () => {
    const c = capabilities(null);
    expect(c.hive.state).toBe('blocked');
    expect(c.hive.reason).toMatch(/Sin conexión/);
  });

  it('apagado: lo que necesita el cluster ofrece iniciarlo', () => {
    const c = capabilities(status('stopped'));
    expect(c['cluster.start'].state).toBe('ready');
    expect(c['hdfs.write']).toMatchObject({ state: 'blocked', fix: { kind: 'start' }, fixLabel: 'Iniciar cluster' });
    expect(c['volume.reset'].state).toBe('ready');
    expect(c['config.edit'].state).toBe('ready');
  });

  it('apagado y fuera de la configuración: el arreglo es cambiar la configuración, no iniciar', () => {
    const c = capabilities(status('stopped', { mongodb: false, services: 'hdfs' }));
    expect(c.mongodb.fix).toEqual({ kind: 'config', change: { mongodb: true } });
    expect(c.hive.fix).toEqual({ kind: 'config', change: { services: 'todo' } });
    expect(c.mysql.fix).toEqual({ kind: 'config', change: { services: 'mapreduce' } });
    expect(c.hive.reason).toMatch(/SERVICIOS=hdfs/);
  });

  it('en marcha con todo arriba: listo', () => {
    const c = capabilities(status('running', { mongodb: true, jupyter: true }));
    for (const id of ['hdfs.read', 'hdfs.write', 'mapreduce', 'hive', 'tez', 'spark', 'mysql', 'mongodb', 'jupyter', 'pipeline', 'ml.sklearn'] as const)
      expect(c[id].state, id).toBe('ready');
    expect(c['volume.reset']).toMatchObject({ state: 'blocked', fix: { kind: 'stop' } });
  });

  it('un servicio apagado se prende desde el arreglo; uno no controlable pide reiniciar', () => {
    const c = capabilities(status('running', {}, { hiveserver2: 'down', rm: 'down' }));
    expect(c.hive).toMatchObject({ state: 'blocked', fix: { kind: 'process-start', process: 'hiveserver2' } });
    expect(c.mapreduce).toMatchObject({ state: 'blocked', fix: { kind: 'restart' } });
  });

  it('arrancando: lo que todavía no está arriba espera', () => {
    const c = capabilities(status('starting', {}, { nn1: 'up', dn1: 'up', dn2: 'up', dn3: 'up' }));
    expect(c['hdfs.write'].state).toBe('ready');
    expect(c.hive).toMatchObject({ state: 'starting', fix: { kind: 'wait' } });
    expect(c['config.edit'].state).toBe('starting');
  });

  it('modo seguro y sin DataNodes: no se puede escribir pero sí leer', () => {
    expect(capabilities(status('running', {}, {}, { safeMode: true }))['hdfs.write'].state).toBe('starting');
    const sinDn = capabilities(status('running', {}, { dn1: 'down', dn2: 'down', dn3: 'down' }));
    expect(sinDn['hdfs.read'].state).toBe('ready');
    expect(sinDn['hdfs.write']).toMatchObject({ state: 'blocked', fix: { kind: 'process-start', process: 'dn1' } });
  });

  it('alta disponibilidad: pide NAMENODES≥2, o borrar el volumen si ya quedó con 1', () => {
    expect(capabilities(status('running'))['ha'].fix).toEqual({ kind: 'config', change: { namenodes: 2 } });
    const vol = { ...status('running'), volumeNameNodes: 1 };
    expect(capabilities(vol).ha.fix).toEqual({ kind: 'reset-volume' });
    expect(capabilities(status('running', { namenodes: 2 })).ha.state).toBe('ready');
  });

  it('Pig corre desde la interfaz si está YARN; sin MapReduce, dice cómo agregarlo', () => {
    expect(capabilities(status('running')).pig.state).toBe('ready');
    const solo = capabilities(status('running', { services: 'hdfs' })).pig;
    expect(solo.state).not.toBe('ready');
    expect(solo.reason).toBeTruthy();
    expect(solo.fix).toBeDefined();
  });

  it('todo lo bloqueado tiene motivo', () => {
    for (const s of [null, status('stopped'), status('starting'), status('running', { services: 'hdfs' }), status('stopping')]) {
      const c = capabilities(s);
      Object.values(c).forEach(x => { if (x.state !== 'ready') expect(x.reason, x.id).toBeTruthy(); });
      const sum = capSummary(c);
      expect(sum.ready + sum.starting + sum.blocked).toBe(CAP_INFO.length);
    }
  });
});
