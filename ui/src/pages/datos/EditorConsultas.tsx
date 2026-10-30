/* El editor de consultas, en dos pantallas: Lenguajes (Hive y Pig, que corren en el cluster) y Bases
   (MariaDB y MongoDB, de una sola máquina). Cada una con sus documentos, ejemplos, historial y consultas
   guardadas; el catálogo a la izquierda y el resultado abajo (tabla, plan, trace y log). */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, BookmarkPlus, Clock, Database, GitBranch, GitCompareArrows, Play, Plus, Search, Star, Table2, Trash2, Workflow, X } from 'lucide-react';
import type { CatalogEntry, ClusterPhase, DataSource, Engine, QueryExample, QueryPlan, QueryResult } from '../../api/types';
import { api } from '../../api';
import { errorCode } from '../../api/errors';
import { CapabilityNotice, Chip, CodeEditor, EmptyState, GatedButton, PageHeader, ResultTable, SkeletonLines } from '../../components/base';
import { EngineTag, TraceView } from '../../components/Trace';
import { Dot } from '../../components/ui';
import type { Capability } from '../../lib/capabilities';
import { nf } from '../../lib/format';
import { runFix, useCapabilities } from '../../state/capabilities';
import { useStatus } from '../../state/store';
import { navigate, setRouteArg, toast, useRouteArg } from '../../state/ui';
import { useApi } from '../../state/useApi';
import { PlanTree } from './PlanTree';
import {
  SOURCE_LABEL, addSaved, ago, argSource, loadDocs, loadHistory, loadSaved, newDoc, pushHistory, removeSaved,
  saveDocs, saveHistory, saveSaved, starter, suggestName, tomarPendiente, type HistoryEntry, type QueryDoc, type SavedQuery,
} from './consultas';
import './datos.css';

/** Quién resuelve: Hive pasa a Tez si hay que agrupar u ordenar; Pig compila a MapReduce; MariaDB y MongoDB, en su proceso */
const ENGINE: Record<DataSource, Engine> = { hive: 'tez', mysql: 'uno', mongodb: 'uno', pig: 'mr' };
const CLIENT: Record<DataSource, string> = { hive: 'beeline -u jdbc:hive2://localhost:10000', mysql: 'mysql tienda', mongodb: 'mongosh tienda', pig: 'pig -x mapreduce -f consulta.pig' };
const WHAT: Record<DataSource, string> = {
  hive: 'SQL sobre los archivos de HDFS',
  mysql: 'SQL sobre la base relacional tienda',
  mongodb: 'Documentos de la base tienda',
  pig: 'Scripts de flujo de datos sobre HDFS',
};
/* El editor vacío dice qué escribir, como comentario: un ejemplo en gris parecía escrito y no corría */
const PLACEHOLDER: Record<DataSource, string> = {
  hive: '-- Escribí SQL de Hive y corrélo con Ctrl+Enter, o elegí un ejemplo de arriba.\n-- Por ejemplo: SELECT sucursal, COUNT(*) FROM ventas GROUP BY sucursal;',
  mysql: '-- Escribí SQL de MariaDB (base tienda) y corrélo con Ctrl+Enter, o elegí un ejemplo de arriba.\n-- Por ejemplo: SELECT * FROM productos;',
  mongodb: '// Escribí una consulta de mongosh y corréla con Ctrl+Enter, o elegí un ejemplo de arriba.\n// Por ejemplo: db.pedidos.find({ cliente_id: 42 })',
  pig: "-- Escribí un script de Pig Latin y corrélo con Ctrl+Enter, o elegí un ejemplo de arriba.\n-- Por ejemplo: ventas = LOAD '/user/root/ventas' USING PigStorage(','); DUMP ventas;",
};
/** Qué se puede y qué no en cada motor, en una línea */
const RULES: Record<DataSource, string> = {
  hive: 'SELECT, CREATE, INSERT y DROP. Agrupar, unir u ordenar lanza un trabajo Tez en YARN.',
  mysql: 'SQL de MariaDB sobre la base tienda. Lo que escribas cambia la base de verdad.',
  mongodb: 'find, aggregate, countDocuments y explain. Una expresión por vez.',
  pig: 'LOAD, FILTER, GROUP, DUMP, STORE. Desde acá no se permite sh, exec, STREAM ni borrar fuera de /user.',
};

