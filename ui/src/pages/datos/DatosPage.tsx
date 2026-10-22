/* Datos: catálogo de Hive, MySQL y MongoDB, esquema de cada tabla, editor de consultas con resultado, plan y trace. */
import { useEffect, useRef, useState } from 'react';
import { Database, GitBranch, Loader2, Play, Power } from 'lucide-react';
import type { CatalogEntry, DataSource, Engine, QueryPlan, QueryResult, TableSchema } from '../../api/types';
import { api } from '../../api';
import { errorCode } from '../../api/errors';
import { EngineTag, SampleTable, TraceView } from '../../components/Trace';
import { CodeBlock, Dot, Empty, Kbd, Meter, Seg, Tip } from '../../components/ui';
import { HELP } from '../../help/content';
import { navigate } from '../../state/ui';
import { useStatus } from '../../state/store';
import { useApi } from '../../state/useApi';
import { nf, sizeLabel } from '../../lib/format';
import { PlanTree } from './PlanTree';
import { ResultGrid } from './ResultGrid';
import './datos.css';

const SOURCES: DataSource[] = ['hive', 'mysql', 'mongodb'];
const SOURCE: Record<DataSource, string> = { hive: 'Hive', mysql: 'MySQL', mongodb: 'MongoDB' };
/** Proceso que atiende cada motor y su puerto */
const PROC: Record<DataSource, { id: string; port: number }> = { hive: { id: 'hiveserver2', port: 10000 }, mysql: { id: 'mysql', port: 3306 }, mongodb: { id: 'mongodb', port: 27017 } };
/** Quién resuelve las consultas: Hive las pasa a Tez si hay que agrupar u ordenar; MySQL y MongoDB, en su propio proceso */
const ENGINE: Record<DataSource, Engine> = { hive: 'tez', mysql: 'uno', mongodb: 'uno' };
const CLIENT: Record<DataSource, string> = { hive: 'beeline -u jdbc:hive2://localhost:10000', mysql: 'mysql tienda', mongodb: 'mongosh tienda' };
const PLACEHOLDER: Record<DataSource, string> = { hive: 'SELECT sucursal, SUM(cantidad) FROM ventas GROUP BY sucursal;', mysql: 'SELECT * FROM clientes LIMIT 10;', mongodb: 'db.pedidos.find({ cliente_id: 42 })' };

const short = (name: string) => name.split('.').slice(1).join('.') || name;
const starter = (s: DataSource, name: string) => (s === 'mongodb' ? `db.${short(name)}.find().limit(10)` : `SELECT * FROM ${short(name)} LIMIT 10;`);

type Tab = 'res' | 'plan' | 'trace';
interface Failure { code: string; message: string; source: DataSource; what: 'consulta' | 'plan' }

export function DatosPage() {
  const status = useStatus();
  const phase = status?.phase ?? 'stopped';
  const up = phase === 'running';
  const [source, setSource] = useState<DataSource>('hive');
  const [sel, setSel] = useState<{ source: DataSource; name: string } | null>(null);
  const [texts, setTexts] = useState<Record<DataSource, string>>({ hive: '', mysql: '', mongodb: '' });
  const text = texts[source];
  const setText = (v: string) => setTexts(t => ({ ...t, [source]: v }));

  const refresh = (e: { type: string }) => e.type === 'step' || e.type === 'hdfs' || e.type === 'status';
  const catalog = useApi(a => (up ? a.catalog() : Promise.resolve([])), [up], refresh);
  const examples = useApi(a => a.queryExamples(), []);
  const schema = useApi(a => (up && sel ? a.schema(sel.source, sel.name) : Promise.resolve(null)), [sel?.source, sel?.name, up]);

  const pick = (c: CatalogEntry) => {
    setSel({ source: c.source, name: c.name });
    setSource(c.source);
    setTexts(t => (t[c.source].trim() ? t : { ...t, [c.source]: starter(c.source, c.name) }));
  };

  // Si la tabla elegida desaparece del catálogo (se apagó su motor o se reinició el pipeline), se suelta
  useEffect(() => {
    if (sel && catalog.data && !catalog.data.some(c => c.source === sel.source && c.name === sel.name)) setSel(null);
  }, [catalog.data, sel]);

  return (
    <div className="page-in">
      <div className="page-head">
        <div><h1>Datos</h1><p>{HELP.datos.intro}</p></div>
        {up && <div className="page-actions"><span className="muted" style={{ fontSize: 12 }}>{nf(catalog.data?.length ?? 0)} tablas y colecciones</span></div>}
      </div>
      {!up ? (
        <section className="panel">
          {phase === 'starting'
            ? <Empty icon={<Loader2 size={20} className="spin" />} title="El cluster está arrancando">El catálogo aparece cuando HiveServer2, MySQL y MongoDB respondan.</Empty>
            : <Empty icon={<Database size={20} />} title="El cluster está apagado" action={<button className="btn btn-sm" type="button" onClick={() => navigate('cluster')}><Power size={12} />Ir a Cluster</button>}>
                Hive, MySQL y MongoDB corren adentro del cluster: prendelo para ver sus tablas y consultarlas.
              </Empty>}
        </section>
      ) : (
        <div className="grid cols-12">
          <section className="panel span-4">
            <div className="panel-h"><h2>Catálogo</h2><span className="sub">por motor</span></div>
            <div className="panel-b flush">
              <Catalog entries={catalog.data} error={catalog.error} sel={sel} onPick={pick} />
            </div>
          </section>
          <section className="panel span-8">
            <SchemaPanel sel={sel} data={schema.data ?? null} loading={schema.loading} error={schema.error} />
          </section>
          <QueryPanel source={source} setSource={s => setSource(s)} text={text} setText={setText}
            examples={(examples.data ?? []).filter(x => x.source === source)}
            available={(catalog.data ?? []).some(c => c.source === source) || procState(status?.processes, source) === 'up'} />
        </div>
      )}
    </div>
  );
}

