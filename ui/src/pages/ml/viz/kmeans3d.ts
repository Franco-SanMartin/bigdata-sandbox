/* KMeans en 3D: las filas de muestra como puntos (en el espacio escalado; con más de 3 columnas, las 3
   direcciones principales), los centros como fichas grandes que se mueven iteración por iteración y los
   puntos que cambian de grupo cuando otro centro les queda más cerca. */
import {
  BufferGeometry, Color, Float32BufferAttribute, GridHelper, Group, IcosahedronGeometry, InstancedMesh, Line,
  LineBasicMaterial, Matrix4, Mesh, MeshStandardMaterial, OctahedronGeometry, Quaternion, Vector3,
} from 'three';
import type { KMeansViz } from '../../../api/types';
import { axes, kmScale, nearest, project } from '../../../lib/viz/kmeans';
import { fmt } from './format';
import { type Palette, type Stage, easeInOut } from './stage';

const m4 = new Matrix4(), q = new Quaternion(), s3 = new Vector3();
const BOX = 3.2;

/** Tonos de los grupos: petróleo, tinta y gris, y después versiones más claras (sin colores nuevos) */
export function groupTones(c: Palette, k: number): Color[] {
  const base = [c.pos, c.neg, c.muted];
  return Array.from({ length: k }, (_, g) => base[g % 3].clone().lerp(c.bg, Math.floor(g / 3) * 0.38));
}

export class KMeansScene {
  readonly group = new Group();
  readonly tones: Color[];
  private pts: Vector3[];
  private z: number[][];
  private scale: number;
  private points: InstancedMesh;
  private centers: InstancedMesh;
  private link: Line;
  private marker: Mesh;
  private sel = -1;
  private selZ: number[] | null = null;
  private t = 0;
  groups: number[] = [];

