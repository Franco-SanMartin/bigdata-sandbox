/* La red neuronal en 3D: cada capa es un plano de neuronas, las conexiones son cilindros finos
   (grosor e intensidad según |peso|, petróleo si el peso es positivo y tinta si es negativo) y
   el dato avanza capa por capa con pulsos que salen de las conexiones que más aportan. */
import {
  Color, CylinderGeometry, DoubleSide, EdgesGeometry, Group, IcosahedronGeometry, InstancedMesh, LineBasicMaterial,
  LineSegments, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion, Vector3,
} from 'three';
import type { MlpViz } from '../../../api/types';
import type { Pass } from '../../../lib/viz/forward';
import { fmt, pct } from './format';
import { type Label, type Stage, clamp01, easeInOut } from './stage';

const GAP = 3.4;
/** Más conexiones que esto no se dibujan (quedan las de mayor |peso| de cada capa) */
export const MAX_EDGES = 6000;
const MAX_PULSES = 220;

interface Edge { k: number; i: number; j: number; a: Vector3; b: Vector3 }

const UP = new Vector3(0, 1, 0);
const m4 = new Matrix4(), q = new Quaternion(), s3 = new Vector3(), v3 = new Vector3(), tmp = new Color();

export class NetScene {
  readonly group = new Group();
  /** Cuántas conexiones hay en total y cuántas se dibujan */
  readonly edgeCount: { total: number; drawn: number };
  private pos: Vector3[][] = [];
  private radius: number[] = [];
  private nodes: InstancedMesh;
  private nodeIndex: { k: number; i: number }[] = [];
  private edges: Edge[] = [];
  private edgeMesh: InstancedMesh | null = null;
  private pulses: InstancedMesh | null = null;
  private pulseList: { e: number; size: number; neg: boolean; delay: number }[][] = [];
  private W: number[][][] | null;
  private B: number[][] | null;
  private pass: Pass | null = null;
  private t = 0;
  private raw: number[] = [];
  private outLabels: Label[] = [];

