/* Regresión lineal, logística y clasificador tonto en 3D: lo que predice el modelo moviendo dos columnas
   (las demás quedan como la fila elegida) es un plano o una superficie; las filas de muestra se paran
   sobre lo que predijo el modelo para ellas y una línea las une con lo real (el residuo). */
import {
  BufferGeometry, Color, DoubleSide, Float32BufferAttribute, GridHelper, Group, IcosahedronGeometry, InstancedMesh,
  Line, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, Quaternion, Vector3,
  WireframeGeometry,
} from 'three';
import { fmt } from './format';
import type { Stage } from './stage';

export interface SurfaceModel {
  features: string[];
  /** Qué se predice (el nombre del eje vertical) */
  yLabel: string;
  /** Lo que predice el modelo para una fila completa */
  f: (x: number[]) => number;
  min: number[];
  max: number[];
  /** Filas de muestra: lo que predijo el servidor y lo real */
  points: { x: number[]; pred: number; real: number }[];
  /** Rango fijo del eje vertical (0..1 en probabilidades) */
  yFixed?: [number, number];
  yFormat?: (y: number) => string;
}

const N = 34;
const HALF = 3;
const HEIGHT = 3.4;
const m4 = new Matrix4(), q = new Quaternion(), s3 = new Vector3(), tmp = new Color();

export class SurfaceScene {
  readonly group = new Group();
  private surface: Mesh;
  private wire: LineSegments;
  private dots: InstancedMesh;
  private resid: LineSegments;
  private marker: Mesh;
  private drop: Line;
  private y0: number;
  private y1: number;
  private base: number[] = [];
  private t = 1;