type ResTab = 'res' | 'plan' | 'trace' | 'log';
type SideTab = 'cat' | 'saved' | 'hist';
interface LogLine { at: number; k: 'ok' | 'bad' | 'run'; text: string }
interface DocState { res?: QueryResult; plan?: QueryPlan; err?: { code: string; message: string; what: 'consulta' | 'plan' }; tab: ResTab; log: LogLine[] }

export function LenguajesPage() {
  return (
    <EditorConsultas sources={['hive', 'pig']} title="Lenguajes"
      sub="Escribí SQL de Hive o scripts de Pig sobre los archivos de HDFS, y mirá el resultado, el plan y qué trabajo lanzó en YARN."
      help={<>Hive y Pig trabajan sobre los archivos de HDFS y lanzan trabajos en YARN (Tez y MapReduce). PySpark y MapReduce a mano se lanzan desde Trabajos. El historial y las guardadas quedan en este navegador.</>}
      intro={
        <Intro capa="lenguajes" links={[
          { icon: Table2, label: 'Las tablas, con su carpeta', go: () => navigate('tablas') },
          { icon: Workflow, label: 'PySpark y MapReduce a mano, en Trabajos', go: () => navigate('yarn') },
          { icon: GitCompareArrows, label: 'La misma cuenta en los cuatro', go: () => navigate('comparar', 'como-lo-pido') },
        ]}>
          <b>Le pedís la cuenta en un lenguaje y un motor la hace en el cluster.</b> Hive traduce el SQL a un trabajo de Tez; Pig traduce
          Pig Latin a trabajos de MapReduce. Los dos leen los archivos de HDFS y piden contenedores a YARN: tardan segundos, no milisegundos.
        </Intro>
      } />
  );
}

export function BasesPage() {
  return (
    <EditorConsultas sources={['mysql', 'mongodb']} title="Bases"
      sub="Consultá la base tienda en MariaDB (SQL) y en MongoDB (documentos): resultado, plan e índices, al instante."
      help={<>MariaDB y MongoDB resuelven en su propio proceso, sin YARN ni HDFS. Lo que escribas en MariaDB cambia la base de verdad. El historial y las guardadas quedan en este navegador.</>}
      intro={
        <Intro capa="datos" links={[
          { icon: Workflow, label: 'Copiar una tabla a HDFS con Sqoop', go: () => navigate('pipeline') },
          { icon: GitCompareArrows, label: '¿Dónde quedan los datos?', go: () => navigate('comparar', 'donde-quedan-los-datos') },
        ]}>
          <b>MariaDB y MongoDB no son parte de Hadoop.</b> Cada una corre en un solo proceso, guarda los datos en su propio disco y contesta
          en milisegundos, sin YARN. De MariaDB salen las ventas que Sqoop copia a HDFS, y ahí vuelven los resúmenes.
        </Intro>
      } />
  );
}

function Intro({ capa, links, children }: { capa: string; links: { icon: typeof Table2; label: string; go: () => void }[]; children: ReactNode }) {
  return (
    <div className="qx-intro" data-capa={capa}>
      <p>{children}</p>
      <div className="qx-intro-links">
        {links.map(({ icon: Icon, label, go }) => (
          <button key={label} type="button" className="qx-intro-a" onClick={go}><Icon size={13} aria-hidden="true" />{label}<ArrowRight size={12} aria-hidden="true" /></button>
        ))}
      </div>
    </div>
  );
}

interface Props { sources: DataSource[]; title: string; sub: string; help: ReactNode; intro: ReactNode }

