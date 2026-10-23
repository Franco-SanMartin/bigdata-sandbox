/* Números de los dibujos: con coma decimal y los decimales que hagan falta según el tamaño (sin ceros de más). */
import { nf } from '../../../lib/format';

const upTo = (x: number, d: number) => x.toLocaleString('es-AR', { maximumFractionDigits: d });

export function fmt(x: number, d?: number): string {
  if (!Number.isFinite(x)) return String(x);
  if (d != null) return nf(x, d);
  const a = Math.abs(x);
  if (a === 0) return '0';
  if (a >= 1000) return upTo(x, 0);
  if (a >= 100) return upTo(x, 1);
  if (a >= 1) return upTo(x, 3);
  if (a >= 0.001) return upTo(x, 4);
  return x.toExponential(2).replace('.', ',');
}

export const pct = (p: number, d = 1) => `${nf(p * 100, d)} %`;
