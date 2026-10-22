/* Cómo queda armado el cluster con una configuración: capas, rack de DataNodes con los
   bloques de ventas_grandes.csv repartidos, y lo que se agrega o se apaga respecto de la
   configuración que está corriendo. Se actualiza y se anima con cada cambio. */
import { useRef, useState, type ReactNode } from 'react';
import type { ClusterConfig } from '../api/types';
import { blockSizeLabel, blockSizeMb, processSpecs } from '../lib/cluster';
import { useFlip } from './useFlip';

const DATASET_MB = 5.93;
type Part = 'coord' | 'meta' | 'rack' | 'chips' | 'compute' | 'services' | 'mongo' | 'jupyter';
export type Highlight = keyof ClusterConfig | null;
const PARTS: Partial<Record<keyof ClusterConfig, Part[]>> = {
  datanodes: ['rack'], replication: ['chips'], blockSize: ['chips'], namenodes: ['coord', 'meta'],
  services: ['compute', 'services'], mongodb: ['mongo'], jupyter: ['jupyter'],
};

export function blockPlan(c: ClusterConfig) {
  const mb = blockSizeMb(c.blockSize) || 128;
  const blocks = Math.ceil(DATASET_MB / mb);
  const reps = Math.min(c.replication, c.datanodes);
  const per = Array.from({ length: c.datanodes }, () => [] as number[]);
  for (let b = 0; b < blocks; b++) for (let k = 0; k < reps; k++) per[(b + k) % c.datanodes].push(b + 1);
  return { mb, blocks, reps, per, missing: blocks * Math.max(0, c.replication - c.datanodes) };
}

type Tag = 'new' | 'gone' | undefined;

function Node({ name, sub, tag, off, eng, engName, role }: { name: string; sub: string; tag?: Tag; off?: boolean; eng?: string; engName?: string; role?: string }) {
  return (
    <div className="ap-node" data-tag={tag} data-off={off || undefined}>
      <span className="ap-name">{name}</span>
      <span className="ap-sub">{off ? 'apagado' : sub}{role && !off && <> · <em data-act={role === 'activo' || undefined}>{role}</em></>}</span>
      {eng && !off && <span className={`eng eng-${eng}`}>{engName}</span>}
      {tag && <span className="ap-tag">{tag === 'new' ? 'nuevo' : 'se apaga'}</span>}
    </div>
  );
}

function Layer({ title, hint, on, children, cols = 3 }: { title: string; hint: string; on: boolean; children: ReactNode; cols?: number }) {
  return (
    <div className="ap-layer" data-hl={on || undefined}>
      <div className="ap-l"><b>{title}</b><span>{hint}</span></div>
      <div className="ap-row" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>{children}</div>
    </div>
  );
}
const Link = ({ text, off }: { text: string; off?: boolean }) => <div className="ap-link" data-off={off || undefined}><span>{text}</span></div>;

