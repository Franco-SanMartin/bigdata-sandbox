/* Lugar reservado mientras carga: la forma de lo que viene, nunca una pantalla negra. */
import type { CSSProperties } from 'react';

export function Skeleton({ w = '100%', h = 12, style }: { w?: number | string; h?: number | string; style?: CSSProperties }) {
  return <div className="skel" style={{ width: w, height: h, ...style }} aria-hidden="true" />;
}

/** Varias líneas de texto de largo variable */
export function SkeletonLines({ n = 3 }: { n?: number }) {
  return <div style={{ display: 'grid', gap: 8 }}>{Array.from({ length: n }, (_, i) => <Skeleton key={i} w={`${92 - ((i * 23) % 40)}%`} />)}</div>;
}

/** Una pantalla genérica: encabezado, fila de KPIs y dos paneles */
export function PageSkeleton() {
  return (
    <div className="page-in sk-page" aria-busy="true" aria-label="Cargando">
      <div className="sk-row" style={{ alignItems: 'center' }}><Skeleton w={180} h={24} /><Skeleton w={90} h={20} style={{ borderRadius: 11 }} /><div style={{ flex: 1 }} /><Skeleton w={120} h={32} /></div>
      <Skeleton h={64} />
      <div className="sk-row"><Skeleton h={320} style={{ flex: 2 }} /><Skeleton h={320} style={{ flex: 1 }} /></div>
    </div>
  );
}
