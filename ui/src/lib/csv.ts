/* Exportar una tabla a CSV (RFC 4180) y bajarla desde el navegador. */
export type CsvCell = string | number | boolean | null | undefined;

export function toCsv(columns: string[], rows: CsvCell[][], sep = ','): string {
  const esc = (v: CsvCell) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r;]/.test(s) || s.startsWith(' ') || s.endsWith(' ') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns, ...rows].map(r => r.map(esc).join(sep)).join('\r\n') + '\r\n';
}

/** Baja un texto como archivo. BOM para que Excel abra bien los acentos */
export function downloadText(name: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type: `${type};charset=utf-8` }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
