/* Filas de un resultado: número de fila, números alineados y con separador, null marcado y documentos de MongoDB en varias líneas. */
import type { QueryResult } from '../../api/types';
import { nf } from '../../lib/format';

const MAX = 500;

export function ResultGrid({ res }: { res: Pick<QueryResult, 'columns' | 'rows'> }) {
  const rows = res.rows.slice(0, MAX);
  if (!res.columns.length) return null;
  return (
    <div className="tbl-wrap">
      <table className="tbl res-grid" aria-label="Resultado de la consulta">
        <thead><tr><th className="idx">#</th>{res.columns.map(c => <th key={c} className={typeof res.rows[0]?.[res.columns.indexOf(c)] === 'number' ? 'r' : undefined}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.length ? rows.map((r, i) => (
            <tr key={i}>
              <td className="idx">{i + 1}</td>
              {r.map((c, j) => c === null ? <td key={j}><span className="muted">NULL</span></td>
                : typeof c === 'number' ? <td key={j} className={c < 0 ? 'r neg' : 'r'}>{Number.isInteger(c) ? nf(c) : nf(c, 3)}</td>
                : <td key={j} className={c.includes('\n') ? 'doc' : undefined}>{c}</td>)}
            </tr>
          )) : <tr><td colSpan={res.columns.length + 1} className="tbl-empty">0 filas</td></tr>}
        </tbody>
      </table>
      {res.rows.length > MAX && <p className="muted" style={{ fontSize: 12, padding: '6px 12px' }}>Se muestran las primeras {nf(MAX)} de {nf(res.rows.length)}</p>}
    </div>
  );
}
