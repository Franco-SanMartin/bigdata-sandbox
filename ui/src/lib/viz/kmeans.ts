/* KMeans: la fila escalada como la escaló el modelo, el centro más cercano y la proyección a 3D. */
import type { KMeansViz } from '../../api/types';

export function kmScale(v: KMeansViz, x: number[]): number[] {
  const t = v.transform;
  return x.map((raw, i) => {
    const val = t.log[i] ? Math.log(raw) : raw;
    const s = t.scale[i];
    if (s === 0) return t.zeroScale === 'zero' ? 0 : val - t.mean[i];
    return (val - t.mean[i]) / s;
  });
}

export function nearest(centers: number[][], z: number[]): number {
  let best = 0, bd = Infinity;
  centers.forEach((c, j) => {
    let d = 0;
    for (let i = 0; i < z.length; i++) d += (z[i] - c[i]) ** 2;
    if (d < bd) { bd = d; best = j; }
  });
  return best;
}

/** Grupo de una fila con los centros finales (los del modelo) */
export const kmGroup = (v: KMeansViz, x: number[]) => nearest(v.frames[v.frames.length - 1].centers, kmScale(v, x));

/** A 3D: con más de 3 columnas, las 3 direcciones principales; con menos, las que haya y 0 */
export function project(v: KMeansViz, z: number[]): [number, number, number] {
  if (v.pca) {
    const d = z.map((val, i) => val - v.pca!.mean[i]);
    const p = v.pca.comps.map(c => c.reduce((s, ci, i) => s + ci * d[i], 0));
    return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
  }
  return [z[0] ?? 0, z[1] ?? 0, z[2] ?? 0];
}

/** Ejes del dibujo: los nombres de las columnas o «componente 1..3» si hubo PCA */
export function axes(v: KMeansViz): string[] {
  if (v.pca) return ['componente 1', 'componente 2', 'componente 3'];
  return [0, 1, 2].map(i => v.features[i] ? (v.transform.log[i] ? `log(${v.features[i]})` : v.features[i]) + ' (escalada)' : '—');
}
