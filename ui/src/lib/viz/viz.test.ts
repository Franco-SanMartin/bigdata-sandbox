import { describe, expect, it } from 'vitest';
import type { DummyViz, KMeansViz, LinearViz, LogisticViz, MlpViz, TreeViz } from '../../api/types';
// Lo que dejaron los jobs de verdad (ui/scripts/viz_demo.py): pesos, nodos, centros y lo que predijo el modelo
import arbolJson from '../../api/demo/viz/arbol.json';
import kmeansJson from '../../api/demo/viz/kmeans.json';
import linealJson from '../../api/demo/viz/lineal.json';
import logisticaJson from '../../api/demo/viz/logistica.json';
import mlpJson from '../../api/demo/viz/mlp.json';
import mlpSparkJson from '../../api/demo/viz/mlp-mllib.json';
import tontoJson from '../../api/demo/viz/tonto.json';
import { dummyProba, forward, linearPredict, logisticProba, scaleRow } from './forward';
import { axes, kmGroup, kmScale, nearest, project } from './kmeans';
import { treeLayout, treePath } from './tree';

const TOL = 1e-6;
const mlp = mlpJson as unknown as MlpViz;
const mlpSpark = mlpSparkJson as unknown as MlpViz;
const arbol = arbolJson as unknown as TreeViz;
const kmeans = kmeansJson as unknown as KMeansViz;
const lineal = linealJson as unknown as LinearViz;
const logistica = logisticaJson as unknown as LogisticViz;
const tonto = tontoJson as unknown as DummyViz;

function sameProba(rows: number[][], expected: number[][], f: (x: number[]) => number[]) {
  expect(rows.length).toBeGreaterThan(10);
  let worst = 0;
  rows.forEach((x, r) => f(x).forEach((p, c) => { worst = Math.max(worst, Math.abs(p - expected[r][c])); }));
  expect(worst).toBeLessThan(TOL);
}

describe('red neuronal: la pasada da lo que predijo el modelo', () => {
  it('scikit-learn (relu, salida logística)', () => {
    sameProba(mlp.sample!.rows, mlp.sample!.proba!, x => forward(mlp, x).proba);
    mlp.sample!.rows.forEach((x, i) => expect(forward(mlp, x).pred).toBe(mlp.sample!.pred![i]));
  });
  it('Spark MLlib (sigmoide, softmax)', () => {
    expect(mlpSpark.out).toBe('softmax');
    sameProba(mlpSpark.sample!.rows, mlpSpark.sample!.proba!, x => forward(mlpSpark, x).proba);
  });
  it('deja lo que sale de cada capa', () => {
    const p = forward(mlp, mlp.sample!.rows[0]);
    expect(p.acts.map(a => a.length)).toEqual(mlp.layers);
    expect(p.pre.map(a => a.length)).toEqual(mlp.layers.slice(1));
    expect(p.acts.slice(1, -1).flat().every(a => a >= 0)).toBe(true);    // relu
  });
  it('con los pesos de una época da otra cosa, y con los de la mejor casi lo mismo que el final', () => {
    const ep = mlp.epochs!;
    expect(ep.frames.length).toBeGreaterThan(5);
    const x = mlp.sample!.rows[3];
    const first = forward(mlp, x, ep.frames[0].weights, ep.frames[0].biases).proba;
    const best = ep.frames.find(f => f.epoch === ep.best)!;
    const atBest = forward(mlp, x, best.weights, best.biases).proba;
    const fin = forward(mlp, x).proba;
    expect(Math.abs(atBest[1] - fin[1])).toBeLessThan(1e-3);   // early stopping se queda con la mejor (redondeada a 5 decimales)
    expect(first[1]).not.toBeCloseTo(fin[1], 6);
  });
  it('escala 0: Spark da 0', () => {
    expect(scaleRow({ mean: [1, 2], scale: [0, 2], zeroScale: 'zero' }, [5, 6])).toEqual([0, 2]);
    expect(scaleRow({ mean: [1, 2], scale: [0, 2] }, [5, 6])).toEqual([4, 2]);
  });
});

