import { useEffect, useMemo, useState, type HTMLAttributes, type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, FileCode2, Play, RotateCcw, Trash2 } from 'lucide-react';
import type { ClusterConfig, ConfigIssue, RamEstimate, Services } from '../api/types';
import { api } from '../api';
import { useStatus } from '../state/store';
import { composeDraft, composeOpen } from '../state/ui';
import { applyConfig, resetVolume, startCluster } from '../state/actions';
import { Meter, Seg, Stepper, Switch, Tip } from '../components/ui';
import { BLOCK_PRESETS, blockSizeLabel, configSummary, processSpecs } from '../lib/cluster';
import { nf } from '../lib/format';
import { Mimic, MimicLegend, type Highlight } from '../widgets/Mimic';

const SERVICES: { value: Services; title: string; ram: string; text: string }[] = [
  { value: 'hdfs', title: 'hdfs', ram: '4 GB', text: 'Solo HDFS. El más liviano y el que más rápido arranca.' },
  { value: 'mapreduce', title: 'mapreduce', ram: '5 GB', text: 'Suma YARN, MapReduce, Pig, Sqoop y MySQL.' },
  { value: 'todo', title: 'todo', ram: '6 GB', text: 'Suma Hive (sobre Tez) y Spark. Hive tarda ~1 min en arrancar.' },
];

