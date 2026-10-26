/* Tabla con orden por columna. El filtro y la búsqueda los arma cada pantalla en su barra. */
import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  sort?: (row: T) => number | string;
  align?: 'right';
  width?: number | string;
}

export function DataTable<T>({ columns, rows, rowKey, onRowClick, selected, empty, initialSort, label }: {
  columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; onRowClick?: (r: T) => void; selected?: string | null;
  empty?: ReactNode; initialSort?: { id: string; dir: 1 | -1 }; label: string;
}) {
  const [sort, setSort] = useState(initialSort || null);
  const sorted = useMemo(() => {
    const col = sort && columns.find(c => c.id === sort.id);
    if (!col?.sort) return rows;
    const f = col.sort;
    return rows.slice().sort((a, b) => { const x = f(a), y = f(b); return (x < y ? -1 : x > y ? 1 : 0) * sort!.dir; });
  }, [rows, sort, columns]);
  const toggle = (id: string) => setSort(s => (s?.id === id ? (s.dir === 1 ? { id, dir: -1 } : null) : { id, dir: 1 }));
  return (
    <div className="tbl-wrap">
      <table className="tbl" aria-label={label}>
        <thead><tr>{columns.map(c => (
          <th key={c.id} className={c.align === 'right' ? 'r' : undefined} style={{ width: c.width }} aria-sort={sort?.id === c.id ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
            {c.sort ? <button type="button" onClick={() => toggle(c.id)}>{c.header}{sort?.id === c.id ? (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ChevronsUpDown size={12} opacity={.4} />}</button> : c.header}
          </th>))}</tr></thead>
        <tbody>
          {sorted.length ? sorted.map(r => {
            const k = rowKey(r);
            return (
              <tr key={k} data-key={k} data-sel={selected === k} className={onRowClick ? 'clickable' : undefined} onClick={onRowClick ? () => onRowClick(r) : undefined}
                tabIndex={onRowClick ? 0 : undefined} onKeyDown={onRowClick ? e => { if (e.key === 'Enter') onRowClick(r); } : undefined}>
                {columns.map(c => <td key={c.id} className={c.align === 'right' ? 'r' : undefined}>{c.cell(r)}</td>)}
              </tr>
            );
          }) : <tr><td colSpan={columns.length} className="tbl-empty">{empty || 'Sin resultados'}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
