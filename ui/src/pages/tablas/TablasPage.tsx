/* Tablas: lo que anota el Metastore de cada tabla de Hive (nombre, columnas, formato y carpeta de HDFS),
   con su muestra, su CREATE TABLE y quién la puede leer: Hive y Spark por el nombre, Pig por la carpeta. */
import { useMemo, useState } from 'react';
import { ArrowRight, Braces, FolderOpen, Play, Plus, Search, Table2 } from 'lucide-react';
import type { CatalogEntry, TableSchema } from '../../api/types';
import { Chip, EmptyState, PageHeader, ResultTable, SkeletonLines } from '../../components/base';
import { Codigo } from '../../components/Comando';
import { Dot } from '../../components/ui';
import { mbLabel, nf } from '../../lib/format';
import { runFix, useCapabilities } from '../../state/capabilities';
import { useStatus } from '../../state/store';
import { navigate, setRouteArg, useRouteArg } from '../../state/ui';
import { useApi } from '../../state/useApi';
import { dejarParaAbrir, starter } from '../datos/consultas';
import { pigLoad } from './leer';
import './tablas.css';

const corto = (name: string) => name.replace(/^default\./, '');

export function TablasPage() {
  const status = useStatus();
  const caps = useCapabilities();
  const up = status?.phase === 'running';
  const hive = caps.hive;
  const listo = up && hive.state === 'ready';

  // Apagado no se pide el catálogo (contestaría 409)
  const refresh = (e: { type: string }) => e.type === 'step' || e.type === 'hdfs' || e.type === 'status';
  const catalog = useApi(a => (listo ? a.catalog() : Promise.resolve([] as CatalogEntry[])), [listo], refresh);
  const tablas = useMemo(() => (catalog.data ?? []).filter(c => c.source === 'hive'), [catalog.data]);

  const arg = useRouteArg();
  const elegida = tablas.find(t => t.name === arg || corto(t.name) === arg) ?? tablas[0];

  return (
    <div className="page-in tb-page">
      <PageHeader title="Tablas"
        sub="Lo que anota el Metastore de cada tabla de Hive: el nombre, las columnas y la carpeta de HDFS donde están los archivos."
        status={!status ? undefined : status.phase === 'starting' ? { k: 'run', label: 'Arrancando' } : !up ? { k: 'off', label: 'Cluster apagado' } : hive.state !== 'ready' ? { k: 'bad', label: 'Hive no está' }
          : catalog.data ? { k: 'ok', label: `${nf(tablas.length)} ${tablas.length === 1 ? 'tabla' : 'tablas'}` } : undefined}
        help={<>Una tabla de Hive no guarda filas: el Metastore anota cómo leer una carpeta de HDFS. Hive y Spark comparten ese Metastore y la encuentran por el nombre; Pig no lo usa y lee la carpeta directo.</>} />

      <Concepto dibujo={!tablas.length} />

      {!status ? <SkeletonLines n={6} />
        : !up ? (
          <EmptyState kind="blocked" title={status.phase === 'starting' ? 'El cluster está arrancando' : 'Las tablas se leen con el cluster prendido'}
            actions={status.phase === 'stopped' ? <button type="button" className="btn btn-primary" onClick={() => runFix({ kind: 'start' })}><Play size={14} />Iniciar cluster</button> : undefined}>
            El Metastore guarda la lista de tablas; para leerla tiene que estar corriendo HiveServer2.
          </EmptyState>
        ) : hive.state !== 'ready' ? (
          <EmptyState kind="blocked" title="Hive no está disponible"
            actions={hive.fix && hive.fix.kind !== 'wait' ? <button type="button" className="btn btn-primary" onClick={() => runFix(hive.fix)}>{hive.fixLabel}</button> : undefined}>
            {hive.reason}
          </EmptyState>
        ) : catalog.error ? <div className="callout" data-k="bad"><span>{catalog.error}</span></div>
          : !catalog.data ? <SkeletonLines n={6} />
            : !tablas.length ? (
              <EmptyState title="Hive todavía no tiene tablas"
                actions={<button type="button" className="btn btn-primary" onClick={() => navigate('lenguajes', 'hive')}><Plus size={14} />Crear la tabla ventas</button>}>
                Una tabla se crea con CREATE TABLE en Lenguajes (Hive), o la arma el pipeline. Con <b>Crear la tabla ventas</b> se crea una externa sobre /user/root/ventas.
              </EmptyState>
            ) : (
              <div className="tb">
                <Lista tablas={tablas} elegida={elegida} onPick={t => setRouteArg(corto(t.name))} />
                {elegida && <Detalle key={elegida.name} t={elegida} />}
              </div>
            )}
    </div>
  );
}

