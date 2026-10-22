/* hdfs fsck a pedido: resumen, bloques con problemas, la traza del comando y la salida completa. */
import { useState } from 'react';
import { Play, ShieldCheck } from 'lucide-react';
import { api } from '../../api';
import { errorCode } from '../../api/errors';
import type { ApiErrorCode, FsckReport } from '../../api/types';
import { DataTable, type Column } from '../../components/DataTable';
import { TraceView } from '../../components/Trace';
import { nf, sizeLabel } from '../../lib/format';
import { ErrorLine } from './common';

const ISSUE: Record<FsckReport['problems'][number]['issue'], [string, string]> = { under: ['run', 'copias de menos'], over: ['', 'copias de más'], missing: ['bad', 'perdido'], corrupt: ['bad', 'corrupto'] };
type Problem = FsckReport['problems'][number];

export function Fsck({ defaultPath }: { defaultPath: string }) {
  const [path, setPath] = useState('/');
  const [rep, setRep] = useState<FsckReport | null>(null);
  const [err, setErr] = useState<{ message: string; code?: ApiErrorCode } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (p = path) => {
    setBusy(true); setErr(null);
    try { setRep(await api().fsck(p.trim() || '/')); } catch (e) { setErr({ message: e instanceof Error ? e.message : String(e), code: errorCode(e) }); }
    setBusy(false);
  };
  const cols: Column<Problem>[] = [
    { id: 'issue', header: 'Problema', cell: x => <span className="badge" data-k={ISSUE[x.issue][0] || undefined}>{ISSUE[x.issue][1]}</span> },
    { id: 'block', header: 'Bloque', cell: x => <span className="mono">{x.block}</span> },
    { id: 'file', header: 'Archivo', sort: x => x.file, cell: x => <span className="mono muted">{x.file}</span> },
    { id: 'rep', header: 'Copias', align: 'right', cell: x => `${x.replicas} / ${x.expected}` },
  ];
  return (
    <section className="panel span-12" aria-label="fsck">
      <div className="panel-h">
        <h2>fsck</h2><span className="sub">revisa bloque por bloque cuántas copias vivas hay</span>
        {rep && <span className="badge" data-k={rep.healthy ? (rep.underReplicated ? 'run' : 'ok') : 'bad'}>{rep.healthy ? 'HEALTHY' : 'CORRUPT'}</span>}
        <form className="end" onSubmit={e => { e.preventDefault(); void run(); }}>
          <span className="mono muted">hdfs fsck</span>
          <input className="input ops-in sm mono" value={path} onChange={e => setPath(e.target.value)} aria-label="Ruta para fsck" />
          {defaultPath !== '/' && <button className="btn btn-sm btn-ghost" type="button" onClick={() => { setPath(defaultPath); void run(defaultPath); }}>esta carpeta</button>}
          <button className="btn btn-sm btn-primary" type="submit" disabled={busy}><Play size={13} />{busy ? 'Revisando…' : 'Correr'}</button>
        </form>
      </div>
      <div className="panel-b">
        {err && <ErrorLine err={err} onRetry={() => run()} />}
        {!rep && !err && <div className="ops-hint"><ShieldCheck size={14} /><span className="muted">Sin correr todavía. No lee los datos: le pregunta al NameNode dónde está cada copia.</span></div>}
        {rep && (
          <div className="ops-fsck">
            <div className="ops-col">
              <dl className="kv ops-kv">
                <dt>Ruta</dt><dd className="mono">{rep.path}</dd>
                <dt>Tamaño</dt><dd>{sizeLabel(rep.totalSizeMb)} · {rep.files} archivos en {rep.dirs} carpetas</dd>
                <dt>Bloques</dt><dd>{rep.blocks} · {rep.minimallyReplicated} con al menos una copia</dd>
                <dt>Copias de menos</dt><dd className={rep.underReplicated ? 'ops-warn' : undefined}>{rep.underReplicated}</dd>
                <dt>Copias de más</dt><dd>{rep.overReplicated}</dd>
                <dt>Perdidos</dt><dd className={rep.missing ? 'ops-bad' : undefined}>{rep.missing}{rep.corrupt ? ` · ${rep.corrupt} corruptos` : ''}</dd>
                <dt>Réplica</dt><dd>{nf(rep.avgReplication, 2)} promedio · {rep.defaultReplication} por defecto · {rep.liveDataNodes} DataNodes vivos</dd>
              </dl>
              <DataTable label="Bloques con problemas" columns={cols} rows={rep.problems} rowKey={x => `${x.file}:${x.block}`} empty="Ningún bloque con problemas" />
            </div>
            <div className="ops-col">
              <TraceView trace={rep.trace} />
              <details className="ops-raw"><summary>Salida completa · {rep.raw.length} líneas</summary><pre className="log ops-log">{rep.raw.join('\n')}</pre></details>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