function procState(ps: { id: string; state: string }[] | undefined, s: DataSource) { return ps?.find(p => p.id === PROC[s].id)?.state; }

/* ---------- Catálogo ---------- */

function Catalog({ entries, error, sel, onPick }: { entries: CatalogEntry[] | undefined; error: string | null; sel: { source: DataSource; name: string } | null; onPick: (c: CatalogEntry) => void }) {
  const status = useStatus();
  if (error) return <div className="callout" data-k="bad" style={{ margin: 14 }}><span>{error}</span></div>;
  if (!entries) return <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>{[0, 1, 2, 3].map(i => <div key={i} className="skel" style={{ height: 22 }} />)}</div>;
  return (
    <div className="cat">
      {SOURCES.map(s => {
        const st = procState(status?.processes, s);
        const items = entries.filter(c => c.source === s);
        const msg = st == null ? (s === 'mongodb' && !status?.config.mongodb ? 'No está en esta configuración (MONGODB=no).' : 'No está en esta configuración: hace falta SERVICIOS=todo.')
          : st !== 'up' ? `${PROC[s].id} está ${st === 'starting' ? 'arrancando' : st === 'stopping' ? 'parando' : 'apagado'}: prendelo desde Cluster.`
          : !items.length ? (s === 'hive' ? 'Sin tablas: corré el pipeline para crearlas sobre HDFS.' : 'Sin tablas.') : null;
        return (
          <div key={s} className="cat-g">
            <div className="cat-gh">
              <Dot s={st ?? 'off'} label={`${PROC[s].id}: ${st ?? 'no configurado'}`} />
              <b>{SOURCE[s]}</b>
              <EngineTag engine={ENGINE[s]} />
              <span className="proc">{PROC[s].id}:{PROC[s].port}</span>
              <span className="n">{items.length || ''}</span>
            </div>
            {msg && <p className="cat-msg" data-k={st != null && st !== 'up' ? 'bad' : undefined}>{msg}</p>}
            {items.length > 0 && (
              <ul className="cat-list">
                {items.map(c => (
                  <li key={c.name}>
                    <button type="button" className="cat-item" aria-current={sel?.source === s && sel.name === c.name} onClick={() => onPick(c)}>
                      <span className="nm">{c.name}</span>
                      <span className="k">{c.kind}</span>
                      <span className="r" title={c.rows == null ? 'Sin estadísticas (ANALYZE TABLE … COMPUTE STATISTICS)' : undefined}>{c.rows == null ? '—' : nf(c.rows)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Esquema ---------- */

type SchTab = 'cols' | 'sample' | 'ddl';

function SchemaPanel({ sel, data, loading, error }: { sel: { source: DataSource; name: string } | null; data: TableSchema | null; loading: boolean; error: string | null }) {
  const [tab, setTab] = useState<SchTab>('cols');
  if (!sel) return <>
    <div className="panel-h"><h2>Esquema</h2></div>
    <div className="panel-b"><Empty icon={<Database size={20} />} title="Elegí una tabla o colección">Se ven sus columnas con tipo y clave, una muestra y el DDL.</Empty></div>
  </>;
  const mongo = sel.source === 'mongodb';
  return <>
    <div className="panel-h">
      <h2 className="mono">{sel.name}</h2>
      <span className="end tabs-h">
        <Seg value={tab} onChange={setTab} label="Vista del esquema" options={[{ value: 'cols', label: mongo ? 'campos' : 'columnas' }, { value: 'sample', label: 'muestra' }, { value: 'ddl', label: mongo ? 'índices' : 'ddl' }]} />
      </span>
    </div>
    {error ? <div className="panel-b"><div className="callout" data-k="bad"><span>{error}</span></div></div>
      : !data || (loading && data.name !== sel.name) ? <div className="panel-b" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{[0, 1, 2].map(i => <div key={i} className="skel" style={{ height: 22 }} />)}</div>
      : <>
        <div className="sch-meta">
          <span>{data.kind}</span>
          {data.format && <span>formato<b>{data.format}</b></span>}
          <span>{mongo ? 'documentos' : 'filas'}<b>{data.rows == null ? 'sin estadísticas' : nf(data.rows)}</b></span>
          {data.sizeMb != null && <span>tamaño<b>{sizeLabel(data.sizeMb)}</b></span>}
          {data.location && <span className="mono">hdfs<b>{data.location}</b></span>}
        </div>
        {tab === 'cols' && <>
          <div className="tbl-wrap">
            <table className="tbl" aria-label={`Columnas de ${data.name}`}>
              <thead><tr><th>{mongo ? 'campo' : 'columna'}</th><th>tipo</th>{mongo ? <th>presencia</th> : <th>nulos</th>}<th>clave</th><th>comentario</th></tr></thead>
              <tbody>
                {data.columns.map(c => (
                  <tr key={c.name}>
                    <td className="mono">{c.name}</td>
                    <td className="mono muted">{c.type}</td>
                    {mongo ? <td>{c.presence != null ? <span className="presence"><Meter value={c.presence} max={100} label={`${c.name} aparece en el ${nf(c.presence)} %`} /><span className="muted">{nf(c.presence)} %</span></span> : '—'}</td>
                      : <td className="muted">{c.nullable === false ? 'not null' : c.nullable ? 'sí' : '—'}</td>}
                    <td>{c.key ? <span className="tag">{c.key === 'PK' ? 'pk' : 'índice'}</span> : ''}</td>
                    <td className="muted">{c.comment ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(data.indexes?.length || data.partitions?.length) ? (
            <div className="sch-side">
              {data.indexes?.length ? <><h3>índices</h3>{data.indexes.map(i => <div key={i.name} className="sch-idx"><span className="mono">{i.name}</span><span className="muted mono">({i.columns.join(', ')})</span>{i.unique && <span className="tag">único</span>}</div>)}</> : null}
              {data.partitions?.length ? <><h3>particiones</h3><span className="mono muted">{data.partitions.join('  ')}</span></> : null}
            </div>
          ) : null}
        </>}
        {tab === 'sample' && <SampleTable sample={data.sample} label={`Muestra de ${data.name}`} />}
        {tab === 'ddl' && <div className="panel-b">{data.ddl ? <div className="ddl"><CodeBlock lines={data.ddl.split('\n')} prompt={null} label="DDL" /></div>
          : mongo && data.indexes ? <CodeBlock lines={data.indexes.map(i => `db.${short(data.name)}.createIndex({ ${i.columns.map(c => `"${c}": 1`).join(', ')} }${i.unique ? ', { unique: true }' : ''})`)} prompt={null} label="Índices" />
          : <span className="muted">Sin DDL.</span>}</div>}
      </>}
  </>;
}

/* ---------- Editor, resultado, plan y trace ---------- */

function QueryPanel({ source, setSource, text, setText, examples, available }: {
  source: DataSource; setSource: (s: DataSource) => void; text: string; setText: (v: string) => void;
  examples: { label: string; text: string; script?: string }[]; available: boolean;
}) {
  const [tab, setTab] = useState<Tab>('res');
  const [res, setRes] = useState<(QueryResult & { source: DataSource }) | null>(null);
  const [plan, setPlan] = useState<QueryPlan | null>(null);
  const [err, setErr] = useState<Failure | null>(null);
  const [running, setRunning] = useState<{ what: 'consulta' | 'plan'; t0: number } | null>(null);
  const [now, setNow] = useState(0);
  const gutter = useRef<HTMLPreElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [running]);

  async function exec(what: 'consulta' | 'plan') {
    if (!text.trim() || running) return;
    const src = source, q = text;
    setRunning({ what, t0: Date.now() });
    setNow(Date.now());
    setErr(null);
    setTab(what === 'plan' ? 'plan' : 'res');
    try {
      if (what === 'plan') setPlan(await api().explain(src, q));
      else { setRes({ ...(await api().query(src, q)), source: src }); setPlan(null); }
    } catch (e) {
      setErr({ code: errorCode(e) ?? 'failed', message: e instanceof Error ? e.message : String(e), source: src, what });
    } finally { setRunning(null); }
  }

  const lines = Math.max(6, text.split('\n').length);
  const hasRes = !!res || !!err || !!running;

  return (
    <section className="panel span-12">
      <div className="panel-h">
        <h2>Consulta</h2>
        <span className="qe-src">
          <Seg value={source} onChange={setSource} label="Motor de la consulta" options={SOURCES.map(s => ({ value: s, label: SOURCE[s] }))} />
          <EngineTag engine={ENGINE[source]} />
        </span>
        <span className="end">
          <select className="btn btn-sm" aria-label="Ejemplos" value="" disabled={!examples.length} onChange={e => { const x = examples[Number(e.target.value)]; if (x) { setText(x.text); area.current?.focus(); } }}>
            <option value="">ejemplos ({examples.length})</option>
            {examples.map((x, i) => <option key={i} value={i}>{x.label}</option>)}
          </select>
          <Tip content={<>Ver el plan sin correrla <Kbd k="Ctrl+Shift+Enter" /></>}>
            <button className="btn btn-sm" type="button" disabled={!!running || !text.trim() || !available} onClick={() => exec('plan')}><GitBranch size={12} />Plan</button>
          </Tip>
          <Tip content={<>Correr <Kbd k="Ctrl+Enter" /></>}>
            <button className="btn btn-sm btn-primary" type="button" disabled={!!running || !text.trim() || !available} onClick={() => exec('consulta')}><Play size={12} />Correr</button>
          </Tip>
        </span>
      </div>
      <div className="panel-b" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="qe">
          <pre className="qe-gutter" ref={gutter} aria-hidden="true">{Array.from({ length: lines }, (_, i) => i + 1).join('\n')}</pre>
          <textarea ref={area} aria-label={`Consulta para ${SOURCE[source]}`} spellCheck={false} rows={lines} value={text} placeholder={PLACEHOLDER[source]}
            onChange={e => setText(e.target.value)}
            onScroll={e => { if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop; }}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); exec(e.shiftKey ? 'plan' : 'consulta'); }
              else if (e.key === 'Tab' && !e.shiftKey) {
                e.preventDefault();
                const el = e.currentTarget, a = el.selectionStart, b = el.selectionEnd;
                setText(text.slice(0, a) + '  ' + text.slice(b));
                requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + 2; });
              }
            }} />
        </div>
        <div className="qe-bar">
          <span className="cmd">$ {CLIENT[source]}</span>
          <span className="grow" />
          {!available && <span style={{ color: 'var(--bad-text)' }}>{PROC[source].id} no responde</span>}
          <span><Kbd k="Ctrl+Enter" /> correr · <Kbd k="Ctrl+Shift+Enter" /> plan</span>
        </div>
      </div>
      {(hasRes || plan) && (
        <div style={{ borderTop: '1px solid var(--line-soft)' }}>
          <div className="res-h">
            <Seg value={tab} onChange={setTab} label="Vista del resultado" options={[
              { value: 'res', label: 'resultado' },
              { value: 'plan', label: 'plan', disabled: !plan && !(err?.what === 'plan') && running?.what !== 'plan' },
              { value: 'trace', label: 'trace', disabled: !res?.trace },
            ]} />
            {res && !running && !err && tab !== 'plan' && <>
              <span><b>{nf(res.rows.length)}</b> {res.source === 'mongodb' ? 'documentos' : 'filas'}</span>
              {res.scanned != null && <span>leyó <b>{nf(res.scanned)}</b></span>}
              <span><b>{res.ms < 1000 ? `${nf(res.ms)} ms` : `${nf(res.ms / 1000, 1)} s`}</b></span>
              {res.engine && <EngineTag engine={res.engine} />}
              {res.appId && <span className="mono">{res.appId}</span>}
            </>}
            {res?.note && !running && !err && tab === 'res' && <span className="end muted">{res.note}</span>}
          </div>
          {running && (tab === 'res' || tab === 'plan') ? (
            <div className="res-run"><Dot s="running" />{running.what === 'plan' ? 'Pidiendo el plan' : 'Corriendo'} en {SOURCE[source]}<span className="mono muted">{nf((now - running.t0) / 1000, 1)} s</span>
              {source === 'hive' && running.what === 'consulta' && now - running.t0 > 3000 && <span className="muted">· si lanza un trabajo de Tez, abrir la sesión en YARN lleva 10–20 s</span>}</div>
          ) : err && (tab === 'res' || (tab === 'plan' && err.what === 'plan')) ? (
            <div className="callout res-err" data-k="bad" role="alert">
              <span className="head"><span className="badge" data-k="bad">{err.code}</span><b>{err.what === 'plan' ? 'El plan' : 'La consulta'} falló en {SOURCE[err.source]}</b></span>
              <span className="msg">{err.message}</span>
            </div>
          ) : tab === 'plan' && plan ? <PlanTree plan={plan} />
            : tab === 'trace' && res?.trace ? <div className="panel-b"><TraceView trace={res.trace} /></div>
            : res ? <ResultGrid res={res} /> : null}
        </div>
      )}
    </section>
  );
}
