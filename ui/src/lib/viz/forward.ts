/* La cuenta de cada modelo con lo que devolvió GET /api/ml/models/{id}/viz: la misma que hace
   server/sandbox_server/jobs/viz.py (pasada_*), así lo que se ve en la pantalla es lo que predijo
   el modelo de verdad. Los tests la comparan con la muestra del servidor (tolerancia 1e-6). */
import type { DummyViz, LinearViz, LogisticViz, MlpViz, VizScaler } from '../../api/types';

/** (x − media) / escala; con escala 0, Spark da 0 y scikit-learn divide por 1 */
export function scaleRow(sc: VizScaler, x: number[]): number[] {
  return x.map((v, i) => {
    const s = sc.scale[i];
    if (s === 0) return sc.zeroScale === 'zero' ? 0 : v - sc.mean[i];
    return (v - sc.mean[i]) / s;
  });
}

export const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const ACT: Record<MlpViz['hidden'], (z: number) => number> = {
  relu: z => Math.max(z, 0), logistic: sigmoid, tanh: Math.tanh, identity: z => z,
};

export interface Pass {
  /** Lo que sale de cada capa: [0] = entradas escaladas, la última = salida (probabilidad o softmax) */
  acts: number[][];
  /** Antes de la activación, por capa (sin la de entrada) */
  pre: number[][];
  /** Probabilidad de cada clase */
  proba: number[];
  /** Clase que gana */
  pred: number;
}

/** Pasada hacia adelante de la red. W y B por defecto, los finales; para una época, los de ese cuadro */
export function forward(v: MlpViz, x: number[], W: number[][][] = v.weights!, B: number[][] = v.biases!): Pass {
  let a = scaleRow(v.scaler, x);
  const acts = [a];
  const pre: number[][] = [];
  const act = ACT[v.hidden];
  for (let k = 0; k < W.length; k++) {
    const w = W[k], b = B[k];
    const z = b.map((bj, j) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * w[i][j]; return s + bj; });
    pre.push(z);
    if (k < W.length - 1) a = z.map(act);
    else if (v.out === 'softmax') {
      const mx = Math.max(...z);
      const e = z.map(t => Math.exp(t - mx));
      const tot = e.reduce((s, t) => s + t, 0);
      a = e.map(t => t / tot);
    } else a = [sigmoid(z[0])];
    acts.push(a);
  }
  const proba = v.out === 'softmax' ? a : [1 - a[0], a[0]];
  return { acts, pre, proba, pred: argmax(proba) };
}

export const argmax = (p: number[]) => p.reduce((best, v, i) => (v > p[best] ? i : best), 0);

/** Regresión lineal: constante + Σ coef·x, y lo que aporta cada columna */
export function linearPredict(v: LinearViz, x: number[]): { value: number; parts: number[] } {
  const parts = v.coef.map((c, i) => c * x[i]);
  return { value: parts.reduce((s, p) => s + p, 0) + v.intercept, parts };
}

/** Regresión logística: z = constante + Σ coef·x escalado; probabilidad de 'vuelve' = sigmoide(z) */
export function logisticProba(v: LogisticViz, x: number[]): { z: number; proba: number[]; parts: number[] } {
  const xs = scaleRow(v.scaler, x);
  const parts = v.coef.map((c, i) => c * xs[i]);
  const z = parts.reduce((s, p) => s + p, v.intercept);
  const p = sigmoid(z);
  return { z, proba: [1 - p, p], parts };
}

/** Clasificador tonto: no mira la fila. stratified sortea, así que no se puede rehacer (devuelve null) */
export function dummyProba(v: DummyViz): number[] | null {
  if (v.strategy === 'most_frequent') return v.prior.map((_, i) => (i === argmax(v.prior) ? 1 : 0));
  if (v.strategy === 'prior') return [...v.prior];
  if (v.strategy === 'uniform') return v.prior.map(() => 1 / v.prior.length);
  return null;
}