export function ConfigPage() {
  const s = useStatus();
  const [draft, setDraft] = useState<ClusterConfig | null>(null);
  const [issues, setIssues] = useState<ConfigIssue[]>([]);
  const [ram, setRam] = useState<RamEstimate | null>(null);
  const [customBs, setCustomBs] = useState('');
  const [hl, setHl] = useState<Highlight>(null);
  const base = s?.config;
  const dirty = !!(draft && base && JSON.stringify(draft) !== JSON.stringify(base));
  useEffect(() => { if (base && !dirty) setDraft({ ...base }); }, [base ? JSON.stringify(base) : '']); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!draft) return;
    let live = true;
    Promise.all([api().validate(draft), api().estimate(draft)]).then(([i, r]) => { if (live) { setIssues(i); setRam(r); } });
    composeDraft.set(draft);
    return () => { live = false; };
  }, [draft]);
  useEffect(() => () => composeDraft.set(null), []);
  const procs = useMemo(() => (draft ? processSpecs(draft) : []), [draft]);
  if (!s || !draft) return null;
  const set = <K extends keyof ClusterConfig>(k: K, v: ClusterConfig[K]) => setDraft(d => ({ ...d!, [k]: v }));
  const issue = (f: keyof ClusterConfig) => issues.find(i => i.field === f);
  const errors = issues.filter(i => i.level === 'error');
  const busy = s.phase === 'starting' || s.phase === 'stopping';
  const nnLocked = s.volumeNameNodes != null;
  const hlp = (k: keyof ClusterConfig) => ({ onMouseEnter: () => setHl(k), onMouseLeave: () => setHl(null), onFocus: () => setHl(k), onBlur: () => setHl(null) });
  const ramK = ram ? (ram.totalMb > ram.limitMb ? 'bad' : ram.totalMb > ram.limitMb * .85 ? 'run' : 'ok') : undefined;
  return (
    <div className="split">
    <div className="split-main">
    <div className="page-in">
      <div className="page-head">
        <div><h1>Configuración</h1><p>Las variables de entorno del contenedor. Se aplican reiniciando el cluster; los datos quedan en el volumen.</p></div>
        <div className="page-actions"><button className="btn" type="button" onClick={() => composeOpen.set(true)}><FileCode2 size={15} />Ver docker-compose.yml</button></div>
      </div>
      {busy && <div className="callout" data-k="run"><AlertTriangle size={14} /><span>El cluster está {s.phase === 'starting' ? 'arrancando' : 'apagándose'}. Podés preparar cambios, pero se aplican cuando termine.</span></div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="panel" aria-labelledby="h-hdfs">
            <div className="panel-h"><h2 id="h-hdfs">HDFS</h2><span className="sub">almacenamiento distribuido</span></div>
            <div className="panel-b" style={{ paddingTop: 0, paddingBottom: 0 }}>
              <Field hlProps={hlp('datanodes')} id="f-dn" label="DataNodes" env="DATANODES" hint="Procesos que guardan los bloques. Cada uno tiene su carpeta y su página, y suma unos 250 MB." issue={issue('datanodes')} note={`Páginas en localhost:9901${draft.datanodes > 1 ? `–990${draft.datanodes}` : ''}`}>
                <Stepper id="f-dn" value={draft.datanodes} min={1} max={9} onChange={v => set('datanodes', v)} label="DataNodes" />
              </Field>
              <Field hlProps={hlp('replication')} id="f-rep" label="Réplicas por bloque" env="REPLICATION" hint="Copias de cada bloque, cada una en un DataNode distinto. Con 2 o más, si se cae un nodo no se pierde nada." issue={issue('replication')} note={draft.replication > 1 && draft.replication <= draft.datanodes ? `Aguanta ${draft.replication - 1} DataNode${draft.replication > 2 ? 's' : ''} caído${draft.replication > 2 ? 's' : ''}` : undefined}>
                <Stepper id="f-rep" value={draft.replication} min={1} max={9} onChange={v => set('replication', v)} label="réplicas" />
              </Field>
               <Field stack hlProps={hlp('blockSize')} id="f-bs" label="Tamaño de bloque" env="BLOCK_SIZE" hint="HDFS corta cada archivo en bloques de este tamaño. 1 MB para ver muchos bloques con archivos chicos; 128 MB es el de un cluster real." issue={issue('blockSize')} note={`ventas_grandes.csv (5,9 MB) → ${Math.ceil(5.93 / (parseInt(draft.blockSize, 10) * (/g$/i.test(draft.blockSize) ? 1024 : 1) || 128))} bloque(s)`}>
                <Seg value={BLOCK_PRESETS.includes(draft.blockSize) && ['1m', '16m', '128m', '1g'].includes(draft.blockSize) ? draft.blockSize : 'otro'} onChange={v => { if (v !== 'otro') { set('blockSize', v); setCustomBs(''); } }} label="Tamaño de bloque"
                  options={[{ value: '1m', label: '1 MB' }, { value: '16m', label: '16 MB' }, { value: '128m', label: '128 MB' }, { value: '1g', label: '1 GB' }, { value: 'otro', label: 'otro' }]} />
                <span className="inline-input"><input className="input" aria-label="Otro tamaño de bloque" placeholder="ej. 8m" value={customBs || (['1m', '16m', '128m', '1g'].includes(draft.blockSize) ? '' : draft.blockSize)} aria-invalid={issue('blockSize')?.level === 'error'}
                  onChange={e => { const v = e.target.value.trim().toLowerCase(); setCustomBs(v); if (v) set('blockSize', v); }} /></span>
              </Field>
              <Field hlProps={hlp('namenodes')} id="f-nn" label="NameNodes" env="NAMENODES" hint="Con 2 o 3 se arma alta disponibilidad: uno activo y el resto en espera, con ZooKeeper y 3 JournalNodes. Pide unos 8 GB." issue={issue('namenodes')} note={nnLocked && !issue('namenodes') ? `Fijo en el volumen (${s.volumeNameNodes})` : undefined}>
                <Seg value={String(draft.namenodes)} onChange={v => set('namenodes', +v)} label="NameNodes" size="lg"
                  options={[1, 2, 3].map(n => ({ value: String(n), label: n === 1 ? '1' : `${n} · HA`, disabled: nnLocked && n !== s.volumeNameNodes, tip: nnLocked && n !== s.volumeNameNodes ? 'Quedó fijo al crear el volumen. Para cambiarlo, borrá el volumen (abajo).' : undefined }))} />
              </Field>
            </div>
          </section>
          <section className="panel" aria-labelledby="h-svc">
            <div className="panel-h"><h2 id="h-svc">Servicios</h2><span className="sub">qué se prende además de HDFS</span></div>
            <div className="panel-b" style={{ paddingTop: 0, paddingBottom: 0 }}>
              <div className="field" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }} {...hlp('services')}>
                <div className="field-l"><span className="label" id="l-serv">Stack <span className="env">SERVICIOS</span></span><span className="hint">Pig y Sqoop no son servicios: mandan trabajos MapReduce a YARN.</span></div>
                <div className="cards" role="radiogroup" aria-labelledby="l-serv">
                  {SERVICES.map(o => <button key={o.value} type="button" role="radio" aria-checked={draft.services === o.value} className="card-opt" data-state={draft.services === o.value ? 'on' : 'off'} onClick={() => set('services', o.value)}><b>{o.title}<small>{o.ram}</small></b><span>{o.text}</span></button>)}
                </div>
              </div>
              <Field hlProps={hlp('mongodb')} id="f-mongo" label="MongoDB" env="MONGODB" hint="Base de documentos en el 27017, con la base tienda (20.000 pedidos). Suma unos 500 MB." issue={issue('mongodb')}>
                <Switch checked={draft.mongodb} onChange={v => set('mongodb', v)} label="MongoDB" />
              </Field>
              <Field hlProps={hlp('jupyter')} id="f-jup" label="JupyterLab" env="JUPYTER" hint="Notebooks de Python en el 8888, con pandas, scikit-learn y PySpark." issue={issue('jupyter')}>
                <Switch checked={draft.jupyter} onChange={v => set('jupyter', v)} label="JupyterLab" />
              </Field>
            </div>
          </section>
          <section className="panel" aria-labelledby="h-adv">
            <div className="panel-h"><h2 id="h-adv">Avanzado</h2></div>
            <div className="panel-b" style={{ paddingTop: 0, paddingBottom: 0 }}>
              <Field id="f-pig" label="Memoria del comando pig" env="PIG_HEAPSIZE" hint="La del programa pig mismo, no la de sus trabajos (esa la pone YARN). Subila solo si pig se queda sin memoria armando el plan." issue={issue('pigHeapsize')}>
                <Seg value={String(draft.pigHeapsize)} onChange={v => set('pigHeapsize', +v)} label="Memoria de pig" options={[512, 1024, 2048].map(v => ({ value: String(v), label: `${v} MB` }))} />
              </Field>
            </div>
          </section>
          <section className="panel" aria-labelledby="h-danger" style={{ borderColor: 'var(--bad-line)' }}>
            <div className="panel-h"><h2 id="h-danger">Empezar de cero</h2></div>
            <div className="panel-b" style={{ display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <p className="dim" style={{ maxWidth: '60ch' }}>Borra el volumen: HDFS, las tablas de Hive, MySQL y MongoDB. Hace falta para cambiar la cantidad de NameNodes. Equivale a <span className="mono">docker compose down -v</span>.</p>
              <Tip content={s.phase !== 'stopped' ? 'Primero detené el cluster' : undefined}><span tabIndex={s.phase !== 'stopped' ? 0 : -1}><button className="btn btn-danger" type="button" disabled={s.phase !== 'stopped' || s.volumeNameNodes == null} onClick={resetVolume}><Trash2 size={15} />Borrar el volumen</button></span></Tip>
            </div>
          </section>
        </div>

      {dirty && (
        <div className="savebar" role="region" aria-label="Cambios sin aplicar">
          <AlertCircle size={16} className="muted" />
          <span>{errors.length ? `${errors.length} campo${errors.length > 1 ? 's' : ''} con error` : 'Tenés cambios sin aplicar'}</span>
          <span className="grow" />
          <button className="btn btn-ghost" type="button" onClick={() => { setDraft({ ...base! }); setCustomBs(''); }}><RotateCcw size={14} />Descartar</button>
          {s.phase === 'stopped' ? <>
            <button className="btn" type="button" disabled={errors.length > 0} onClick={() => applyConfig(draft)}>Guardar</button>
            <button className="btn btn-primary" type="button" disabled={errors.length > 0} onClick={() => startCluster(draft)}><Play size={15} />Guardar e iniciar</button>
          </> : <button className="btn btn-primary" type="button" disabled={errors.length > 0 || busy} onClick={() => applyConfig(draft)}>Aplicar y reiniciar</button>}
        </div>
      )}
    </div>
    </div>
    <aside className="split-side" aria-label="Arquitectura">
      <div className="split-side-in">
        <section className="panel" aria-labelledby="h-arq">
          <div className="panel-h"><h2 id="h-arq">Arquitectura</h2><span className="sub">{dirty && s.phase !== 'stopped' ? 'cómo queda con tus cambios' : 'cómo queda armado'}</span>{dirty && <span className="end"><span className="badge" data-k="run">sin aplicar</span></span>}</div>
          <div className="panel-b" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <MimicLegend />
            <Mimic config={draft} base={s.phase === 'running' || s.phase === 'starting' ? base : null} highlight={hl} />
            <p className="muted" style={{ fontSize: 12 }}>Pasá el mouse por un campo de la izquierda para ver qué parte cambia, o por un bloque para ver dónde están sus copias.</p>
          </div>
        </section>
        <section className="panel" aria-labelledby="h-sum">
          <div className="panel-h"><h2 id="h-sum">Memoria</h2><span className="sub">estimada para Docker · {procs.length - 1} procesos</span></div>
          <div className="panel-b" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ram && <>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                <div className="ram-big">{nf(ram.totalMb / 1024, 1)}<small>GB de {nf(ram.limitMb / 1024, 1)}</small></div>
                <span style={{ fontSize: 12, color: ramK === 'bad' ? 'var(--bad-text)' : ramK === 'run' ? 'var(--run-text)' : 'var(--ok-text)' }}>{ramK === 'ok' ? 'Entra con margen' : ramK === 'run' ? 'Entra justo' : 'No entra'}</span>
              </div>
              <Meter value={ram.totalMb} max={ram.limitMb * 1.3} mark={ram.limitMb} kind={ramK} label="RAM estimada" />
              <details className="ram-det"><summary>Ver de dónde sale</summary><ul className="ram-parts">{ram.parts.map(p => <li key={p.label}><span>{p.label}</span><span>{nf(p.mb / 1024, 2)} GB</span></li>)}</ul></details>
            </>}
            <p className="muted" style={{ fontSize: 12 }}>{configSummary(draft)} · bloque {blockSizeLabel(draft.blockSize)}</p>
          </div>
        </section>
        {s.phase === 'stopped' && !dirty && <button className="btn btn-primary" type="button" onClick={() => startCluster(draft)} disabled={errors.length > 0}><Play size={15} />Iniciar con esta configuración</button>}
      </div>
    </aside>
    </div>
  );
}

function Field({ id, label, env, hint, issue, note, children, hlProps, stack }: { id: string; label: string; env: string; hint: string; issue?: ConfigIssue; note?: string; children: ReactNode; hlProps?: HTMLAttributes<HTMLDivElement>; stack?: boolean }) {
  return (
    <div className={`field${stack ? ' stack' : ''}`} {...hlProps}>
      <div className="field-l"><label htmlFor={id}>{label} <span className="env">{env}</span></label><span className="hint">{hint}</span></div>
      <div className="field-c">{children}</div>
      {issue ? <p className="field-msg" data-k={issue.level} role={issue.level === 'error' ? 'alert' : undefined}>{issue.level === 'error' ? <AlertCircle size={13} /> : <AlertTriangle size={13} />}{issue.message}</p>
        : note ? <p className="field-msg muted">{note}</p> : null}
    </div>
  );
}