export function ArchitecturePreview({ config: c, base, highlight }: { config: ClusterConfig; base?: ClusterConfig | null; highlight?: Highlight }) {
  const parts = new Set(highlight ? PARTS[highlight] || [] : []);
  const ids = new Set(processSpecs(c).map(s => s.id));
  const baseIds = base ? new Set(processSpecs(base).map(s => s.id)) : null;
  const tag = (id: string): Tag => (baseIds && !baseIds.has(id) && ids.has(id) ? 'new' : baseIds && baseIds.has(id) && !ids.has(id) ? 'gone' : undefined);
  const ha = c.namenodes > 1, yarn = c.services !== 'hdfs', todo = c.services === 'todo';
  const wasYarn = base ? base.services !== 'hdfs' : false, wasTodo = base?.services === 'todo';
  const plan = blockPlan(c);
  const rackRef = useRef<HTMLDivElement>(null);
  const [hb, setHb] = useState<string | null>(null);
  useFlip(rackRef, `${c.datanodes}|${c.replication}|${c.blockSize}`);
  const goneDns = base && base.datanodes > c.datanodes ? Array.from({ length: base.datanodes - c.datanodes }, (_, i) => c.datanodes + i + 1) : [];
  return (
    <div className="ap">
      {(ha || (base && base.namenodes > 1)) && (
        <>
          <Layer title="Coordinación" hint="elige al NameNode activo" on={parts.has('coord')} cols={4}>
            <Node name="ZooKeeper" sub=":2181" tag={tag('zk')} />
            {[1, 2, 3].map(i => <Node key={i} name={`JournalNode ${i}`} sub={`:${8479 + i}`} tag={tag(`jn${i}`)} />)}
          </Layer>
          <Link text="registro compartido de cambios" />
        </>
      )}
      <Layer title="Metadatos" hint={ha ? `${c.namenodes} NameNodes: alta disponibilidad` : 'qué bloque está dónde'} on={parts.has('meta')} cols={ha ? c.namenodes : 2}>
        {ha ? Array.from({ length: c.namenodes }, (_, i) => <Node key={i} name={`NameNode ${i + 1}`} sub={`:${9870 + i}`} role={i === 0 ? 'activo' : 'en espera'} tag={tag(`nn${i + 1}`)} />)
          : <><Node name="NameNode" sub=":9870 · RPC :9000" tag={tag('nn1')} /><Node name="Secondary NameNode" sub=":9868 · copia cada 5 min" tag={tag('snn')} /></>}
      </Layer>
      <Link text="latidos cada 3 s" />
      <div className="ap-layer" data-hl={parts.has('rack') || undefined}>
        <div className="ap-l"><b>Datos</b><span>{c.datanodes} DataNode{c.datanodes > 1 ? 's' : ''} en el rack</span></div>
        <div className="ap-rack" ref={rackRef} data-hl-chips={parts.has('chips') || undefined}>
          <div className="ap-rack-h"><span>Rack · bloque {blockSizeLabel(c.blockSize)} · réplica {c.replication}</span><span>ventas_grandes.csv, 5,9 MB</span></div>
          {plan.per.map((blocks, i) => (
            <div className="ap-unit" key={i} data-tag={tag(`dn${i + 1}`)}>
              <span className="ap-unit-n"><b>DataNode {i + 1}</b><span>:{9901 + i}</span></span>
              <span className="ap-chips">{blocks.map(n => <span key={n} className="ap-chip" data-flip={`b${n}@${i + 1}`} data-b={`b${n}`} data-hl={hb === `b${n}` || undefined} onMouseEnter={() => setHb(`b${n}`)} onMouseLeave={() => setHb(null)} title={`Bloque ${n} de ${plan.blocks}: copias en ${plan.per.map((l, k) => (l.includes(n) ? `DataNode ${k + 1}` : '')).filter(Boolean).join(', ')}`}>b{n}</span>)}</span>
              <span className="ap-unit-m">{blocks.length ? `${blocks.length} × ${plan.mb > DATASET_MB ? '5,9' : plan.mb} MB` : 'vacío'}</span>
              {tag(`dn${i + 1}`) && <span className="ap-tag">nuevo</span>}
            </div>
          ))}
          {goneDns.map(id => <div className="ap-unit" key={`g${id}`} data-tag="gone"><span className="ap-unit-n"><b>DataNode {id}</b><span>:{9900 + id}</span></span><span className="ap-chips" /><span className="ap-unit-m">sus copias se re-replican</span><span className="ap-tag">se apaga</span></div>)}
          {plan.missing > 0 && <div className="ap-missing"><span className="ap-chips">{Array.from({ length: Math.min(plan.missing, 12) }, (_, i) => <span key={i} className="ap-chip" data-miss>?</span>)}</span><span>Faltan {plan.missing} copias: pedís {c.replication} y hay {c.datanodes} DataNode{c.datanodes > 1 ? 's' : ''}</span></div>}
        </div>
      </div>
      <Link text="los trabajos leen bloques" off={!yarn} />
      <Layer title="Cómputo" hint={yarn ? 'YARN reparte 4 GB' : 'sin YARN con SERVICIOS=hdfs'} on={parts.has('compute')}>
        <Node name="ResourceManager" sub=":8088" off={!yarn} tag={yarn && !wasYarn && base ? 'new' : !yarn && wasYarn ? 'gone' : undefined} />
        <Node name="NodeManager" sub=":8042 · 4 GB" off={!yarn} eng="mr" engName="MapReduce, Pig, Sqoop" tag={yarn && !wasYarn && base ? 'new' : !yarn && wasYarn ? 'gone' : undefined} />
        <Node name="JobHistory" sub=":19888" off={!yarn} tag={yarn && !wasYarn && base ? 'new' : !yarn && wasYarn ? 'gone' : undefined} />
      </Layer>
      <Link text="Hive y Spark usan YARN" off={!todo} />
      <Layer title="Servicios" hint="consultas y bases" on={parts.has('services') || parts.has('mongo') || parts.has('jupyter')} cols={3}>
        <Node name="Hive" sub=":10000 · :10002" off={!todo} eng="tez" engName="motor Tez" tag={todo && !wasTodo && base ? 'new' : !todo && wasTodo ? 'gone' : undefined} />
        <Node name="Spark" sub=":18080 · :4040" off={!todo} eng="spark" engName="sobre YARN" tag={todo && !wasTodo && base ? 'new' : !todo && wasTodo ? 'gone' : undefined} />
        <Node name="MySQL" sub=":3306 · base tienda" off={!yarn} tag={yarn && !wasYarn && base ? 'new' : !yarn && wasYarn ? 'gone' : undefined} />
        <div className="ap-cell" data-hl={parts.has('mongo') || undefined}><Node name="MongoDB" sub=":27017 · base tienda" off={!c.mongodb} tag={tag('mongodb')} /></div>
        <div className="ap-cell" data-hl={parts.has('jupyter') || undefined}><Node name="JupyterLab" sub=":8888 · notebooks" off={!c.jupyter} tag={tag('jupyter')} /></div>
        <Node name="Esta interfaz" sub=":8080" />
      </Layer>
      <p className="ap-cap"><b>{plan.blocks} bloque{plan.blocks > 1 ? 's' : ''} × {plan.reps} réplica{plan.reps > 1 ? 's' : ''} = {plan.blocks * plan.reps} copias</b> de ventas_grandes.csv repartidas en {c.datanodes} DataNode{c.datanodes > 1 ? 's' : ''}. {plan.blocks > 1 ? `MapReduce lanzaría ${plan.blocks} mappers, uno por bloque.` : 'Entra en un solo bloque: MapReduce lanzaría un solo mapper.'}</p>
    </div>
  );
}