  constructor(private stage: Stage, private v: KMeansViz, onPick: (row: number) => void) {
    const rows = v.sample?.rows ?? [];
    this.z = rows.map(x => kmScale(v, x));
    const proj = this.z.map(z => project(v, z));
    const allC = v.frames.flatMap(f => f.centers.map(c => project(v, c)));
    const mx = Math.max(1e-9, ...[...proj, ...allC].flat().map(Math.abs));
    this.scale = BOX / mx;
    this.pts = proj.map(p => new Vector3(...p).multiplyScalar(this.scale));
    const c = stage.colors;
    this.tones = groupTones(c, v.k);

    const names = axes(v);
    const flat = names[2] === '—';
    const grid = new GridHelper(BOX * 2, 8, c.line, c.line);
    if (flat) { grid.rotation.x = Math.PI / 2; grid.position.z = -0.02; } else grid.position.y = -BOX;
    this.group.add(grid);
    // ejes con su nombre
    const dirs = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
    dirs.forEach((d, i) => {
      if (names[i] === '—') return;
      const g = new BufferGeometry().setFromPoints([d.clone().multiplyScalar(-BOX), d.clone().multiplyScalar(BOX)]);
      this.group.add(new Line(g, new LineBasicMaterial({ color: c.muted })));
      stage.label(names[i], d.clone().multiplyScalar(BOX + 0.5), 'mv-lbl-axis');
    });

    this.points = new InstancedMesh(new IcosahedronGeometry(1, 1), new MeshStandardMaterial({ roughness: 0.7 }), Math.max(1, this.pts.length));
    this.points.setColorAt(0, c.node);
    stage.pickables.push({ mesh: this.points, tip: i => this.pointTip(i), onPick });
    this.centers = new InstancedMesh(new OctahedronGeometry(1, 0), new MeshStandardMaterial({ roughness: 0.35, flatShading: true }), v.k);
    this.centers.setColorAt(0, c.node);
    stage.pickables.push({ mesh: this.centers, tip: i => `centro del grupo ${i + 1}\niteración ${this.iter()} de ${v.frames.at(-1)!.it}` });
    // el recorrido de cada centro
    for (let g = 0; g < v.k; g++) {
      const path = v.frames.map(f => new Vector3(...project(v, f.centers[g])).multiplyScalar(this.scale));
      this.group.add(new Line(new BufferGeometry().setFromPoints(path), new LineBasicMaterial({ color: this.tones[g].clone().lerp(c.bg, 0.45) })));
    }
    const lg = new BufferGeometry();
    lg.setAttribute('position', new Float32BufferAttribute(new Float32Array(6), 3));
    this.link = new Line(lg, new LineBasicMaterial({ color: c.text }));
    this.link.visible = false;
    this.marker = new Mesh(new IcosahedronGeometry(1, 2), new MeshStandardMaterial({ color: c.text, roughness: 0.4 }));
    this.marker.scale.setScalar(0.12 * BOX / 3);
    this.marker.visible = false;
    this.group.add(this.points, this.centers, this.link, this.marker);
    stage.scene.add(this.group);
    const corners = [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => new Vector3(x, y, flat ? 0 : z).multiplyScalar(BOX + 0.3))));
    stage.fit(corners, flat ? new Vector3(0.22, 0.16, 1) : new Vector3(0.62, 0.48, 1), flat ? 1.14 : 0.92);
    this.setProgress(this.end);
  }

  get end() { return this.v.frames.length - 1; }

  private iter() { return this.v.frames[Math.min(this.end, Math.round(this.t))].it; }

  /** Centros en el instante t (entre dos iteraciones, interpolados) */
  centersAt(t: number): number[][] {
    const k = Math.min(this.end, Math.floor(t)), f = easeInOut(t - k);
    const a = this.v.frames[k].centers, b = this.v.frames[Math.min(this.end, k + 1)].centers;
    return a.map((c, g) => c.map((val, i) => val + (b[g][i] - val) * f));
  }

  /** La fila elegida (índice de la muestra o -1) y su versión escalada */
  select(row: number, z: number[] | null) {
    this.sel = row;
    this.selZ = z;
    this.setProgress(this.t);
  }

  setProgress(t: number) {
    this.t = t;
    const cs = this.centersAt(t);
    this.groups = this.z.map(z => nearest(cs, z));
    const r = 0.055 * (this.pts.length > 200 ? 0.85 : 1.15) * BOX / 3;
    this.pts.forEach((p, i) => {
      m4.compose(p, q.identity(), s3.setScalar(i === this.sel ? r * 0.6 : r));
      this.points.setMatrixAt(i, m4);
      this.points.setColorAt(i, this.tones[this.groups[i]]);
    });
    this.points.instanceMatrix.needsUpdate = true;
    if (this.points.instanceColor) this.points.instanceColor.needsUpdate = true;
    this.points.computeBoundingSphere();
    const cp = cs.map(c => new Vector3(...project(this.v, c)).multiplyScalar(this.scale));
    cp.forEach((p, g) => {
      q.setFromAxisAngle(new Vector3(0, 1, 0), t * 0.9 + g);
      m4.compose(p, q, s3.setScalar(0.24 * BOX / 3));
      this.centers.setMatrixAt(g, m4);
      this.centers.setColorAt(g, this.tones[g]);
    });
    this.centers.instanceMatrix.needsUpdate = true;
    if (this.centers.instanceColor) this.centers.instanceColor.needsUpdate = true;
    this.centers.computeBoundingSphere();
    // de la fila elegida a su centro
    if (this.selZ) {
      const from = new Vector3(...project(this.v, this.selZ)).multiplyScalar(this.scale);
      const to = cp[nearest(cs, this.selZ)];
      const arr = this.link.geometry.getAttribute('position') as Float32BufferAttribute;
      arr.setXYZ(0, from.x, from.y, from.z);
      arr.setXYZ(1, to.x, to.y, to.z);
      arr.needsUpdate = true;
      this.link.geometry.computeBoundingSphere();
      this.link.visible = true;
      this.marker.position.copy(from);
      this.marker.visible = true;
    } else this.link.visible = this.marker.visible = false;
    this.stage.request();
  }

  private pointTip(i: number): string {
    const s = this.v.sample!;
    const real = s.real?.[i];
    return `fila ${i + 1} de la muestra · grupo ${this.groups[i] + 1}${real != null ? `\nsegmento real: ${real}` : ''}\n${this.v.features.map((f, j) => `${f} ${fmt(s.rows[i][j])}`).join(' · ')}\n(click para elegirla)`;
  }
}
