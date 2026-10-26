/* Camino de una fila por el árbol (lo mismo que viz.pasada_arbol del servidor) y su dibujo en capas. */
import type { TreeViz } from '../../api/types';

/** scikit-learn pasa las entradas a float32 antes de comparar con el umbral (que queda en float64) */
export function treePath(v: TreeViz, x: number[]): { path: number[]; leaf: number; proba: number[] } {
  const xs = v.float32 ? x.map(Math.fround) : x;
  let i = 0;
  const path = [0];
  while (v.nodes[i].f !== -1 && !v.nodes[i].cut) {
    const n = v.nodes[i];
    i = xs[n.f] <= (n.t as number) ? n.l : n.r;
    path.push(i);
  }
  return { path, leaf: i, proba: v.nodes[i].p };
}

/** Posición de cada nodo: x repartido por hojas debajo (cada hoja un lugar), y por profundidad */
export function treeLayout(v: TreeViz): { x: number[]; depth: number[]; width: number; maxDepth: number } {
  const x = new Array<number>(v.nodes.length).fill(0);
  let next = 0;
  const place = (i: number): number => {
    const n = v.nodes[i];
    if (n.f === -1 || n.cut || n.l < 0) { x[i] = next++; return x[i]; }
    x[i] = (place(n.l) + place(n.r)) / 2;
    return x[i];
  };
  place(0);
  return { x, depth: v.nodes.map(n => n.d), width: Math.max(1, next - 1), maxDepth: Math.max(...v.nodes.map(n => n.d)) };
}
