/* Lo común de los dibujos en 3D: renderer, cámara que se orbita y hace zoom, luces suaves, etiquetas
   en HTML encima del canvas, tooltip al pasar el mouse y un bucle que dibuja solo cuando hace falta
   (algo se mueve o la cámara todavía frena). dispose() libera todo lo que se le dio a la GPU. */
import {
  AmbientLight, Color, DirectionalLight, HemisphereLight, type InstancedMesh, type Mesh, type Object3D,
  PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** Colores del sistema (tokens.css), leídos en vivo: el dibujo no tiene colores propios */
export interface Palette { bg: Color; surface: Color; line: Color; node: Color; ink: Color; text: Color; muted: Color; pos: Color; neg: Color }

export function palette(el: Element = document.documentElement): Palette {
  const cs = getComputedStyle(el);
  const c = (name: string, fallback: string) => new Color((cs.getPropertyValue(name).trim() || fallback));
  return {
    bg: c('--surface', 'white'), surface: c('--n-2', 'whitesmoke'), line: c('--n-5', 'gainsboro'), node: c('--n-6', 'silver'),
    ink: c('--n-11', 'dimgray'), text: c('--text', 'black'), muted: c('--n-8', 'darkgray'),
    // positivo = acento de interacción (petróleo); negativo = tinta
    pos: c('--accent', 'teal'), neg: c('--n-11', 'dimgray'),
  };
}

/** Por qué no se puede dibujar en 3D (null si se puede) */
export function webglProblem(): string | null {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return 'Este navegador no tiene WebGL, o lo tiene apagado (aceleración por hardware desactivada)';
    (gl.getExtension('WEBGL_lose_context') as { loseContext?: () => void } | null)?.loseContext?.();
    return null;
  } catch (e) {
    return `No se pudo abrir WebGL: ${(e as Error).message}`;
  }
}

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export interface Pickable {
  mesh: InstancedMesh | Mesh;
  /** Texto del tooltip para la instancia (o null si no dice nada) */
  tip: (index: number, point: Vector3) => string | null;
  onPick?: (index: number) => void;
}

export interface Label { el: HTMLElement; pos: Vector3; hideBehind?: boolean }

export class Stage {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  readonly controls: OrbitControls;
  readonly colors: Palette;
  /** Lo que se anima: cada uno devuelve true mientras quiera otro cuadro */
  readonly animators = new Set<(now: number) => boolean>();
  pickables: Pickable[] = [];
  frames = 0;
  private labels: Label[] = [];
  private raf = 0;
  private home: { pos: Vector3; target: Vector3 } = { pos: new Vector3(), target: new Vector3() };
  private ro: ResizeObserver;
  private ray = new Raycaster();
  private mouse = new Vector2();
  private hoverAt: { x: number; y: number } | null = null;
  private cleanup: (() => void)[] = [];

