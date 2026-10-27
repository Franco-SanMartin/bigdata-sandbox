import { describe, expect, it } from 'vitest';
import type { ClusterStatus, DataNode, Process } from '../api/types';
import { DEFAULT_CONFIG, clusterHealth, composeYaml, configDiff } from './cluster';

const proc = (id: string, kind: Process['kind'], state: Process['state'] = 'up'): Process =>
  ({ id, kind, name: id === 'rm' ? 'ResourceManager' : kind === 'datanode' ? `DataNode ${id.slice(2)}` : id, layer: 'hdfs', state, ports: [], controllable: true });
function status(over: Partial<ClusterStatus> = {}, hdfs: Partial<ClusterStatus['hdfs']> = {}): ClusterStatus {
  return {
    phase: 'running', config: DEFAULT_CONFIG, volumeNameNodes: 1, startedAt: 0, now: 0,
    memory: { usedMb: 0, limitMb: 1, estimateMb: 0, history: [] } as unknown as ClusterStatus['memory'],
    processes: [proc('nn1', 'namenode'), proc('dn1', 'datanode'), proc('dn2', 'datanode'), proc('rm', 'resourcemanager')],
    hdfs: { available: true, safeMode: false, liveDataNodes: 2, staleDataNodes: 0, deadDataNodes: 0, files: 1, blocks: 1, replicas: 2, underReplicated: 0, missing: 0, overReplicated: 0, usedMb: 1, ...hdfs },
    yarn: {} as ClusterStatus['yarn'], boot: null, image: { name: '', tag: '', hadoop: '', hive: '', spark: '' }, ...over,
  };
}
const dn = (id: number, state: DataNode['state']): DataNode => ({ id, state, httpPort: 0, dataPort: 0, blocks: 0, usedMb: 0, lastHeartbeat: null, deadAt: null });

describe('clusterHealth', () => {
  it('apagado, arrancando y sano', () => {
    expect(clusterHealth(null).label).toBe('Conectando');
    expect(clusterHealth(status({ phase: 'stopped' })).tone).toBe('off');
    expect(clusterHealth(status({ phase: 'starting', boot: { kind: 'restart', startedAt: 0, expectedSec: 10, steps: [
      { id: 'a', name: 'A', state: 'done', description: '', commands: [], processes: [], expectedSec: 1, log: [] },
      { id: 'b', name: 'B', state: 'running', description: '', commands: [], processes: [], expectedSec: 1, log: [] },
      { id: 'c', name: 'C', state: 'skipped', description: '', commands: [], processes: [], expectedSec: 1, log: [] },
    ] } })).detail).toBe('Paso 2 de 2');
    expect(clusterHealth(status())).toMatchObject({ tone: 'ok', label: 'En marcha' });
  });
  it('un DataNode caído con las copias al día es "Degradado" (amarillo), no "Con fallas"', () => {
    const s = status({ processes: [proc('nn1', 'namenode'), proc('dn1', 'datanode', 'down'), proc('dn2', 'datanode')] });
    const h = clusterHealth(s, [dn(1, 'dead'), dn(2, 'live')]);
    expect(h.tone).toBe('warn');
    expect(h.label).toBe('Degradado');
    expect(h.detail).toBe('DataNode 1 caído · sin pérdida de datos');
    expect(h.issues).toHaveLength(1);
  });
  it('bloques sin copias o HDFS sin responder es rojo', () => {
    expect(clusterHealth(status({}, { missing: 3 })).tone).toBe('bad');
    const nnOff = clusterHealth(status({ processes: [proc('nn1', 'namenode', 'down')] }, { available: false }));
    expect(nnOff.tone).toBe('bad');
    expect(nnOff.issues.map(i => i.text)).toEqual(['HDFS no responde: el NameNode está apagado']);
  });
  it('un servicio entero caído (ResourceManager) es rojo; los problemas van del más grave al menos grave', () => {
    const h = clusterHealth(status({ processes: [proc('nn1', 'namenode'), proc('rm', 'resourcemanager', 'down')] }, { underReplicated: 2 }));
    expect(h.tone).toBe('bad');
    expect(h.issues.map(i => i.tone)).toEqual(['bad', 'warn']);
  });
});

describe('configDiff', () => {
  it('lista solo lo que cambia, en palabras', () => {
    expect(configDiff(DEFAULT_CONFIG, DEFAULT_CONFIG)).toEqual([]);
    expect(configDiff(DEFAULT_CONFIG, { ...DEFAULT_CONFIG, datanodes: 4, mongodb: true, blockSize: '128m' })).toEqual([
      { field: 'datanodes', label: 'DataNodes', from: '3', to: '4' },
      { field: 'blockSize', label: 'Bloque', from: '1 MB', to: '128 MB' },
      { field: 'mongodb', label: 'MongoDB', from: 'no', to: 'sí' },
    ]);
  });
});

describe('composeYaml', () => {
  it('sin tag usa full, como SANDBOX_VERSION en el backend', () => {
    const y = composeYaml(DEFAULT_CONFIG);
    expect(y).toContain('# BigData Sandbox :full,');
    expect(y).toContain('    image: franki678/bigdata-sandbox:full\n');
  });

  it('monta datos/ y publica JupyterLab aunque esté apagado (se puede prender después)', () => {
    for (const jupyter of [true, false]) {
      const y = composeYaml({ ...DEFAULT_CONFIG, jupyter });
      expect(y).toContain('./datos:/datos');
      expect(y).toContain('"127.0.0.1:8888:8888"');
    }
    expect(composeYaml({ ...DEFAULT_CONFIG, jupyter: false })).toContain('# JupyterLab (con JUPYTER: "si")');
  });

  it('toma el tag de la imagen que corre', () => {
    const y = composeYaml(DEFAULT_CONFIG, 'empresa');
    expect(y).toContain('# BigData Sandbox :empresa,');
    expect(y).toContain('    image: franki678/bigdata-sandbox:empresa\n');
    expect(y).not.toContain(':full');
  });
});
