/* El árbol en 3D: cada nodo es una ficha (más petróleo cuanto más «vuelve» hay adentro), las ramas son
   cilindros y la fila baja por el camino que le toca, nodo por nodo, encendiendo las ramas que usa. */
import {
  BoxGeometry, Color, CylinderGeometry, Group, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, Quaternion, Vector3,
} from 'three';
import type { TreeViz } from '../../../api/types';
import { treeLayout } from '../../../lib/viz/tree';
import { fmt, pct } from './format';
import { type Stage, easeInOut } from './stage';

const UP = new Vector3(0, 1, 0);
const m4 = new Matrix4(), q = new Quaternion(), v3 = new Vector3(), tmp = new Color();

export const condition = (v: TreeViz, i: number) => {
  const n = v.nodes[i];
  return n.f === -1 ? null : `${v.features[n.f] ?? `columna ${n.f}`} ≤ ${fmt(n.t as number)}`;
};

export class TreeScene {
  readonly group = new Group();
  private pos: Vector3[] = [];
  private size: number;
  private nodes: InstancedMesh;
  private links: InstancedMesh;
  private linkOf: number[] = [];       // nodo hijo de cada rama
  private ball: Mesh;
  private path: number[] = [0];
  private t = 0;

  constructor(private stage: Stage, private v: TreeViz) {
    const { x, width, maxDepth } = treeLayout(v);
    const sx = Math.min(1.5, 16 / Math.max(1, width));
    const sy = Math.min(2.2, 9 / Math.max(1, maxDepth));
    this.size = Math.max(0.08, Math.min(0.55, sx * 0.42));
    v.nodes.forEach((n, i) => this.pos.push(new Vector3((x[i] - width / 2) * sx, (maxDepth / 2 - n.d) * sy, 0)));
    const c = stage.colors;

    this.nodes = new InstancedMesh(new BoxGeometry(1, 0.62, 0.42), new MeshStandardMaterial({ roughness: 0.6 }), v.nodes.length);
    this.nodes.setColorAt(0, c.node);
    stage.pickables.push({ mesh: this.nodes, tip: i => this.tip(i) });

    v.nodes.forEach(n => { if (n.f !== -1 && !n.cut && n.l >= 0) this.linkOf.push(n.l, n.r); });
    this.links = new InstancedMesh(new CylinderGeometry(1, 1, 1, 6, 1, true), new MeshBasicMaterial(), Math.max(1, this.linkOf.length));
    this.links.setColorAt(0, c.line);
    this.ball = new Mesh(new IcosahedronGeometry(1, 3), new MeshStandardMaterial({ color: c.text, roughness: 0.35 }));
    this.ball.scale.setScalar(this.size * 0.42);
    this.group.add(this.nodes, this.links, this.ball);

    if (v.nodes.length <= 31) {
      v.nodes.forEach((n, i) => {
        const at = this.pos[i].clone().add(new Vector3(0, -this.size * 0.62, 0));
        if (n.f === -1 || n.cut) stage.label(n.cut ? '…' : pct(n.p.at(-1) ?? 0, 0), at, 'mv-lbl-leaf');
        else stage.label(condition(v, i)!, at, 'mv-lbl-split');
      });
    }
    stage.scene.add(this.group);
    this.paint();
    // cada ficha con lugar para su etiqueta de abajo
    stage.fit(this.pos.flatMap(p => [p.clone().setY(p.y + this.size), p.clone().setY(p.y - this.size * 1.2), p.clone().setX(p.x + this.size * 1.6), p.clone().setX(p.x - this.size * 1.6)]), new Vector3(0.28, 0.22, 1), 1.04);
  }

  get end() { return this.path.length - 1; }

  setPath(path: number[]) {
    this.path = path;
    this.setProgress(Math.min(this.t, this.end));
  }

  setProgress(t: number) {
    this.t = t;
    const k = Math.min(this.path.length - 1, Math.floor(t));
    const a = this.pos[this.path[k]], b = this.pos[this.path[Math.min(this.path.length - 1, k + 1)]];
    const s = easeInOut(t - k);
    this.ball.position.copy(a).lerp(b, s).add(new Vector3(0, this.size * 0.55, this.size * 0.45));
    this.paint();
    this.stage.request();
  }

  private paint() {
    const c = this.stage.colors;
    const reached = new Set(this.path.slice(0, Math.floor(this.t + 1e-6) + 1));
    this.v.nodes.forEach((n, i) => {
      const share = n.p.at(-1) ?? 0;
      tmp.copy(c.surface).lerp(c.neg, 0.18).lerp(c.pos, share * 0.85);
      if (n.f !== -1 && !n.cut) tmp.lerp(c.bg, 0.45);
      const on = reached.has(i);
      const w = this.size * (on ? 1.18 : 1) * (n.f === -1 ? 1 : 1.25);
      m4.compose(this.pos[i], q.identity(), new Vector3(w, w, w));
      this.nodes.setMatrixAt(i, m4);
      this.nodes.setColorAt(i, on ? tmp.clone().lerp(c.text, 0.12) : tmp);
    });
    this.nodes.instanceMatrix.needsUpdate = true;
    if (this.nodes.instanceColor) this.nodes.instanceColor.needsUpdate = true;
    this.nodes.computeBoundingSphere();

    // ramas: las del camino ya recorrido, gruesas y en tinta; el tramo en curso se va llenando
    const used = new Map<number, number>();
    for (let k = 1; k < this.path.length; k++) used.set(this.path[k], Math.max(0, Math.min(1, this.t - (k - 1))));
    const parentOf = new Map<number, number>();
    this.v.nodes.forEach((n, i) => { if (n.f !== -1 && !n.cut && n.l >= 0) { parentOf.set(n.l, i); parentOf.set(n.r, i); } });
    this.linkOf.forEach((child, idx) => {
      const a = this.pos[parentOf.get(child)!], b = this.pos[child];
      v3.subVectors(b, a);
      const len = v3.length();
      q.setFromUnitVectors(UP, v3.normalize());
      const fill = used.get(child) ?? 0;
      const r = this.size * (fill > 0 ? 0.075 : 0.035);
      m4.compose(a.clone().add(b).multiplyScalar(0.5), q, new Vector3(r, len, r));
      this.links.setMatrixAt(idx, m4);
      this.links.setColorAt(idx, tmp.copy(c.line).lerp(c.text, fill * 0.85));
    });
    this.links.instanceMatrix.needsUpdate = true;
    if (this.links.instanceColor) this.links.instanceColor.needsUpdate = true;
    this.links.computeBoundingSphere();
  }

  private tip(i: number): string {
    const n = this.v.nodes[i];
    const share = this.v.classes.map((cl, j) => `${cl} ${pct(n.p[j] ?? 0)}`).join(' · ');
    const head = n.cut ? 'acá sigue el árbol (no se manda: pasa del tope de nodos)' : n.f === -1 ? 'hoja: decide' : `pregunta: ${condition(this.v, i)}  (sí → izquierda)`;
    return `${head}\n${this.v.impurity} ${fmt(n.imp)} · ${n.n} filas de entrenamiento\n${share}`;
  }
}