/** Qué es una tabla de Hive: el Metastore anota, HDFS guarda. El dibujo va mientras no hay una tabla
    elegida; con una, el detalle muestra el suyo */
function Concepto({ dibujo }: { dibujo: boolean }) {
  return (
    <div className="tb-concepto" data-capa="datos">
      {dibujo && (
        <>
          <div className="tb-c-box">
            <small>Metastore</small>
            <b>el nombre y las columnas</b>
            <span>default.ventas: fecha, sucursal, producto…</span>
          </div>
          <span className="tb-c-flecha" aria-hidden="true">apunta a<ArrowRight size={14} /></span>
          <div className="tb-c-box">
            <small>HDFS</small>
            <b>los archivos</b>
            <span>/user/root/ventas/ventas_grandes.csv</span>
          </div>
        </>
      )}
      <p>
        <b>Una tabla no guarda filas.</b> Es una entrada del catálogo que dice cómo leer una carpeta. Hive y Spark la encuentran
        por el nombre; Pig y MapReduce leen la carpeta directo.
      </p>
    </div>
  );
}

function Lista({ tablas, elegida, onPick }: { tablas: CatalogEntry[]; elegida?: CatalogEntry; onPick: (t: CatalogEntry) => void }) {
  const [q, setQ] = useState('');
  const t = q.trim().toLowerCase();
  const shown = t ? tablas.filter(x => x.name.toLowerCase().includes(t) || x.columns.some(c => c.name.toLowerCase().includes(t))) : tablas;
  return (
    <aside className="panel tb-list" aria-label="Tablas de Hive">
      {tablas.length > 6 && (
        <label className="tb-search">
          <Search size={13} aria-hidden="true" />
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar tabla o columna" aria-label="Buscar tabla o columna" />
        </label>
      )}
      <ul>
        {shown.map(x => (
          <li key={x.name}>
            <button type="button" className="tb-item" aria-current={x === elegida || undefined} onClick={() => onPick(x)}>
              <Table2 size={14} aria-hidden="true" />
              <span className="nm mono">{x.name}</span>
              <span className="r">{x.rows == null ? '—' : nf(x.rows)}</span>
              <span className="k">{x.kind === 'externa' ? 'externa' : 'administrada'} · {x.columns.length} columnas</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function Detalle({ t }: { t: CatalogEntry }) {
  const schema = useApi<TableSchema>(a => a.schema('hive', t.name), [t.name]);
  const s = schema.data;
  const externa = t.kind === 'externa';
  const cols = s?.columns ?? t.columns;
  const formato = s?.format;
  const texto = !formato || /text/i.test(formato);
  const pig = t.location ? pigLoad(t.name, t.location, cols, s?.ddl) : undefined;
  const abrir = (source: 'hive' | 'pig', text: string) => { dejarParaAbrir(source, text, corto(t.name)); navigate('lenguajes'); };

  return (
    <div className="tb-det">
      <section className="panel tb-card" aria-label={`Tabla ${t.name}`}>
        <header className="tb-h">
          <h2 className="mono">{t.name}</h2>
          <Chip>{externa ? 'externa' : 'administrada'}</Chip>
          {formato && <Chip>{formato}</Chip>}
          <span className="tb-h-n">
            {t.rows != null && <span><b>{nf(t.rows)}</b> filas</span>}
            {s?.sizeMb != null && s.sizeMb > 0 && <span><b>{mbLabel(s.sizeMb)}</b> en HDFS</span>}
            <span><b>{cols.length}</b> columnas</span>
          </span>
        </header>

        <div className="tb-camino">
          <div className="tb-box" data-capa="datos">
            <small>Metastore</small>
            <b className="mono">{t.name}</b>
            <span>{cols.length} columnas{formato ? ` · ${formato}` : ''}</span>
          </div>
          <span className="tb-c-flecha" aria-hidden="true">apunta a<ArrowRight size={14} /></span>
          {t.location ? (
            <button type="button" className="tb-box tb-box-a" data-capa="datos" onClick={() => navigate('hdfs', t.location)} title="Abrir la carpeta en el explorador de HDFS">
              <small>HDFS</small>
              <b className="mono">{t.location}</b>
              <span><FolderOpen size={12} aria-hidden="true" />Abrir la carpeta</span>
            </button>
          ) : (
            <div className="tb-box" data-capa="datos"><small>HDFS</small><b>sin carpeta</b><span>Hive no informó la ubicación</span></div>
          )}
        </div>
        <p className="tb-nota" data-k={externa ? 'ok' : 'run'}>
          {externa
            ? <><b>Es externa:</b> DROP TABLE borra la entrada del Metastore y deja los archivos en la carpeta.</>
            : <><b>Es administrada:</b> Hive es dueño de la carpeta, y DROP TABLE borra también los archivos.</>}
        </p>
      </section>

      <div className="tb-grid">
        <section className="panel tb-cols" aria-label="Columnas">
          <h3>Columnas</h3>
          <table>
            <tbody>
              {cols.map(c => (
                <tr key={c.name}><td className="mono">{c.name}</td><td className="mono t">{c.type}</td></tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel tb-quien" aria-label="Quién la puede leer">
          <h3>Quién la puede leer</h3>
          <div className="tb-q">
            <div className="tb-q-h"><span className="tb-eng" data-e="tez">Hive</span><b>Por el nombre, con SQL.</b> Agrupar u ordenar lanza un trabajo Tez.</div>
            <Codigo cmd={starter('hive', t.name)} bash={false} donde="en Lenguajes, Hive" />
            <button type="button" className="btn btn-sm btn-primary" onClick={() => abrir('hive', starter('hive', t.name))}><Braces size={13} />Consultarla en Hive</button>
          </div>
          <div className="tb-q">
            <div className="tb-q-h"><span className="tb-eng" data-e="spark">Spark</span><b>Por el nombre, con el mismo Metastore.</b> En memoria, sin escribir a disco entre pasos.</div>
            <Codigo cmd={`spark.table("${t.name}").show(10)`} bash={false} donde="en pyspark o un notebook" />
          </div>
          <div className="tb-q">
            <div className="tb-q-h"><span className="tb-eng" data-e="mr">Pig</span><b>No ve el Metastore: lee la carpeta.</b> Le tenés que decir el separador y el esquema.</div>
            {pig && texto ? (
              <>
                <Codigo cmd={pig} bash={false} donde="en Lenguajes, Pig" />
                <button type="button" className="btn btn-sm" onClick={() => abrir('pig', pig)}><Braces size={13} />Leerla con Pig</button>
              </>
            ) : <p className="tb-q-no">{formato ? `Está en ${formato}: Pig solo lee texto sin un loader aparte. Usá Hive o Spark.` : 'Sin carpeta no hay qué leer.'}</p>}
          </div>
        </section>
      </div>

      <section className="panel tb-muestra" aria-label="Muestra">
        <h3>Muestra <span className="mono">SELECT * FROM {corto(t.name)} LIMIT …</span></h3>
        {schema.error ? <div className="callout" data-k="bad"><span>{schema.error}</span></div>
          : !s ? <div className="tb-pad"><SkeletonLines n={4} /><p className="tb-espera"><Dot s="running" label="leyendo" />Hive lee las primeras filas de la carpeta (unos segundos)</p></div>
            : s.sample.columns.length && s.sample.rows.length
              ? <ResultTable columns={s.sample.columns} rows={s.sample.rows} total={s.sample.total} label={`Muestra de ${t.name}`} fileName={corto(t.name)} maxHeight={320} />
              : <EmptyState compact title="Sin filas">{s.sample.note ?? 'La carpeta está vacía o la tabla todavía no tiene datos.'}</EmptyState>}
      </section>

      {s?.ddl && (
        <details className="panel tb-ddl">
          <summary>CREATE TABLE <span className="muted">(lo que devuelve SHOW CREATE TABLE)</span></summary>
          <pre className="mono">{s.ddl}</pre>
        </details>
      )}
    </div>
  );
}