describe('árbol', () => {
  it('el camino termina en la hoja que predijo', () => {
    sameProba(arbol.sample!.rows, arbol.sample!.proba!, x => treePath(arbol, x).proba);
    for (const x of arbol.sample!.rows) {
      const { path, leaf } = treePath(arbol, x);
      expect(path[0]).toBe(0);
      expect(arbol.nodes[leaf].f).toBe(-1);
      path.slice(1).forEach((n, i) => expect([arbol.nodes[path[i]].l, arbol.nodes[path[i]].r]).toContain(n));
    }
  });
  it('compara en float32 como scikit-learn', () => {
    const v: TreeViz = { ...arbol, float32: true, nodes: [
      { f: 0, t: 0.30000001192092896, imp: 0.5, n: 2, p: [0.5, 0.5], d: 0, l: 1, r: 2, cut: false },
      { f: -1, t: null, imp: 0, n: 1, p: [1, 0], d: 1, l: -1, r: -1, cut: false },
      { f: -1, t: null, imp: 0, n: 1, p: [0, 1], d: 1, l: -1, r: -1, cut: false }] };
    expect(treePath(v, [0.3000000119]).leaf).toBe(1);                       // en float32 es igual al umbral
    expect(treePath({ ...v, float32: false }, [0.3000000119]).leaf).toBe(1);
    expect(treePath({ ...v, float32: false }, [0.30000002]).leaf).toBe(2);
  });
  it('se para en un nodo cortado', () => {
    const v: TreeViz = { ...arbol, nodes: [{ ...arbol.nodes[0], cut: true, l: -1, r: -1 }] };
    expect(treePath(v, [1, 1, 1, 1, 1]).path).toEqual([0]);
  });
  it('dibujo: cada padre queda entre sus hijos', () => {
    const { x, maxDepth } = treeLayout(arbol);
    expect(maxDepth).toBe(3);
    arbol.nodes.forEach((n, i) => { if (n.f !== -1) expect(x[i]).toBe((x[n.l] + x[n.r]) / 2); });
  });
});

describe('KMeans', () => {
  it('cada fila va al grupo que le dio el modelo', () => {
    kmeans.sample!.rows.forEach((x, i) => expect(kmGroup(kmeans, x)).toBe(kmeans.sample!.pred![i]));
  });
  it('los cuadros terminan en los centros del modelo y los puntos cambian de grupo en el camino', () => {
    expect(kmeans.frames.length).toBeGreaterThan(1);
    const z = kmeans.sample!.rows.map(x => kmScale(kmeans, x));
    const first = z.map(p => nearest(kmeans.frames[0].centers, p));
    const last = z.map(p => nearest(kmeans.frames[kmeans.frames.length - 1].centers, p));
    expect(first.some((g, i) => g !== last[i])).toBe(true);
  });
  it('a 3D', () => {
    expect(kmeans.pca).toBeNull();
    expect(project(kmeans, [1, 2])).toEqual([1, 2, 0]);
    expect(axes(kmeans)[1]).toBe('log(ticket_promedio) (escalada)');
    const v: KMeansViz = { ...kmeans, pca: { mean: [1, 1, 1, 1], comps: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 1]] } };
    expect(project(v, [2, 3, 4, 5])).toEqual([1, 2, 4]);
  });
});

describe('regresiones y clasificador tonto', () => {
  it('lineal: constante + Σ coef·x', () => {
    lineal.sample!.rows.forEach((x, i) => {
      const p = lineal.sample!.pred![i];
      expect(Math.abs(linearPredict(lineal, x).value - p)).toBeLessThan(TOL * Math.max(1, Math.abs(p)));
    });
  });
  it('logística', () => sameProba(logistica.sample!.rows, logistica.sample!.proba!, x => logisticProba(logistica, x).proba));
  it('tonto', () => {
    sameProba(tonto.sample!.rows, tonto.sample!.proba!, () => dummyProba(tonto)!);
    expect(dummyProba({ ...tonto, strategy: 'stratified' })).toBeNull();
    expect(dummyProba({ ...tonto, strategy: 'prior' })).toEqual(tonto.prior);
  });
});
