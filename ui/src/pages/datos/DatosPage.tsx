/* Consultas: un editor por motor (Hive, MariaDB, MongoDB y Pig) con documentos, ejemplos, historial y
   consultas guardadas; el catálogo a la izquierda y el resultado abajo (tabla, plan, trace y log). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BookmarkPlus, Clock, Database, GitBranch, Play, Plus, Search, Star, Table2, Trash2, X } from 'lucide-react';
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
import { toast } from '../../state/ui';
import { useApi } from '../../state/useApi';
import { PlanTree } from './PlanTree';
import {
  SOURCES, SOURCE_LABEL, addSaved, ago, loadDocs, loadHistory, loadSaved, newDoc, pushHistory, removeSaved,
  saveDocs, saveHistory, saveSaved, starter, suggestName, type HistoryEntry, type QueryDoc, type SavedQuery,
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

export function DatosPage() {
  const status = useStatus();
  const caps = useCapabilities();
  const up = status?.phase === 'running';

  const [docs, setDocs] = useState<QueryDoc[]>(() => { const d = loadDocs(); return d.length ? d : [newDoc([], 'hive')]; });
  const [active, setActive] = useState(() => docs[0].id);
  const doc = docs.find(d => d.id === active) ?? docs[0];
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
    focusEditor();
  }
  function addDoc() {
    const d = newDoc(docs, source);
    setDocs(ds => [...ds, d]);
    setActive(d.id);
    focusEditor();
  }
  function closeDoc(id: string) {
    const rest = docs.filter(d => d.id !== id);
    const next = rest.length ? rest : [newDoc([], source)];
    setDocs(next);
    if (id === active) setActive(next[Math.max(0, docs.findIndex(d => d.id === id) - 1)]?.id ?? next[0].id);
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
  const createVentas = (examples.data ?? []).find(x => x.source === 'hive' && /^Crear tabla ventas/.test(x.label));
  const showCreate = up && caps.hive.state === 'ready' && catalog.data && !catalog.loading && !hiveTables.some(t => /\.ventas$/.test(t.name)) && !!createVentas;
  const ready = SOURCES.filter(s => caps[s].state === 'ready').length;
  const busyHere = running?.id === doc.id;

  return (
    <div className="page-in qx-page">
      <PageHeader title="Consultas"
        sub="Escribí SQL en Hive o MariaDB, consultas de MongoDB o scripts de Pig, y mirá el resultado, el plan y quién lo resolvió."
        status={!status ? undefined : status.phase === 'starting' ? { k: 'run', label: 'Arrancando' } : !up ? { k: 'off', label: 'Cluster apagado' } : { k: ready === SOURCES.length ? 'ok' : ready ? 'run' : 'bad', label: `${ready} de ${SOURCES.length} motores listos` }}
        help={<>Hive y Pig trabajan sobre los archivos de HDFS y lanzan trabajos en YARN; MariaDB y MongoDB resuelven en su propio proceso. El historial y las guardadas quedan en este navegador.</>} />

      <div className="qx">
        <aside className="panel qx-side" aria-label="Catálogo, guardadas e historial">
          <div className="qx-side-tabs" role="tablist" aria-label="Panel lateral">
            {([['cat', 'Tablas', Table2], ['saved', 'Guardadas', Star], ['hist', 'Historial', Clock]] as const).map(([id, label, Icon]) => (
              <button key={id} type="button" role="tab" aria-selected={side === id} onClick={() => setSide(id)}>
                <Icon size={13} aria-hidden="true" />{label}
                {id === 'saved' && saved.length > 0 && <span className="n">{saved.length}</span>}
                {id === 'hist' && history.length > 0 && <span className="n">{history.length}</span>}
              </button>
            ))}
          </div>
          {side === 'cat' && <Catalog up={up} phase={status?.phase} entries={catalog.data} error={catalog.error} loading={catalog.loading} caps={caps}
            onPick={c => open(c.source, starter(c.source, c.name))} />}
          {side === 'saved' && <SavedList items={saved} onOpen={q => open(q.source, q.text, q.name)} onRemove={id => setSaved(s => removeSaved(s, id))} />}
          {side === 'hist' && <HistoryList items={history} onOpen={h => open(h.source, h.text)} onClear={() => setHistory([])} />}
        </aside>

        <div className="qx-main">
          <section className="panel qx-editor">
            <div className="qx-docs" role="tablist" aria-label="Consultas abiertas">
              {docs.map(d => (
                <div key={d.id} className="qx-doc" data-on={d.id === doc.id || undefined}>
                  <button type="button" role="tab" aria-selected={d.id === doc.id} onClick={() => setActive(d.id)} title={`${d.title} · ${SOURCE_LABEL[d.source]}`}>
                    <span className="eng-dot" data-e={ENGINE[d.source]} aria-hidden="true" />{d.title}
                    {running?.id === d.id && <Dot s="running" label="corriendo" />}
                  </button>
                  <button type="button" className="x" aria-label={`Cerrar ${d.title}`} onClick={() => closeDoc(d.id)}><X size={12} /></button>
                </div>
              ))}
              <button type="button" className="qx-doc-add" onClick={addDoc} aria-label="Consulta nueva" title="Consulta nueva"><Plus size={14} /></button>
            </div>

            <div className="qx-engine-row">
              <EnginePicker value={source} caps={caps} onChange={s => { if (s !== source) { setDoc({ source: s }); patch(doc.id, { res: undefined, plan: undefined, err: undefined, tab: 'res' }); } }} disabled={busyHere} />
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

function EnginePicker({ value, caps, onChange, disabled }: { value: DataSource; caps: Record<DataSource, Capability>; onChange: (s: DataSource) => void; disabled?: boolean }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (i: number) => { const s = SOURCES[(i + SOURCES.length) % SOURCES.length]; onChange(s); refs.current[SOURCES.indexOf(s)]?.focus(); };
  return (
    <div className="qx-engines" role="radiogroup" aria-label="Motor de la consulta">
      {SOURCES.map((s, i) => {
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

function Catalog({ up, phase, entries, error, loading, caps, onPick }: {
  up: boolean; phase?: ClusterPhase; entries: CatalogEntry[] | undefined; error: string | null; loading: boolean; caps: Record<DataSource, Capability>; onPick: (c: CatalogEntry) => void;
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
      {(['hive', 'mysql', 'mongodb'] as DataSource[]).map(s => {
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
      <p className="qx-cat-msg foot">Pig no tiene catálogo: lee los archivos de HDFS con LOAD.</p>
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
