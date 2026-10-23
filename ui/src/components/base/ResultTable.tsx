/* Tabla de datos para resultados de consultas, muestras de archivos y tablas: encabezado fijo,
   números alineados, NULL marcado, orden por columna, copiar celda, exportar CSV y "mostrar más". */
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Download } from 'lucide-react';
import { downloadText, toCsv, type CsvCell } from '../../lib/csv';
import { nf } from '../../lib/format';
import { toast } from '../../state/ui';

export type RtCell = string | number | boolean | null;

const PAGE = 200;

export function ResultTable({ columns, types, rows, total, label, fileName = 'resultado', maxHeight, info }: {
  columns: string[];
  /** Tipo de cada columna para mostrar debajo del nombre (string, int, double…) */
  types?: string[];
  rows: RtCell[][];
  /** Filas que había en total, si el motor cortó */
  total?: number;
  label: string;
  /** Nombre del CSV sin extensión */
  fileName?: string;
  maxHeight?: number | string;
  /** Texto a la izquierda de la barra (tiempo, motor…) */
  info?: React.ReactNode;
}) {
  const [shown, setShown] = useState(PAGE);
  const [sort, setSort] = useState<{ i: number; dir: 1 | -1 } | null>(null);
  const numeric = useMemo(() => columns.map((_, j) => rows.length > 0 && rows.every(r => r[j] === null || typeof r[j] === 'number')), [columns, rows]);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const { i, dir } = sort;
    return rows.slice().sort((a, b) => {
      const x = a[i], y = b[i];
      if (x === y) return 0; if (x === null) return 1; if (y === null) return -1;
      return (x < y ? -1 : 1) * dir;
    });
  }, [rows, sort]);
  const toggle = (i: number) => setSort(s => (s?.i === i ? (s.dir === 1 ? { i, dir: -1 } : null) : { i, dir: 1 }));
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast({ title: 'Copiado', kind: 'ok' }); }
    catch { toast({ title: 'No se pudo copiar', description: 'Seleccioná el texto y usá Ctrl+C.', kind: 'bad' }); }
  };
  const csv = () => toCsv(columns, sorted as CsvCell[][]);
  const fmt = (c: RtCell) => (c === null ? 'NULL' : typeof c === 'number' ? (Number.isInteger(c) ? nf(c) : nf(c, 3)) : String(c));

  return (
    <div className="rt">
      <div className="rt-bar">
        <span><b>{nf(rows.length)}</b> {rows.length === 1 ? 'fila' : 'filas'}{total != null && total > rows.length && <> de {nf(total)}</>}</span>
        {info}
        <span className="end">
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => copy(csv())} disabled={!rows.length} title="Copiar todo como CSV"><Copy size={13} />Copiar</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => downloadText(`${fileName}.csv`, csv())} disabled={!rows.length} title="Bajar CSV"><Download size={13} />CSV</button>
        </span>
      </div>
      <div className="rt-scroll" style={{ maxHeight }}>
        <table aria-label={label}>
          <thead><tr>
            <th className="rn">#</th>
            {columns.map((c, i) => (
              <th key={i} className={numeric[i] ? 'r' : undefined} aria-sort={sort?.i === i ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                <button type="button" onClick={() => toggle(i)}>{c}{types?.[i] && <span className="ty">{types[i]}</span>}{sort?.i === i && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</button>
              </th>
            ))}
          </tr></thead>
          <tbody>
            {sorted.slice(0, shown).map((r, i) => (
              <tr key={i}>
                <td className="rn">{i + 1}</td>
                {r.map((c, j) => (
                  <td key={j} className={c === null ? 'n' : numeric[j] ? 'r' : undefined} tabIndex={-1} title={typeof c === 'string' && c.length > 40 ? c : undefined}
                    onDoubleClick={() => copy(c === null ? '' : String(c))}>{fmt(c)}</td>
                ))}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={columns.length + 1} className="tbl-empty">0 filas</td></tr>}
          </tbody>
        </table>
      </div>
      {sorted.length > shown && <div className="rt-more"><button type="button" className="btn btn-sm" onClick={() => setShown(n => n + PAGE)}>Mostrar {nf(Math.min(PAGE, sorted.length - shown))} más (van {nf(shown)} de {nf(sorted.length)})</button></div>}
    </div>
  );
}
