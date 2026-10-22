export const nf = (n: number, d = 0) => n.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });

export const mbLabel = (v: number) => (v >= 1024 ? `${nf(v / 1024, 1)} GB` : `${nf(v, v < 10 && v % 1 ? 1 : 0)} MB`);

export function duration(sec: number): string {
  if (sec < 10) return `${nf(sec, 1)} s`;
  if (sec < 60) return `${nf(sec)} s`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min ${String(Math.floor(sec % 60)).padStart(2, '0')} s`;
  return `${Math.floor(sec / 3600)} h ${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')} min`;
}

export function uptime(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export const clock = (t: number) => new Date(t).toLocaleTimeString('es-AR', { hour12: false });

export function ago(now: number, t: number): string {
  const s = Math.max(0, (now - t) / 1000);
  if (s < 5) return 'recién';
  if (s < 60) return `hace ${Math.floor(s)} s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  return `hace ${Math.floor(s / 3600)} h`;
}

export const plural = (n: number, one: string, many = one + 's') => `${nf(n)} ${n === 1 ? one : many}`;

/** Como mbLabel, pero los archivos chiquitos van en bytes (texto.txt pesa 138 bytes, no "0 MB") */
export const sizeLabel = (mb: number) => (mb < 0.01 ? `${nf(Math.round(mb * 1048576))} bytes` : mbLabel(mb));