  constructor(private host: HTMLElement, private labelLayer: HTMLElement, private tooltip: HTMLElement) {
    this.colors = palette(host);
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(this.colors.bg, 1);
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    host.prepend(this.renderer.domElement);
    this.camera = new PerspectiveCamera(38, 1, 0.1, 400);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.rotateSpeed = 0.7;
    this.controls.zoomSpeed = 0.8;
    this.controls.addEventListener('change', () => this.request());
    this.scene.add(new HemisphereLight(0xffffff, this.colors.surface.getHex(), 1.6));
    this.scene.add(new AmbientLight(0xffffff, 0.5));
    const sun = new DirectionalLight(0xffffff, 1.1);
    sun.position.set(4, 8, 6);
    this.scene.add(sun);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    const move = (e: PointerEvent) => {
      const r = this.renderer.domElement.getBoundingClientRect();
      this.hoverAt = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.mouse.set((this.hoverAt.x / r.width) * 2 - 1, -(this.hoverAt.y / r.height) * 2 + 1);
      this.request();
    };
    const leave = () => { this.hoverAt = null; this.tooltip.hidden = true; };
    const click = () => { const hit = this.hit(); if (hit) hit.p.onPick?.(hit.i); };
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('click', click);
    this.cleanup.push(() => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); el.removeEventListener('click', click); });
  }

  /** Dónde mira la cámara al empezar (y al reencuadrar) */
  frame(pos: Vector3, target: Vector3) {
    this.home = { pos: pos.clone(), target: target.clone() };
    this.camera.position.copy(pos);
    this.controls.target.copy(target);
    this.controls.update();
    this.request();
  }

  /** Encuadra los puntos mirando desde `dir`: la distancia justa para que entren todos con un margen */
  fit(points: Vector3[], dir: Vector3, pad = 1.1) {
    const center = new Vector3();
    if (points.length) {
      const lo = points[0].clone(), hi = points[0].clone();
      points.forEach(p => { lo.min(p); hi.max(p); });
      center.addVectors(lo, hi).multiplyScalar(0.5);
    }
    const back = dir.clone().normalize();
    const right = new Vector3().crossVectors(new Vector3(0, 1, 0), back).normalize();
    const up = new Vector3().crossVectors(back, right);
    const tanV = Math.tan((this.camera.fov * Math.PI) / 360), tanH = tanV * this.camera.aspect;
    let d = 1;
    const rel = new Vector3();
    for (const p of points) {
      rel.subVectors(p, center);
      const z = rel.dot(back);
      d = Math.max(d, z + (Math.abs(rel.dot(right)) * pad) / tanH, z + (Math.abs(rel.dot(up)) * pad) / tanV);
    }
    this.frame(center.clone().addScaledVector(back, d), center);
  }

  resetView() { this.frame(this.home.pos, this.home.target); }

  label(text: string, pos: Vector3, cls = '', hideBehind = false): Label {
    const el = document.createElement('span');
    el.className = `mv-lbl ${cls}`.trim();
    el.textContent = text;
    this.labelLayer.append(el);
    const l = { el, pos: pos.clone(), hideBehind };
    this.labels.push(l);
    this.request();
    return l;
  }

  clearLabels() { this.labels.forEach(l => l.el.remove()); this.labels = []; }

  request() {
    if (!this.raf) this.raf = requestAnimationFrame(t => this.tick(t));
  }

  private tick(now: number) {
    this.raf = 0;
    let more = false;
    for (const a of this.animators) if (a(now)) more = true;
    const moving = this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.frames++;
    this.host.dataset.frames = String(this.frames);
    this.placeLabels();
    this.hover();
    if (more || moving) this.request();
  }

  private resize() {
    const w = Math.max(10, this.host.clientWidth), h = Math.max(10, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.request();
  }

  private placeLabels() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    const v = new Vector3();
    for (const l of this.labels) {
      v.copy(l.pos).project(this.camera);
      const off = v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1;
      l.el.style.visibility = off ? 'hidden' : 'visible';
      l.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -50%)`;
    }
  }

  private hit(): { p: Pickable; i: number; at: Vector3 } | null {
    if (!this.hoverAt) return null;
    this.ray.setFromCamera(this.mouse, this.camera);
    let best: { p: Pickable; i: number; d: number; at: Vector3 } | null = null;
    for (const p of this.pickables) {
      if (!p.mesh.visible) continue;
      const hits = this.ray.intersectObject(p.mesh, false);
      const h = hits[0];
      if (h && (!best || h.distance < best.d)) best = { p, i: h.instanceId ?? 0, d: h.distance, at: h.point };
    }
    return best;
  }

  private hover() {
    const hit = this.hit();
    const text = hit ? hit.p.tip(hit.i, hit.at) : null;
    this.renderer.domElement.style.cursor = hit?.p.onPick ? 'pointer' : hit ? 'help' : 'grab';
    if (!text || !this.hoverAt) { this.tooltip.hidden = true; return; }
    this.tooltip.hidden = false;
    this.tooltip.textContent = text;
    const w = this.host.clientWidth;
    const x = Math.min(this.hoverAt.x + 14, w - this.tooltip.offsetWidth - 6);
    this.tooltip.style.transform = `translate(${Math.max(6, x)}px, ${this.hoverAt.y + 16}px)`;
  }

  /** Deja el escenario vacío para otra escena (la cámara y el renderer siguen) */
  clearScene(group: Object3D) {
    this.drop(group);
    this.clearLabels();
    this.pickables = [];
    this.tooltip.hidden = true;
    this.request();
  }

  /** Saca un objeto de la escena y libera su geometría y materiales */
  drop(o: Object3D) {
    o.removeFromParent();
    o.traverse(x => free(x));
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.animators.clear();
    this.cleanup.forEach(f => f());
    this.ro.disconnect();
    this.controls.dispose();
    this.clearLabels();
    this.scene.traverse(x => free(x));
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

function free(x: Object3D) {
  const m = x as Mesh;
  m.geometry?.dispose();
  const mat = m.material;
  if (Array.isArray(mat)) mat.forEach(t => t.dispose());
  else mat?.dispose();
  (x as InstancedMesh).dispose?.();
}

/** Un avance de 0 a `end` (capas, nodos del camino, iteraciones, épocas) que se reproduce, se pausa o
   se mueve de a un paso. Con prefers-reduced-motion no hay animación continua: cada paso salta. */
export class Player {
  t = 0;
  playing = false;
  speed = 1;
  private goal: number | null = null;
  private last = 0;
  private shown = '';
  private readonly loop = (now: number) => this.frame(now);

  constructor(
    private stage: Stage,
    public end: number,
    private apply: (t: number) => void,
    private onChange: (s: { at: number; playing: boolean }) => void,
    /** Cuánto tarda cada unidad a velocidad 1 */
    public unitMs = 900,
  ) {
    stage.animators.add(this.loop);
  }

  get still() { return reducedMotion(); }

  play() {
    if (this.still) { this.step(1); return; }
    if (this.t >= this.end - 1e-9) this.t = 0;
    this.playing = true;
    this.goal = null;
    this.kick();
  }

  pause() { this.playing = false; this.goal = null; this.notify(); }

  toggle() { if (this.playing) this.pause(); else this.play(); }

  step(dir: 1 | -1) {
    this.playing = false;
    const base = this.goal ?? this.t;
    const to = Math.max(0, Math.min(this.end, dir > 0 ? Math.floor(base + 1e-6) + 1 : Math.ceil(base - 1e-6) - 1));
    if (this.still) this.seek(to);
    else { this.goal = to; this.kick(); }
  }

  seek(t: number) {
    this.playing = false;
    this.goal = null;
    this.t = Math.max(0, Math.min(this.end, t));
    this.apply(this.t);
    this.notify();
    this.stage.request();
  }

  setEnd(end: number) { this.end = end; if (this.t > end) this.seek(end); }

  dispose() { this.stage.animators.delete(this.loop); }

  private kick() { this.last = 0; this.notify(); this.stage.request(); }

  private frame(now: number): boolean {
    const dt = this.last ? Math.min(64, now - this.last) : 16;
    this.last = now;
    if (this.playing) {
      this.t += (dt * this.speed) / this.unitMs;
      if (this.t >= this.end) { this.t = this.end; this.playing = false; }
    } else if (this.goal != null) {
      const d = this.goal - this.t, mv = (dt * this.speed * 2.2) / this.unitMs;
      if (Math.abs(d) <= mv) { this.t = this.goal; this.goal = null; } else this.t += Math.sign(d) * mv;
    } else return false;
    this.apply(this.t);
    this.notify();
    return this.playing || this.goal != null;
  }

  private notify() {
    const at = Math.round(this.t * 1000) / 1000;
    const key = `${Math.floor(at + 1e-6)}|${this.playing || this.goal != null}`;
    if (key === this.shown) return;
    this.shown = key;
    this.onChange({ at: Math.floor(at + 1e-6), playing: this.playing || this.goal != null });
  }
}
