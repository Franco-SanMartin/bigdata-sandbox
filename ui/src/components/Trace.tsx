/* El patrón de toda acción: comando → qué entra → qué hace → cómo quedan los datos, con antes y después. */
import type { ReactNode } from 'react';
import type { ActionTrace, DataSample, Engine } from '../api/types';
import { CodeBlock } from './ui';

const ENGINE: Record<Engine, string> = { hdfs: 'Cliente HDFS', mr: 'MapReduce', tez: 'Tez', spark: 'Spark', uno: 'Una sola máquina' };

export function EngineTag({ engine }: { engine: Engine }) {
  return <span className={engine === 'hdfs' ? 'eng' : `eng eng-${engine}`}>{ENGINE[engine]}</span>;
}

export function SampleTable({ sample, label }: { sample: DataSample; label: string }) {
  return (
    <div className="tbl-wrap">
      <table className="tbl" aria-label={label}>
        <thead><tr>{sample.columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {sample.rows.length
            ? sample.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={typeof c === 'number' ? 'r' : undefined}>{c === null ? <span className="muted">null</span> : String(c)}</td>)}</tr>)
            : <tr><td colSpan={Math.max(1, sample.columns.length)} className="tbl-empty">Sin filas</td></tr>}
        </tbody>
      </table>
      {(sample.total != null || sample.format || sample.note) && (
        <p className="muted" style={{ fontSize: 12, padding: '6px 12px' }}>
          {[sample.total != null && `${sample.total.toLocaleString('es-AR')} en total`, sample.format, sample.note].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  );
}

export function TraceView({ trace }: { trace: ActionTrace }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <CodeBlock lines={trace.command.split('\n')} label="Comando" />
      <dl className="kv">
        <dt>Entra</dt><dd>{trace.input}</dd>
        <dt>Hace</dt><dd>{trace.action}</dd>
        <dt>Sale</dt><dd>{trace.output}</dd>
        {trace.engine && <><dt>Motor</dt><dd><EngineTag engine={trace.engine} /></dd></>}
        {trace.appIds?.length ? <><dt>YARN</dt><dd className="mono">{trace.appIds.join(', ')}</dd></> : null}
      </dl>
      {trace.before && <div><h3 className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Antes</h3><SampleTable sample={trace.before} label="Datos antes" /></div>}
      {trace.after && <div><h3 className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Después</h3><SampleTable sample={trace.after} label="Datos después" /></div>}
    </div>
  );
}

/** Lugar reservado en un esqueleto: qué va a ir ahí y de qué método del contrato sale */
export function Slot({ title, children }: { title: string; children: ReactNode }) {
  return <div className="callout"><span><b>{title}</b> {children}</span></div>;
}