  constructor(private stage: Stage, private v: MlpViz) {
    this.W = v.weights;
    this.B = v.biases;
    const L = v.layers.length;
    const c = stage.colors;
    v.layers.forEach((n, k) => {
      const big = n > 64;
      const sp = big ? 0.34 : 0.62;
      const cols = n <= 6 ? 1 : Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      const x = (k - (L - 1) / 2) * GAP;
      this.radius.push(big ? 0.075 : 0.13);
      this.pos.push(Array.from({ length: n }, (_, i) => {
        const r = Math.floor(i / cols), col = i % cols;
        return new Vector3(x, ((rows - 1) / 2 - r) * sp, (col - (cols - 1) / 2) * sp);
      }));
      // el plano de la capa
      const w = cols * sp + 0.45, h = rows * sp + 0.45;
      const plane = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: c.surface, transparent: true, opacity: 0.7, side: DoubleSide, depthWrite: false }));
      plane.rotation.y = Math.PI / 2;
      plane.position.set(x, 0, 0);
      plane.renderOrder = -1;
      const border = new LineSegments(new EdgesGeometry(plane.geometry), new LineBasicMaterial({ color: c.line }));
      border.rotation.copy(plane.rotation);
      border.position.copy(plane.position);
      this.group.add(plane, border);
      const title = k === 0 ? `entrada · ${n}` : k === L - 1 ? `salida · ${v.out === 'softmax' ? 'softmax' : 'logística'}` : `oculta ${k} · ${n} · ${v.hidden}`;
      stage.label(title, new Vector3(x, h / 2 + 0.38, 0), 'mv-lbl-layer');
    });

    // neuronas
    const total = v.layers.reduce((a, b) => a + b, 0);
    this.nodes = new InstancedMesh(new IcosahedronGeometry(1, 3), new MeshStandardMaterial({ roughness: 0.55, metalness: 0 }), total);
    v.layers.forEach((n, k) => { for (let i = 0; i < n; i++) this.nodeIndex.push({ k, i }); });
    this.nodes.setColorAt(0, c.node);
    this.group.add(this.nodes);
    stage.pickables.push({ mesh: this.nodes, tip: i => this.nodeTip(i) });

    // conexiones: si hay muchas, las de mayor |peso| de cada capa
    let all = 0;
    if (this.W) {
      const W = this.W;
      all = W.reduce((s, w) => s + w.length * w[0].length, 0);
      W.forEach((w, k) => {
        const list: { i: number; j: number; m: number }[] = [];
        w.forEach((row, i) => row.forEach((val, j) => list.push({ i, j, m: Math.abs(val) })));
        const keep = all > MAX_EDGES ? Math.max(1, Math.floor((MAX_EDGES * list.length) / all)) : list.length;
        if (keep < list.length) list.sort((a, b) => b.m - a.m);
        for (const e of list.slice(0, keep)) this.edges.push({ k, i: e.i, j: e.j, a: this.pos[k][e.i], b: this.pos[k + 1][e.j] });
      });
      const geo = new CylinderGeometry(1, 1, 1, 6, 1, true);
      this.edgeMesh = new InstancedMesh(geo, new MeshBasicMaterial({ transparent: false }), this.edges.length);
      this.edgeMesh.setColorAt(0, c.line);
      this.group.add(this.edgeMesh);
      stage.pickables.push({ mesh: this.edgeMesh, tip: i => this.edgeTip(i) });
      this.pulses = new InstancedMesh(new IcosahedronGeometry(1, 2), new MeshBasicMaterial(), MAX_PULSES * W.length);
      this.pulses.setColorAt(0, c.pos);
      this.pulses.count = 0;
      this.group.add(this.pulses);
    }
    this.edgeCount = { total: all, drawn: this.edges.length };

    // nombres de las entradas y de las salidas
    if (v.layers[0] <= 24) v.features.forEach((f, i) => stage.label(f, this.pos[0][i].clone().add(new Vector3(0, -0.24, 0)), 'mv-lbl-in'));
    this.pos[L - 1].forEach(p => this.outLabels.push(stage.label('', p.clone().add(new Vector3(0, -0.36, 0)), 'mv-lbl-out')));
    stage.scene.add(this.group);
    this.paintEdges();
    this.paintNodes();
    // el borde de cada plano y un poco de aire para los títulos y las etiquetas de abajo
    const box = this.pos.flatMap((ps, k) => ps.length ? [...ps, ps[0].clone().setY(ps[0].y + 0.7), ps.at(-1)!.clone().setY(ps.at(-1)!.y - 0.6), new Vector3(ps[0].x - (k === 0 ? 1.2 : 0), 0, 0)] : []);
    stage.fit(box, new Vector3(-0.2, 0.22, 1));
  }

  /** Pesos de una época (o los finales). Cambia grosor y color de las conexiones */
  setWeights(W: number[][][], B: number[][]) {
    this.W = W;
    this.B = B;
    this.paintEdges();
  }

  /** La pasada de una fila: qué sale de cada neurona y por dónde pasa más señal */
  setPass(pass: Pass, raw: number[]) {
    this.pass = pass;
    this.raw = raw;
    if (this.W && this.pulses) {
      const W = this.W;
      this.pulseList = W.map((w, k) => {
        const a = pass.acts[k];
        const list = this.edges.map((e, idx) => ({ idx, e, c: e.k === k ? a[e.i] * w[e.i][e.j] : 0 })).filter(x => x.e.k === k && x.c !== 0);
        list.sort((x, y) => Math.abs(y.c) - Math.abs(x.c));
        const top = list.slice(0, MAX_PULSES);
        const mx = Math.abs(top[0]?.c ?? 1) || 1;
        return top.map((x, r) => ({ e: x.idx, size: 0.035 + 0.06 * Math.sqrt(Math.abs(x.c) / mx), neg: x.c < 0, delay: (r / Math.max(1, top.length)) * 0.35 }));
      });
      const c = this.stage.colors;
      let n = 0;
      this.pulseList.forEach(list => list.forEach(p => { this.pulses!.setColorAt(n++, p.neg ? c.neg : c.pos); }));
      this.pulses.count = n;
      if (this.pulses.instanceColor) this.pulses.instanceColor.needsUpdate = true;
    }
    this.setProgress(this.t);
  }

  /** Avance del dato: 0 = en la entrada, L−1 = llegó a la salida */
  setProgress(t: number) {
    this.t = t;
    this.paintNodes();
    this.placePulses();
    const done = this.lit(this.v.layers.length - 1) > 0.5 && this.pass;
    this.outLabels.forEach((l, i) => {
      const cls = this.v.out === 'softmax' ? i : 1;
      const p = this.pass ? (this.v.out === 'softmax' ? this.pass.acts.at(-1)![i] : this.pass.acts.at(-1)![0]) : 0;
      l.el.textContent = `${this.v.classes[cls] ?? cls}${done ? ` ${pct(p)}` : ''}`;
    });
    this.stage.request();
  }

  get end() { return this.v.layers.length - 1; }

  private lit(k: number) {
    if (!this.pass) return 0;
    return k === 0 ? 1 : easeInOut(clamp01((this.t - (k - 1) - 0.55) / 0.45));
  }

  private paintNodes() {
    const c = this.stage.colors;
    const L = this.v.layers.length;
    let n = 0;
    for (let k = 0; k < L; k++) {
      const a = this.pass?.acts[k];
      const mx = a ? Math.max(1e-9, ...a.map(Math.abs)) : 1;
      const lit = this.lit(k);
      for (let i = 0; i < this.v.layers[k]; i++) {
        let level = 0, neg = false;
        if (a) {
          const val = k === L - 1 ? (this.v.out === 'softmax' ? a[i] : a[0]) : a[i];
          level = k === L - 1 ? val : Math.abs(val) / mx;
          neg = k === 0 && val < 0;
        }
        level *= lit;
        tmp.copy(c.node).lerp(neg ? c.neg : c.pos, 0.15 + 0.85 * level);
        if (!a) tmp.copy(c.node);
        const r = this.radius[k] * (k === L - 1 ? 1.5 : 1) * (1 + 0.45 * level);
        m4.compose(this.pos[k][i], q.identity(), s3.setScalar(r));
        this.nodes.setMatrixAt(n, m4);
        this.nodes.setColorAt(n, tmp);
        n++;
      }
    }
    this.nodes.instanceMatrix.needsUpdate = true;
    if (this.nodes.instanceColor) this.nodes.instanceColor.needsUpdate = true;
    this.nodes.computeBoundingSphere();
  }

  private paintEdges() {
    if (!this.edgeMesh || !this.W) return;
    const c = this.stage.colors;
    const mx = this.W.map(w => Math.max(1e-9, ...w.flat().map(Math.abs)));
    this.edges.forEach((e, idx) => {
      const w = this.W![e.k][e.i][e.j];
      const m = Math.abs(w) / mx[e.k];
      v3.subVectors(e.b, e.a);
      const len = v3.length();
      q.setFromUnitVectors(UP, v3.normalize());
      const r = 0.004 + 0.026 * m;
      m4.compose(s3.addVectors(e.a, e.b).multiplyScalar(0.5), q, new Vector3(r, len, r));
      this.edgeMesh!.setMatrixAt(idx, m4);
      // la «opacidad» es mezclar con el fondo: así no hay que ordenar miles de transparencias
      tmp.copy(c.bg).lerp(w < 0 ? c.neg : c.pos, 0.08 + 0.72 * m);
      this.edgeMesh!.setColorAt(idx, tmp);
    });
    this.edgeMesh.instanceMatrix.needsUpdate = true;
    if (this.edgeMesh.instanceColor) this.edgeMesh.instanceColor.needsUpdate = true;
    this.edgeMesh.computeBoundingSphere();
    this.stage.request();
  }

  private placePulses() {
    if (!this.pulses) return;
    let n = 0;
    this.pulseList.forEach((list, k) => {
      const local = this.t - k;
      list.forEach(p => {
        const e = this.edges[p.e];
        const s = clamp01((local - p.delay) / 0.65);
        const show = local > p.delay && s < 1;
        m4.compose(v3.copy(e.a).lerp(e.b, easeInOut(s)), q.identity(), s3.setScalar(show ? p.size : 0));
        this.pulses!.setMatrixAt(n++, m4);
      });
    });
    this.pulses.instanceMatrix.needsUpdate = true;
    this.pulses.computeBoundingSphere();
  }

  private name(k: number, i: number) {
    const L = this.v.layers.length;
    if (k === 0) return this.v.features[i] ?? `entrada ${i + 1}`;
    if (k === L - 1) return this.v.out === 'softmax' ? `salida «${this.v.classes[i] ?? i}»` : `salida «${this.v.classes[1] ?? 1}»`;
    return `oculta ${k} · neurona ${i + 1}`;
  }

  private nodeTip(idx: number): string {
    const { k, i } = this.nodeIndex[idx];
    const L = this.v.layers.length;
    const head = this.name(k, i);
    if (!this.pass) return head;
    if (k === 0) return `${head}\nvalor ${fmt(this.raw[i])} → escalado ${fmt(this.pass.acts[0][i])}`;
    const z = this.pass.pre[k - 1][i], a = this.pass.acts[k][i];
    const b = this.B?.[k - 1][i];
    const fn = k === L - 1 ? (this.v.out === 'softmax' ? 'softmax' : 'logística') : this.v.hidden;
    const body = `z = Σ entrada·peso + sesgo = ${fmt(z)}${b != null ? ` (sesgo ${fmt(b)})` : ''}\n${fn}(z) = ${fmt(a)}`;
    return `${head}\n${body}${k === L - 1 ? `\nprobabilidad ${fmt(a * 100, 2)} %` : ''}`;
  }

  private edgeTip(idx: number): string {
    const e = this.edges[idx];
    const w = this.W![e.k][e.i][e.j];
    const a = this.pass?.acts[e.k][e.i];
    return `peso ${this.name(e.k, e.i)} → ${this.name(e.k + 1, e.j)}\n${fmt(w)}${a != null ? `\ncon esta fila aporta ${fmt(a)} × ${fmt(w)} = ${fmt(a * w)}` : ''}`;
  }
}