function EditorConsultas({ sources, title, sub, help, intro }: Props) {
  const status = useStatus();
  const caps = useCapabilities();
  const up = status?.phase === 'running';
  const arg = useRouteArg();

  // Los documentos, el historial y las guardadas son los mismos para las dos pantallas: cada una muestra los de sus motores
  const mineOf = <T extends { source: DataSource }>(xs: T[]) => xs.filter(x => sources.includes(x.source));
  const [docs, setDocs] = useState<QueryDoc[]>(() => { const d = loadDocs(); return mineOf(d).length ? d : [...d, newDoc(d, sources[0])]; });
  const mine = mineOf(docs);
  const [active, setActive] = useState(() => mine[0].id);
  const doc = mine.find(d => d.id === active) ?? mine[0];
  const [state, setState] = useState<Record<string, DocState>>({});
  const st: DocState = state[doc.id] ?? { tab: 'res', log: [] };
  const [running, setRunning] = useState<{ id: string; what: 'consulta' | 'plan'; t0: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [saved, setSaved] = useState<SavedQuery[]>(loadSaved);
  const [side, setSide] = useState<SideTab>('cat');
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => saveDocs(docs), [docs]);
  useEffect(() => saveHistory(history), [history]);
  useEffect(() => saveSaved(saved), [saved]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [running]);

  // Al llegar: la consulta que dejó otra pantalla (Tablas), o el motor de la ruta (#lenguajes/pig, #bases/mongodb)
  const want = argSource(arg);
  useEffect(() => {
    const p = tomarPendiente(sources);
    if (p) { open(p.source, p.text, p.title); return; }
    if (!want || !sources.includes(want) || want === doc.source) return;
    const other = mine.find(d => d.source === want);
    if (!doc.text.trim()) setDoc({ source: want });
    else if (other) setActive(other.id);
    else { const d = newDoc(docs, want); setDocs(ds => [...ds, d]); setActive(d.id); }
  }, [want]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Si el usuario cambia de motor o de documento, la ruta deja de elegir el motor */
  const soltarArg = () => { if (arg) setRouteArg(''); };

  // Apagado no se pide el catálogo (contestaría 409); los ejemplos no dependen del cluster
  const refresh = (e: { type: string }) => e.type === 'step' || e.type === 'hdfs' || e.type === 'status';
  const catalog = useApi(a => (up ? a.catalog() : Promise.resolve([] as CatalogEntry[])), [up], refresh);
  const examples = useApi(a => a.queryExamples(), []);

  const cap = caps[doc.source];
  const source = doc.source;
  const patch = (id: string, p: Partial<DocState>) => setState(s => ({ ...s, [id]: { ...(s[id] ?? { tab: 'res', log: [] }), ...p } }));
  const log = (id: string, k: LogLine['k'], text: string) => setState(s => {
    const cur = s[id] ?? { tab: 'res', log: [] };
    return { ...s, [id]: { ...cur, log: [...cur.log.slice(-49), { at: Date.now(), k, text }] } };
  });
  const setDoc = (p: Partial<QueryDoc>) => setDocs(ds => ds.map(d => (d.id === doc.id ? { ...d, ...p } : d)));
  const focusEditor = () => requestAnimationFrame(() => editorRef.current?.querySelector('textarea')?.focus());

  /** Abre un texto: en el documento actual si está vacío, si no en uno nuevo */
  function open(src: DataSource, text: string, title?: string) {
    if (!doc.text.trim()) setDoc({ source: src, text, ...(title ? { title } : {}) });
    else {
      const d = newDoc(docs, src, text, title);
      setDocs(ds => [...ds, d]);
      setActive(d.id);
    }
    soltarArg();
    focusEditor();
  }
  function addDoc() {
    const d = newDoc(docs, source);
    setDocs(ds => [...ds, d]);
    setActive(d.id);
    soltarArg();
    focusEditor();
  }
  function closeDoc(id: string) {
    const i = mine.findIndex(d => d.id === id);
    let rest = docs.filter(d => d.id !== id);
    if (!mineOf(rest).length) rest = [...rest, newDoc(rest, source)];
    setDocs(rest);
    const next = mineOf(rest);
    if (id === doc.id) setActive((next[Math.max(0, i - 1)] ?? next[0]).id);
  }

  async function exec(what: 'consulta' | 'plan', d: QueryDoc = doc) {
    if (!d.text.trim() || running || caps[d.source].state !== 'ready') return;
    const id = d.id, src = d.source, q = d.text;
    const t0 = Date.now();
    setRunning({ id, what, t0 });
    setNow(t0);
    patch(id, { err: undefined, tab: what === 'plan' ? 'plan' : 'res' });
    log(id, 'run', `${what === 'plan' ? 'Plan' : 'Correr'} en ${SOURCE_LABEL[src]}: $ ${CLIENT[src]}`);
    try {
      if (what === 'plan') {
        const plan = await api().explain(src, q);
        patch(id, { plan });
        log(id, 'ok', `Plan: ${plan.nodes.length} pasos${plan.yarnStages ? ` · ${plan.yarnStages} en YARN` : ''}`);
      } else {
        const res = await api().query(src, q);
        patch(id, { res, plan: undefined });
        log(id, 'ok', `${res.trace?.output ?? `${nf(res.rows.length)} filas`}${res.appId ? ` · ${res.appId}` : ''}${res.note && res.note !== res.trace?.output ? ` · ${res.note}` : ''}`);
        setHistory(h => pushHistory(h, { source: src, text: q, at: t0, ok: true, rows: res.rows.length, ms: res.ms }));
        if (/^\s*(create|drop|alter)\b/i.test(q)) catalog.reload();
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      patch(id, { err: { code: errorCode(e) ?? 'failed', message, what } });
      log(id, 'bad', message);
      if (what === 'consulta') setHistory(h => pushHistory(h, { source: src, text: q, at: t0, ok: false, error: message }));
    } finally { setRunning(null); }
  }

  /** Tabla ventas en Hive: sube ventas a HDFS si falta (hdfs dfs -put) y corre el CREATE EXTERNAL TABLE en un documento propio */
  async function createTable() {
    if (!createVentas || running) return;
    const d = newDoc(docs, 'hive', createVentas.text, 'Crear ventas');
    setDocs(ds => [...ds, d]);
    setActive(d.id);
    const has = async () => (await api().hdfsList('/user/root/ventas').catch(() => null))?.entries.some(e => e.type === 'file' && !e.name.endsWith('._COPYING_')) ?? false;
    if (!(await has())) {
      const t0 = Date.now();
      setRunning({ id: d.id, what: 'consulta', t0 });
      log(d.id, 'run', '$ hdfs dfs -put ventas_grandes.csv /user/root/ventas');
      try {
        await api().putExample('ventas');
        for (let i = 0; i < 240 && !(await has()); i++) await new Promise(r => setTimeout(r, 1000));
        if (!(await has())) throw new Error('ventas no terminó de subir a HDFS: mirá el avance en HDFS y volvé a probar');
        log(d.id, 'ok', 'ventas_grandes.csv quedó en /user/root/ventas');
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        patch(d.id, { err: { code: errorCode(e) ?? 'failed', message, what: 'consulta' } });
        log(d.id, 'bad', message);
        setRunning(null);
        return;
      }
      setRunning(null);
    }
    await exec('consulta', d);
  }

  function save() {
    if (!doc.text.trim()) return;
    const name = doc.title.startsWith('Consulta ') ? suggestName(doc.text) || doc.title : doc.title;
    setSaved(s => addSaved(s, { name, source, text: doc.text }));
    setSide('saved');
    toast({ title: 'Consulta guardada', description: `${name} · queda en este navegador`, kind: 'ok' });
  }

  const ex = (examples.data ?? []).filter(x => x.source === source);
  const hiveTables = (catalog.data ?? []).filter(c => c.source === 'hive');
  const createVentas = sources.includes('hive') ? (examples.data ?? []).find(x => x.source === 'hive' && /^Crear tabla ventas/.test(x.label)) : undefined;
  const showCreate = up && caps.hive.state === 'ready' && catalog.data && !catalog.loading && !hiveTables.some(t => /\.ventas$/.test(t.name)) && !!createVentas;
  const ready = sources.filter(s => caps[s].state === 'ready').length;
  const busyHere = running?.id === doc.id;
  const misGuardadas = mineOf(saved), miHistorial = mineOf(history);

  return (
    <div className="page-in qx-page">
      <PageHeader title={title} sub={sub} help={help}
        status={!status ? undefined : status.phase === 'starting' ? { k: 'run', label: 'Arrancando' } : !up ? { k: 'off', label: 'Cluster apagado' } : { k: ready === sources.length ? 'ok' : ready ? 'run' : 'bad', label: `${ready} de ${sources.length} listos` }} />

      {intro}

      <div className="qx">
        <aside className="panel qx-side" aria-label="Catálogo, guardadas e historial">
          <div className="qx-side-tabs" role="tablist" aria-label="Panel lateral">
            {([['cat', 'Tablas', Table2], ['saved', 'Guardadas', Star], ['hist', 'Historial', Clock]] as const).map(([id, label, Icon]) => (
              <button key={id} type="button" role="tab" aria-selected={side === id} onClick={() => setSide(id)}>
                <Icon size={13} aria-hidden="true" />{label}
                {id === 'saved' && misGuardadas.length > 0 && <span className="n">{misGuardadas.length}</span>}
                {id === 'hist' && miHistorial.length > 0 && <span className="n">{miHistorial.length}</span>}
              </button>
            ))}
          </div>
          {side === 'cat' && <Catalog sources={sources} up={up} phase={status?.phase} entries={catalog.data} error={catalog.error} loading={catalog.loading} caps={caps}
            onPick={c => open(c.source, starter(c.source, c.name))} />}
          {side === 'saved' && <SavedList items={misGuardadas} onOpen={q => open(q.source, q.text, q.name)} onRemove={id => setSaved(s => removeSaved(s, id))} />}
          {side === 'hist' && <HistoryList items={miHistorial} onOpen={h => open(h.source, h.text)} onClear={() => setHistory(h => h.filter(x => !sources.includes(x.source)))} />}
        </aside>

        <div className="qx-main">
          <section className="panel qx-editor">
            <div className="qx-docs" role="tablist" aria-label="Consultas abiertas">
              {mine.map(d => (
                <div key={d.id} className="qx-doc" data-on={d.id === doc.id || undefined}>
                  <button type="button" role="tab" aria-selected={d.id === doc.id} onClick={() => { setActive(d.id); soltarArg(); }} title={`${d.title} · ${SOURCE_LABEL[d.source]}`}>
                    <span className="eng-dot" data-e={ENGINE[d.source]} aria-hidden="true" />{d.title}
                    {running?.id === d.id && <Dot s="running" label="corriendo" />}
                  </button>
                  <button type="button" className="x" aria-label={`Cerrar ${d.title}`} onClick={() => closeDoc(d.id)}><X size={12} /></button>
                </div>
              ))}
              <button type="button" className="qx-doc-add" onClick={addDoc} aria-label="Consulta nueva" title="Consulta nueva"><Plus size={14} /></button>
            </div>

            <div className="qx-engine-row">
              <EnginePicker sources={sources} value={source} caps={caps} onChange={s => { if (s !== source) { setDoc({ source: s }); patch(doc.id, { res: undefined, plan: undefined, err: undefined, tab: 'res' }); soltarArg(); } }} disabled={busyHere} />
              <span className="qx-rule"><EngineTag engine={ENGINE[source]} /><span><b>{WHAT[source]}.</b> {RULES[source]}</span></span>
            </div>

            <CapabilityNotice cap={source} what={`${SOURCE_LABEL[source]} no está disponible`} />

            {showCreate && (
              <div className="qx-hint" role="note">
                <Database size={15} aria-hidden="true" />
                <span><b>Hive todavía no tiene la tabla ventas.</b> Se crea como tabla externa sobre /user/root/ventas: apunta a los archivos de HDFS, no los copia. Si no están, primero los sube.</span>
                <GatedButton cap="hive" className="btn btn-sm" busy={!!running} onClick={() => void createTable()}><Plus size={13} />Crear tabla ventas desde HDFS</GatedButton>
              </div>
            )}

            <Snippets items={showCreate ? ex.filter(x => x !== createVentas) : ex} onPick={x => open(x.source, x.text, x.label.length <= 28 ? x.label : undefined)} />

            <div className="qe" ref={editorRef}>
              <CodeEditor value={doc.text} onChange={v => setDoc({ text: v })} label={`Consulta para ${SOURCE_LABEL[source]}`} rows={9}
                placeholder={PLACEHOLDER[source]} onRun={() => void exec('consulta')} onRunAlt={() => void exec('plan')}
                foot={<span className="mono">$ {CLIENT[source]}</span>} />
            </div>

            <div className="qx-actions">
              <GatedButton cap={source} blockedBy={!doc.text.trim() && 'Escribí una consulta o elegí un ejemplo'} className="btn btn-primary" busy={!!running}
                onClick={() => void exec('consulta')} inline={cap.state !== 'ready' || !doc.text.trim()}><Play size={14} />Correr</GatedButton>
              <GatedButton cap={source} blockedBy={!doc.text.trim() && 'Escribí una consulta'} className="btn" busy={!!running} onClick={() => void exec('plan')}
                title="Ver qué va a hacer el motor, sin correrla (Ctrl+Shift+Enter)"><GitBranch size={14} />Plan</GatedButton>
              <GatedButton className="btn btn-ghost" onClick={save} blockedBy={!doc.text.trim() && 'Escribí una consulta para guardarla'} title="Guardar en este navegador"><BookmarkPlus size={14} />Guardar</GatedButton>
              {!doc.text.trim() && ex[0] && <button type="button" className="btn btn-ghost" onClick={() => { setDoc({ text: ex[0].text }); focusEditor(); }}>Cargar un ejemplo</button>}
            </div>
          </section>

          <ResultPanel doc={doc} st={st} running={running?.id === doc.id ? running : null} now={now} onTab={t => patch(doc.id, { tab: t })} />
        </div>
      </div>
    </div>
  );
}

/* ---------- Motor ---------- */

function EnginePicker({ sources, value, caps, onChange, disabled }: { sources: DataSource[]; value: DataSource; caps: Record<DataSource, Capability>; onChange: (s: DataSource) => void; disabled?: boolean }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (i: number) => { const s = sources[(i + sources.length) % sources.length]; onChange(s); refs.current[sources.indexOf(s)]?.focus(); };
  return (
    <div className="qx-engines" role="radiogroup" aria-label="Motor de la consulta">
      {sources.map((s, i) => {
        const c = caps[s];
        const dot = c.state === 'ready' ? 'up' : c.state === 'starting' ? 'starting' : 'off';
        return (
          <button key={s} ref={el => { refs.current[i] = el; }} type="button" role="radio" aria-checked={value === s} aria-label={SOURCE_LABEL[s]}
            tabIndex={value === s ? 0 : -1} disabled={disabled && value !== s} title={c.state === 'ready' ? `${SOURCE_LABEL[s]}: listo` : c.reason}
            onClick={() => onChange(s)}
            onKeyDown={e => { if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i + 1); } if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i - 1); } }}>
            <Dot s={dot} label={c.state === 'ready' ? 'listo' : c.reason || 'no disponible'} />
            {SOURCE_LABEL[s]}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Ejemplos ---------- */

function Snippets({ items, onPick }: { items: QueryExample[]; onPick: (x: QueryExample) => void }) {
  if (!items.length) return null;
  return (
    <div className="qx-snips" aria-label="Ejemplos">
      <span className="lbl">Ejemplos</span>
      {items.map(x => (
        <button key={x.label} type="button" className="qx-snip" onClick={() => onPick(x)} title={x.script ? `De ${x.script}` : undefined}>{x.label}</button>
      ))}
    </div>
  );
}

/* ---------- Catálogo ---------- */

function Catalog({ sources, up, phase, entries, error, loading, caps, onPick }: {
  sources: DataSource[]; up: boolean; phase?: ClusterPhase; entries: CatalogEntry[] | undefined; error: string | null; loading: boolean; caps: Record<DataSource, Capability>; onPick: (c: CatalogEntry) => void;
}) {
  const [q, setQ] = useState('');
  const all = useMemo(() => entries ?? [], [entries]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? all.filter(c => c.name.toLowerCase().includes(t) || c.columns.some(col => col.name.toLowerCase().includes(t))) : all;
  }, [all, q]);
  if (!up) {
    return (
      <div className="qx-side-b">
        <EmptyState kind="blocked" compact title={phase === 'starting' ? 'El cluster está arrancando' : 'El catálogo aparece con el cluster prendido'}
          actions={phase === 'stopped' ? <button type="button" className="btn btn-sm btn-primary" onClick={() => runFix({ kind: 'start' })}><Play size={13} />Iniciar cluster</button> : undefined}>
          Igual podés escribir y guardar consultas, y abrir los ejemplos.
        </EmptyState>
      </div>
    );
  }
  if (error) return <div className="qx-side-b"><div className="callout" data-k="bad"><span>{error}</span></div></div>;
  if (!entries && loading) return <div className="qx-side-b"><SkeletonLines n={6} /></div>;
  return (
    <div className="qx-cat">
      <label className="qx-search">
        <Search size={13} aria-hidden="true" />
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar tabla o columna" aria-label="Buscar en el catálogo" />
      </label>
      {sources.filter(s => s !== 'pig').map(s => {
        const items = shown.filter(c => c.source === s);
        const c = caps[s];
        if (q && !items.length) return null;
        return (
          <div key={s} className="qx-cat-g">
            <div className="qx-cat-h"><Dot s={c.state === 'ready' ? 'up' : c.state === 'starting' ? 'starting' : 'off'} label={c.state === 'ready' ? 'listo' : c.reason || ''} /><b>{SOURCE_LABEL[s]}</b><span className="n">{items.length || ''}</span></div>
            {c.state !== 'ready' ? <p className="qx-cat-msg">{c.reason}{c.fix && c.fix.kind !== 'wait' && <button type="button" className="btn btn-sm" onClick={() => runFix(c.fix)}>{c.fixLabel}</button>}</p>
              : !items.length ? <p className="qx-cat-msg">{s === 'hive' ? 'Sin tablas todavía.' : 'Sin tablas.'}</p>
                : (
                  <ul>
                    {items.map(e => (
                      <li key={e.name}>
                        <button type="button" className="qx-cat-item" onClick={() => onPick(e)} title={`${e.columns.map(x => x.name).join(', ')}\nClic: ${s === 'mongodb' ? 'find().limit(100)' : 'SELECT * … LIMIT 100'}`}>
                          <span className="nm">{e.name}</span>
                          <span className="r">{e.rows == null ? '—' : nf(e.rows)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
          </div>
        );
      })}
      {sources.includes('hive') && (
        <p className="qx-cat-msg foot">
          Pig no usa el catálogo: lee los archivos de HDFS con LOAD.
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => navigate('tablas')}><Database size={12} />Cada tabla con su carpeta</button>
        </p>
      )}
    </div>
  );
}

/* ---------- Guardadas e historial ---------- */

function SavedList({ items, onOpen, onRemove }: { items: SavedQuery[]; onOpen: (q: SavedQuery) => void; onRemove: (id: string) => void }) {
  if (!items.length) return <div className="qx-side-b"><EmptyState compact title="Sin consultas guardadas">Con <b>Guardar</b> queda en este navegador, con su motor.</EmptyState></div>;
  return (
    <ul className="qx-list">
      {items.map(q => (
        <li key={q.id}>
          <button type="button" className="qx-li" onClick={() => onOpen(q)}>
            <span className="t"><span className="eng-dot" data-e={ENGINE[q.source]} aria-hidden="true" />{q.name}</span>
            <span className="s">{SOURCE_LABEL[q.source]} · {ago(q.at)}</span>
          </button>
          <button type="button" className="btn btn-sm btn-ghost x" aria-label={`Borrar ${q.name}`} onClick={() => onRemove(q.id)}><Trash2 size={12} /></button>
        </li>
      ))}
    </ul>
  );
}

function HistoryList({ items, onOpen, onClear }: { items: HistoryEntry[]; onOpen: (h: HistoryEntry) => void; onClear: () => void }) {
  if (!items.length) return <div className="qx-side-b"><EmptyState compact title="Todavía no corriste nada">Acá quedan las últimas 50 consultas, con su resultado.</EmptyState></div>;
  return (
    <>
      <ul className="qx-list">
        {items.map((h, i) => (
          <li key={`${h.at}-${i}`}>
            <button type="button" className="qx-li" onClick={() => onOpen(h)} title={h.error ?? h.text}>
              <span className="t mono">{h.text.trim().split('\n')[0]}</span>
              <span className="s"><span className="dot" data-s={h.ok ? 'ok' : 'bad'} aria-hidden="true" />{SOURCE_LABEL[h.source]} · {h.ok ? `${nf(h.rows ?? 0)} filas` : 'falló'} · {ago(h.at)}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="qx-side-f"><button type="button" className="btn btn-sm btn-ghost" onClick={onClear}><Trash2 size={12} />Borrar historial</button></div>
    </>
  );
}

/* ---------- Resultado ---------- */

function ResultPanel({ doc, st, running, now, onTab }: { doc: QueryDoc; st: DocState; running: { what: 'consulta' | 'plan'; t0: number } | null; now: number; onTab: (t: ResTab) => void }) {
  const { res, plan, err, tab, log } = st;
  const tabs: { id: ResTab; label: string; on: boolean; why?: string }[] = [
    { id: 'res', label: 'Resultado', on: true },
    { id: 'plan', label: 'Plan', on: !!plan || err?.what === 'plan' || running?.what === 'plan', why: 'Pedí el Plan (Ctrl+Shift+Enter) para ver qué va a hacer el motor' },
    { id: 'trace', label: 'Trace', on: !!res?.trace, why: 'Corré la consulta para ver quién la resolvió, paso a paso' },
    { id: 'log', label: 'Log', on: log.length > 0, why: 'Cada corrida deja acá su comando y cómo terminó' },
  ];
  const secs = (ms: number) => (ms < 1000 ? `${nf(ms)} ms` : `${nf(ms / 1000, 1)} s`);
  const fileName = `${doc.source}-${doc.title.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/gi, '_').replace(/^_|_$/g, '') || 'resultado'}`;
  return (
    <section className="panel qx-res" aria-label="Resultado">
      <div className="qx-res-tabs" role="tablist" aria-label="Vista del resultado">
        {tabs.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} disabled={!t.on && tab !== t.id} title={!t.on && tab !== t.id ? t.why : undefined} onClick={() => onTab(t.id)}>{t.label}</button>
        ))}
        {res && !running && !err && tab === 'res' && (
          <span className="qx-res-meta">
            {res.engine && <EngineTag engine={res.engine} />}
            <span>{secs(res.ms)}</span>
            {res.scanned != null && <span>leyó <b>{nf(res.scanned)}</b></span>}
            {res.appId && <span className="mono">{res.appId}</span>}
          </span>
        )}
      </div>
      <div className="qx-res-b">
        {running && (tab === 'res' || tab === 'plan') ? (
          <div className="qx-run" role="status">
            <Dot s="running" label="corriendo" />
            <span>{running.what === 'plan' ? 'Pidiendo el plan' : 'Corriendo'} en {SOURCE_LABEL[doc.source]}</span>
            <span className="mono muted">{nf((now - running.t0) / 1000, 1)} s</span>
            {running.what === 'consulta' && now - running.t0 > 3000 && (doc.source === 'hive' || doc.source === 'pig') &&
              <span className="muted">· {doc.source === 'pig' ? 'Pig arma los trabajos MapReduce y los manda a YARN: cada uno tarda 20-40 s' : 'si lanza un trabajo Tez, abrir la sesión en YARN lleva 10-20 s'}</span>}
          </div>
        ) : err && (tab === 'res' || (tab === 'plan' && err.what === 'plan')) ? (
          <div className="callout qx-err" data-k="bad" role="alert">
            <span className="head"><Chip k="bad">{err.code}</Chip><b>{err.what === 'plan' ? 'El plan' : 'La consulta'} falló en {SOURCE_LABEL[doc.source]}</b></span>
            <span className="msg mono">{err.message}</span>
          </div>
        ) : tab === 'plan' && plan ? <PlanTree plan={plan} />
          : tab === 'trace' && res?.trace ? <div className="qx-pad"><TraceView trace={res.trace} /></div>
            : tab === 'log' ? <LogView log={log} />
              : res ? (
                res.columns.length ? (
                  <>
                    {res.note && <p className="qx-note">{res.note}</p>}
                    <ResultTable columns={res.columns} rows={res.rows} label={`Resultado de ${doc.title}`} fileName={fileName} maxHeight={460} />
                  </>
                ) : <EmptyState compact kind="empty" title="Listo">{res.note ?? 'La sentencia corrió y no devuelve filas.'}{res.trace?.output && res.trace.output !== res.note ? ` ${res.trace.output}` : ''}</EmptyState>
              ) : (
                <EmptyState compact title="Todavía no corriste esta consulta">
                  Escribí arriba o elegí un ejemplo y apretá <b>Correr</b> (Ctrl+Enter). Con <b>Plan</b> (Ctrl+Shift+Enter) ves qué va a hacer el motor sin correrla.
                </EmptyState>
              )}
      </div>
    </section>
  );
}

function LogView({ log }: { log: LogLine[] }) {
  if (!log.length) return <EmptyState compact title="Sin actividad">Cada corrida de esta consulta deja acá su comando y cómo terminó.</EmptyState>;
  return (
    <ol className="qx-log">
      {log.map((l, i) => (
        <li key={i} data-k={l.k}>
          <span className="t mono">{new Date(l.at).toLocaleTimeString('es-AR')}</span>
          <span className="dot" data-s={l.k === 'run' ? 'run' : l.k} aria-hidden="true" />
          <span className="mono">{l.text}</span>
        </li>
      ))}
    </ol>
  );
}
