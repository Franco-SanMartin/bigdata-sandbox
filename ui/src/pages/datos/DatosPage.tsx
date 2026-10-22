/* Datos: catálogo de Hive, MySQL y MongoDB, esquema de cada tabla y editor de consultas. Esqueleto. */
import { useState } from 'react';
import { Database, Play } from 'lucide-react';
import type { CatalogEntry, DataSource, QueryResult } from '../../api/types';
import { api } from '../../api';
import { DataTable, type Column } from '../../components/DataTable';
import { EngineTag, SampleTable, Slot } from '../../components/Trace';
import { Empty, Seg } from '../../components/ui';
import { HELP } from '../../help/content';
import { toast } from '../../state/ui';
import { useStatus } from '../../state/store';
import { useApi } from '../../state/useApi';
import { nf } from '../../lib/format';

const SOURCE: Record<DataSource, string> = { hive: 'Hive', mysql: 'MySQL', mongodb: 'MongoDB' };

export function DatosPage() {
  const status = useStatus();
  const up = status?.phase === 'running';
  const [source, setSource] = useState<DataSource>('hive');
  const [sel, setSel] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [res, setRes] = useState<QueryResult | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = (e: { type: string }) => e.type === 'step' || e.type === 'hdfs';
  const catalog = useApi(a => (up ? a.catalog() : Promise.resolve([])), [up], refresh);
  const examples = useApi(a => a.queryExamples(), []);
  const schema = useApi(a => (up && sel ? a.schema(source, sel) : Promise.resolve(null)), [sel, source, up]);
  const rows = (catalog.data ?? []).filter(c => c.source === source);
  const ex = (examples.data ?? []).filter(x => x.source === source);

  async function run() {
    setBusy(true);
    try { setRes(await api().query(source, text)); }
    catch (e) { toast({ kind: 'bad', title: 'La consulta falló', description: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  }

  const cols: Column<CatalogEntry>[] = [
    { id: 'name', header: source === 'mongodb' ? 'Colección' : 'Tabla', sort: r => r.name, cell: r => <span className="mono">{r.name}</span> },
    { id: 'kind', header: 'Tipo', cell: r => r.kind },
    { id: 'rows', header: source === 'mongodb' ? 'Documentos' : 'Filas', align: 'right', sort: r => r.rows, cell: r => nf(r.rows) },
    { id: 'cols', header: 'Columnas', align: 'right', cell: r => r.columns.length },
  ];

  return (
    <div className="page-in">
      <div className="page-head">
        <div><h1>Datos</h1><p>{HELP.datos.intro}</p></div>
        <div className="page-actions">
          <Seg value={source} onChange={v => { setSource(v); setSel(null); setRes(null); setText(''); }} label="Motor"
            options={(Object.keys(SOURCE) as DataSource[]).map(s => ({ value: s, label: SOURCE[s] }))} />
        </div>
      </div>
      {!up ? (
        <section className="panel"><Empty icon={<Database size={20} />} title="El cluster está apagado">Prendelo para consultar Hive, MySQL y MongoDB.</Empty></section>
      ) : (
        <div className="grid cols-12">
          <section className="panel span-5">
            <div className="panel-h"><h2>Catálogo</h2><span className="sub">{rows.length} en {SOURCE[source]}</span></div>
            <div className="panel-b flush">
              <DataTable label={`Catálogo de ${SOURCE[source]}`} columns={cols} rows={rows} rowKey={r => r.name} selected={sel} onRowClick={r => setSel(r.name)}
                empty={source === 'mongodb' ? 'MongoDB no está prendido.' : 'Sin tablas.'} />
            </div>
          </section>
          <section className="panel span-7">
            <div className="panel-h"><h2>{sel ?? 'Esquema'}</h2>{schema.data?.format && <span className="sub">{schema.data.format}</span>}</div>
            <div className="panel-b">
              {schema.data ? <SampleTable sample={schema.data.sample} label={`Muestra de ${sel}`} /> : <span className="muted">Elegí una tabla para ver sus columnas y una muestra.</span>}
              <div style={{ marginTop: 12 }}><Slot title="Acá va el esquema completo:">columnas con tipo y clave, índices, particiones y el DDL (schema()).</Slot></div>
            </div>
          </section>
          <section className="panel span-12">
            <div className="panel-h">
              <h2>Consulta</h2>
              <span className="end">
                <select className="btn btn-sm" aria-label="Ejemplos" value="" onChange={e => { const x = ex[Number(e.target.value)]; if (x) setText(x.text); }}>
                  <option value="">Ejemplos…</option>
                  {ex.map((x, i) => <option key={i} value={i}>{x.label}</option>)}
                </select>
                <button className="btn btn-sm btn-primary" type="button" disabled={busy || !text.trim()} onClick={run}><Play size={12} />Correr</button>
              </span>
            </div>
            <div className="panel-b" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <textarea className="mono" aria-label="Texto de la consulta" rows={5} value={text} onChange={e => setText(e.target.value)}
                placeholder={source === 'mongodb' ? 'db.ventas.find({ sucursal: "Centro" })' : 'SELECT …'}
                style={{ width: '100%', background: 'var(--n-1)', color: 'var(--text)', border: '1px solid var(--line-soft)', borderRadius: 'var(--r-2)', padding: 10, resize: 'vertical' }}
                onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) run(); }} />
              {res && <>
                <p className="muted" style={{ fontSize: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
                  {res.engine && <EngineTag engine={res.engine} />}<span>{nf(res.rows.length)} filas en {nf(res.ms)} ms</span>{res.appId && <span className="mono">{res.appId}</span>}{res.note && <span>{res.note}</span>}
                </p>
                <SampleTable sample={{ columns: res.columns, rows: res.rows }} label="Resultado" />
              </>}
              <Slot title="Acá va el plan:">EXPLAIN de Hive y MySQL o explain() de MongoDB como árbol (explain()), y el trace de la consulta.</Slot>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