  constructor(private stage: Stage, private m: SurfaceModel, private a: number, private b: number, onPick?: (row: number) => void) {
    const c = stage.colors;
    const inside = (p: { x: number[] }) => [a, b].every(i => p.x[i] >= m.min[i] && p.x[i] <= m.max[i]);
    const shown = m.points.filter(inside);
    const ys = (shown.length ? shown : m.points).flatMap(p => [p.pred, p.real]);
    if (m.yFixed) [this.y0, this.y1] = m.yFixed;
    else {
      const lo = Math.min(...ys), hi = Math.max(...ys), pad = (hi - lo) * 0.06 || 1;
      this.y0 = lo - pad;
      this.y1 = hi + pad;
    }
    const grid = new GridHelper(HALF * 2, 6, c.line, c.line);
    this.group.add(grid);
    const geo = new PlaneGeometry(HALF * 2, HALF * 2, N - 1, N - 1);
    geo.rotateX(-Math.PI / 2);
    geo.setAttribute('color', new Float32BufferAttribute(new Float32Array(N * N * 3), 3));
    this.surface = new Mesh(geo, new MeshStandardMaterial({ vertexColors: true, side: DoubleSide, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
    this.wire = new LineSegments(new WireframeGeometry(geo), new LineBasicMaterial({ color: c.bg.clone().lerp(c.neg, 0.16) }));
    stage.pickables.push({ mesh: this.surface, tip: (_, at) => this.surfaceTip(at) });

    this.dots = new InstancedMesh(new IcosahedronGeometry(1, 1), new MeshStandardMaterial({ roughness: 0.6 }), Math.max(1, m.points.length));
    this.dots.setColorAt(0, c.ink);
    stage.pickables.push({ mesh: this.dots, tip: i => this.dotTip(i), onPick });
    const rg = new BufferGeometry();
    rg.setAttribute('position', new Float32BufferAttribute(new Float32Array(m.points.length * 6), 3));
    rg.setAttribute('color', new Float32BufferAttribute(new Float32Array(m.points.length * 6), 3));
    this.resid = new LineSegments(rg, new LineBasicMaterial({ vertexColors: true }));
    this.marker = new Mesh(new IcosahedronGeometry(1, 3), new MeshStandardMaterial({ color: c.text, roughness: 0.35 }));
    this.marker.scale.setScalar(0.13);
    const dg = new BufferGeometry();
    dg.setAttribute('position', new Float32BufferAttribute(new Float32Array(6), 3));
    this.drop = new Line(dg, new LineBasicMaterial({ color: c.text }));
    this.group.add(this.surface, this.wire, this.dots, this.resid, this.marker, this.drop);

    // la cámara mira desde el lado bajo de la superficie: así sube alejándose y se le ve la cara de arriba
    const mid = m.min.map((lo, i) => (lo + m.max[i]) / 2);
    const rise = (i: number) => { const lo = [...mid], hi = [...mid]; lo[i] = m.min[i]; hi[i] = m.max[i]; return m.f(hi) - m.f(lo); };
    const sx = rise(a) > 1e-12 ? -1 : 1, sz = rise(b) > 1e-12 ? -1 : 1;
    const name = (i: number) => m.features[i];
    const ax = (text: string, x: number, z: number) => stage.label(text, new Vector3(x, 0, z), 'mv-lbl-axis');
    // los extremos de cada eje; los de la esquina de adelante, más adentro para que no se pisen
    const at = (end: number, near: number) => (end === near ? 0.3 : 0.8) * end * HALF;
    ax(`${name(a)} ${fmt(m.min[a])}`, at(-1, sx), sz * (HALF + 0.5));
    ax(`${name(a)} ${fmt(m.max[a])}`, at(1, sx), sz * (HALF + 0.5));
    ax(`${name(b)} ${fmt(m.min[b])}`, sx * (HALF + 0.55), at(-1, sz));
    ax(`${name(b)} ${fmt(m.max[b])}`, sx * (HALF + 0.55), at(1, sz));
    // el eje vertical, en la esquina de atrás
    const back = new Vector3(-sx * HALF, 0, -sz * HALF);
    stage.label(`${m.yLabel}: de ${this.yFmt(this.y0)} a ${this.yFmt(this.y1)}`, back.clone().setY(HEIGHT + 0.3), 'mv-lbl-axis');
    const axis = new BufferGeometry().setFromPoints([back, back.clone().setY(HEIGHT)]);
    this.group.add(new Line(axis, new LineBasicMaterial({ color: c.muted })));
    stage.scene.add(this.group);
    const corners = [-1, 1].flatMap(x => [0, HEIGHT + 0.4].flatMap(y => [-1, 1].map(z => new Vector3(x * (HALF + 0.6), y, z * (HALF + 0.6)))));
    stage.fit(corners, new Vector3(0.95 * sx, 0.5, sz), 1);
  }

  get end() { return 1; }

  private yFmt(y: number) { return this.m.yFormat ? this.m.yFormat(y) : fmt(y); }
  private X(v: number, i: number) { const lo = this.m.min[i], hi = this.m.max[i]; return hi > lo ? ((v - lo) / (hi - lo) - 0.5) * 2 * HALF : 0; }
  private Y(y: number) { return ((Math.min(this.y1, Math.max(this.y0, y)) - this.y0) / (this.y1 - this.y0)) * HEIGHT; }
  private unX(p: number, i: number) { return this.m.min[i] + (p / (2 * HALF) + 0.5) * (this.m.max[i] - this.m.min[i]); }

  /** La fila de la que salen las demás columnas (y el punto negro) */
  setBase(x: number[]) {
    this.base = x;
    const c = this.stage.colors;
    const pos = this.surface.geometry.getAttribute('position') as Float32BufferAttribute;
    const col = this.surface.geometry.getAttribute('color') as Float32BufferAttribute;
    const row = [...x];
    for (let v = 0; v < pos.count; v++) {
      row[this.a] = this.unX(pos.getX(v), this.a);
      row[this.b] = this.unX(pos.getZ(v), this.b);
      const y = this.Y(this.m.f(row));
      pos.setY(v, y);
      tmp.copy(c.bg).lerp(c.surface, 0.5).lerp(c.pos, 0.1 + 0.55 * (y / HEIGHT));
      col.setXYZ(v, tmp.r, tmp.g, tmp.b);
    }
    pos.needsUpdate = col.needsUpdate = true;
    this.surface.geometry.computeVertexNormals();
    this.surface.geometry.computeBoundingSphere();
    this.surface.geometry.computeBoundingBox();
    this.group.remove(this.wire);
    this.wire.geometry.dispose();
    this.wire = new LineSegments(new WireframeGeometry(this.surface.geometry), this.wire.material);
    this.group.add(this.wire);
    const p = new Vector3(this.X(x[this.a], this.a), this.Y(this.m.f(x)), this.X(x[this.b], this.b));
    this.marker.position.copy(p);
    const d = this.drop.geometry.getAttribute('position') as Float32BufferAttribute;
    d.setXYZ(0, p.x, 0, p.z);
    d.setXYZ(1, p.x, p.y, p.z);
    d.needsUpdate = true;
    this.drop.geometry.computeBoundingSphere();
    this.setProgress(this.t);
  }

  /** 0 = solo lo que predijo, 1 = la línea llega hasta lo real */
  setProgress(t: number) {
    this.t = t;
    const c = this.stage.colors;
    const pos = this.resid.geometry.getAttribute('position') as Float32BufferAttribute;
    const col = this.resid.geometry.getAttribute('color') as Float32BufferAttribute;
    this.m.points.forEach((p, i) => {
      const x = this.X(p.x[this.a], this.a), z = this.X(p.x[this.b], this.b);
      const out = Math.abs(x) > HALF + 1e-9 || Math.abs(z) > HALF + 1e-9;       // fuera de los ejes: no se dibuja
      const y0 = this.Y(p.pred), y1 = out ? y0 : this.Y(p.real);
      m4.compose(new Vector3(x, y0, z), q.identity(), s3.setScalar(out ? 0 : 0.05));
      this.dots.setMatrixAt(i, m4);
      this.dots.setColorAt(i, c.ink);
      pos.setXYZ(2 * i, x, y0, z);
      pos.setXYZ(2 * i + 1, x, y0 + (y1 - y0) * t, z);
      tmp.copy(p.real >= p.pred ? c.pos : c.neg).lerp(c.bg, 0.25);
      col.setXYZ(2 * i, tmp.r, tmp.g, tmp.b);
      col.setXYZ(2 * i + 1, tmp.r, tmp.g, tmp.b);
    });
    pos.needsUpdate = col.needsUpdate = true;
    this.resid.geometry.computeBoundingSphere();
    this.dots.instanceMatrix.needsUpdate = true;
    if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;
    this.dots.computeBoundingSphere();
    this.stage.request();
  }

  private surfaceTip(at: Vector3): string {
    const row = [...this.base];
    row[this.a] = this.unX(at.x, this.a);
    row[this.b] = this.unX(at.z, this.b);
    return `${this.m.features[this.a]} ${fmt(row[this.a])} · ${this.m.features[this.b]} ${fmt(row[this.b])}\n(el resto como la fila elegida)\npredice ${this.yFmt(this.m.f(row))}`;
  }

  private dotTip(i: number): string {
    const p = this.m.points[i];
    return `fila ${i + 1} de la muestra\npredijo ${this.yFmt(p.pred)} · real ${this.yFmt(p.real)}\nresiduo ${fmt(p.real - p.pred)}\n(click para elegirla)`;
  }
}
