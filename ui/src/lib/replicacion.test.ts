/* El resumen de HDFS y el panel de la cola tienen que contar lo mismo: un sub-replicado sin adónde
   copiarse no es "re-replicando" ni "todo bien". */
import { describe, expect, it } from 'vitest';
import type { ReplicationState } from '../api/types';
import { replicationView } from './replicacion';

const st = (x: Partial<ReplicationState>): ReplicationState => ({ underReplicated: 0, pending: 0, missing: 0, overReplicated: 0, stale: [], tasks: [], recent: [], ...x });
const task = (state: 'pending' | 'running') => ({ block: 'blk_1', file: '/a', kind: 'copy' as const, from: 1, state });

describe('replicationView', () => {
  it('sano cuando no falta nada', () => {
    const v = replicationView(st({ noRoom: 0, liveDataNodes: 3 }));
    expect(v).toMatchObject({ k: 'ok', label: 'sano', sub: 'ninguno', stuck: 0 });
    expect(v.note).toBeUndefined();
    expect(v.empty).toMatch(/todos los bloques/);
  });

  it('sub-replicados sin adónde copiarse: lo dice y no dice que está todo bien', () => {
    const v = replicationView(st({ underReplicated: 4, noRoom: 4, liveDataNodes: 2 }));
    expect(v.label).toBe('faltan DataNodes');
    expect(v.sub).toBe('sin adónde copiarse');
    expect(v.note).toContain('4 bloques sub-replicados sin adónde copiarse: hay 2 DataNodes vivos');
    expect(v.empty).not.toMatch(/todos los bloques/);
    expect(v.copying).toBe(0);
  });

  it('parte trabada y parte copiándose', () => {
    const v = replicationView(st({ underReplicated: 5, noRoom: 2, liveDataNodes: 2, tasks: [task('running'), task('pending')], pending: 2 }));
    expect(v).toMatchObject({ label: 're-replicando', stuck: 2, copying: 3, sub: '2 sin adónde copiarse' });
    expect(v.note).toContain('2 bloques');
  });

  it('copiándose de verdad', () => {
    const v = replicationView(st({ underReplicated: 2, noRoom: 0, liveDataNodes: 3, tasks: [task('running')], pending: 1 }));
    expect(v).toMatchObject({ k: 'run', label: 're-replicando', sub: 'el NameNode los copia' });
    expect(v.note).toBeUndefined();
  });

  it('servidor viejo sin noRoom: no inventa bloques trabados', () => {
    const v = replicationView(st({ underReplicated: 2 }));
    expect(v.stuck).toBe(0);
    expect(v.label).toBe('faltan DataNodes');
  });

  it('perdidos', () => {
    expect(replicationView(st({ missing: 1 }))).toMatchObject({ k: 'bad', label: 'bloques perdidos' });
  });
});
