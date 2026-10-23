/* «Por dentro»: el modelo entrenado dibujado en 3D con lo que devolvió GET /api/ml/models/{id}/viz.
   Todo lo que se ve sale de la cuenta de lib/viz (la misma que el servidor), así que lo que predice el
   dibujo es lo que predijo el modelo. Este archivo y three.js viajan en un chunk aparte: solo se bajan
   cuando alguien abre un modelo que tiene algo para dibujar. */
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, Scan, StepBack, StepForward } from 'lucide-react';
import type { DummyViz, KMeansViz, LinearViz, LogisticViz, MlpViz, ModelRun, ModelViz as Viz, TreeViz } from '../../../api/types';
import { SkeletonLines } from '../../../components/base';
import { Seg } from '../../../components/ui';
import { nf } from '../../../lib/format';
import { argmax, dummyProba, forward, linearPredict, logisticProba, scaleRow } from '../../../lib/viz/forward';
import { kmGroup, kmScale, nearest } from '../../../lib/viz/kmeans';
import { treePath } from '../../../lib/viz/tree';
import { useApi } from '../../../state/useApi';
import { fmt, pct } from './format';
import { KMeansScene } from './kmeans3d';
import { MAX_EDGES, NetScene } from './net';
import { Player, Stage, reducedMotion, webglProblem } from './stage';
import { type SurfaceModel, SurfaceScene } from './surface';
import { TreeScene, condition } from './tree3d';
import '../mv.css';

/* ------------------------------------------------------------------ piezas comunes */

interface Out { kind: string; row: number | 'manual'; out: Record<string, unknown>; epoch?: number | null }

/** El escenario 3D: el canvas, las etiquetas encima y el tooltip. null mientras no está (o si falló) */
function useStage(on: boolean) {
  const host = useRef<HTMLDivElement>(null), labels = useRef<HTMLDivElement>(null), tip = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  useEffect(() => {
    if (!on || !host.current) return;
    let s: Stage;
    try { s = new Stage(host.current, labels.current!, tip.current!); } catch (e) { setFail(`No se pudo crear el dibujo 3D: ${(e as Error).message}`); return; }
    const lost = (e: Event) => { e.preventDefault(); setFail('El navegador cortó el contexto de WebGL (poca memoria de video o demasiadas pestañas con 3D)'); };
    s.renderer.domElement.addEventListener('webglcontextlost', lost);
    setStage(s);
    return () => { s.renderer.domElement.removeEventListener('webglcontextlost', lost); s.dispose(); setStage(null); };
  }, [on]);
  const view = (
    <div className="mv-canvas" ref={host}>
      <div className="mv-labels" ref={labels} aria-hidden="true" />
      <div className="mv-tip" ref={tip} hidden role="tooltip" />
    </div>
  );
  return { stage, fail, view };
}

/** Reproductor atado a una escena: devuelve el estado para los botones */
function usePlayer(stage: Stage | null, end: number, apply: ((t: number) => void) | null, unitMs = 900) {
  const ref = useRef<Player | null>(null);
  const [st, setSt] = useState({ at: 0, playing: false });
  const [speed, setSpeed] = useState(1);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    if (!stage || !apply) return;
    const p = new Player(stage, end, t => applyRef.current?.(t), setSt, unitMs);
    p.speed = speed;
    ref.current = p;
    return () => { p.dispose(); ref.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, apply == null]);
  useEffect(() => { ref.current?.setEnd(end); }, [end]);
  useEffect(() => { if (ref.current) ref.current.speed = speed; }, [speed]);
  return { player: ref, st, speed, setSpeed };
}

function Transport({ p, end, what, extra, onReset }: { p: ReturnType<typeof usePlayer>; end: number; what: (at: number) => string; extra?: ReactNode; onReset?: () => void }) {
  const still = reducedMotion();
  const pl = p.player.current;
  return (
    <div className="mv-bar" role="group" aria-label="Controles de la animación">
      <button type="button" className="btn btn-sm btn-icon" onClick={() => pl?.step(-1)} disabled={!pl || p.st.at <= 0 && !p.st.playing} aria-label="Paso atrás" title="Paso atrás"><StepBack size={14} /></button>
      {!still && (
        <button type="button" className="btn btn-sm" onClick={() => pl?.toggle()} disabled={!pl} aria-label={p.st.playing ? 'Pausa' : 'Reproducir'} data-viz-play>
          {p.st.playing ? <Pause size={14} /> : <Play size={14} />}{p.st.playing ? 'pausa' : 'reproducir'}
        </button>
      )}
      <button type="button" className="btn btn-sm btn-icon" onClick={() => pl?.step(1)} disabled={!pl || p.st.at >= end && !p.st.playing} aria-label="Paso adelante" title="Paso adelante" data-viz-step><StepForward size={14} /></button>
      <span className="mv-at mono" aria-live="polite">{what(p.st.at)}</span>
      {!still && <Seg label="Velocidad" value={String(p.speed) as '0.5' | '1' | '2'} onChange={v => p.setSpeed(Number(v))}
        options={[{ value: '0.5', label: '½×' }, { value: '1', label: '1×' }, { value: '2', label: '2×' }]} />}
      {extra}
      {onReset && <button type="button" className="btn btn-sm btn-ghost mv-reset" onClick={onReset} title="Volver a la vista inicial"><Scan size={14} />reencuadrar</button>}
      {still && <span className="mv-still muted">sin animación (el sistema pide menos movimiento): de a un paso</span>}
    </div>
  );
}

/** Rango de cada columna para los controles deslizantes */
function rangesOf(v: Viz): { min: number[]; max: number[] } {
  if ('ranges' in v && v.ranges) return v.ranges;
  const rows = v.sample?.rows ?? [];
  return {
    min: v.features.map((_, i) => Math.min(...rows.map(r => r[i]))),
    max: v.features.map((_, i) => Math.max(...rows.map(r => r[i]))),
  };
}

/** La fila que pasa por el modelo: una de la muestra o valores a mano */
function useRow(v: Viz) {
  const rows = v.sample?.rows ?? [];
  const ranges = useMemo(() => rangesOf(v), [v]);
  const [row, setRow] = useState<number>(rows.length ? 0 : -1);
  const [x, setX] = useState<number[]>(() => rows[0] ?? ranges.min.map((lo, i) => (lo + ranges.max[i]) / 2));
  const pick = (i: number) => { if (rows[i]) { setRow(i); setX(rows[i]); } };
  // para los clicks en el dibujo, que se arman una sola vez
  const pickRef = useRef(pick);
  pickRef.current = pick;
  return {
    rows, row, x, ranges, pick, pickRef,
    set: (i: number, val: number) => { setRow(-1); setX(old => old.map((o, j) => (j === i ? val : o))); },
  };
}

function RowInputs({ v, r, realLabel }: { v: Viz; r: ReturnType<typeof useRow>; realLabel?: (real: number | string) => string }) {
  const [hand, setHand] = useState(false);
  const real = v.sample?.real;
  return (
    <div className="mv-in">
      <label className="mv-in-row">
        <span>fila</span>
        <select value={r.row} onChange={e => r.pick(Number(e.target.value))} data-viz-select>
          {r.row === -1 && <option value={-1}>valores a mano</option>}
          {r.rows.map((_, i) => <option key={i} value={i}>{`fila ${i + 1}${real?.[i] != null ? ` · real: ${realLabel ? realLabel(real[i]) : real[i]}` : ''}`}</option>)}
        </select>
        <button type="button" className="btn btn-sm btn-ghost" aria-expanded={hand} onClick={() => setHand(h => !h)}>{hand ? 'ocultar valores' : 'mover valores'}</button>
      </label>
      {hand && (
        <div className="mv-sliders">
          {v.features.map((f, i) => {
            const lo = r.ranges.min[i], hi = r.ranges.max[i];
            const whole = r.rows.every(row => Number.isInteger(row[i]));
            const step = whole && hi - lo >= 10 ? 1 : (hi - lo) / 200 || 1;
            return (
              <label key={f} className="mv-sl">
                <span className="mono">{f}</span>
                <input type="range" min={lo} max={hi} step={step} value={r.x[i]} onChange={e => r.set(i, Number(e.target.value))} aria-label={f} />
                <span className="mono r">{fmt(r.x[i])}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Bars({ items }: { items: { label: string; p: number; on?: boolean }[] }) {
  return (
    <ul className="mv-bars">
      {items.map(it => (
        <li key={it.label} data-on={it.on || undefined}>
          <span>{it.label}</span>
          <i style={{ ['--w' as string]: `${Math.max(0, Math.min(1, it.p)) * 100}%` }} />
          <b className="mono">{pct(it.p)}</b>
        </li>
      ))}
    </ul>
  );
}

const classLabel = (classes: string[], c: number | string) => (typeof c === 'number' ? classes[c] ?? String(c) : c);

/* ------------------------------------------------------------------ red neuronal */

function lerpW(a: number[][][], b: number[][][], f: number) { return a.map((m, k) => m.map((r, i) => r.map((w, j) => w + (b[k][i][j] - w) * f))); }
function lerpB(a: number[][], b: number[][], f: number) { return a.map((r, k) => r.map((w, j) => w + (b[k][j] - w) * f)); }

function NetView({ v, stage, onOut, noGl }: { v: MlpViz; stage: Stage | null; onOut: (o: Out) => void; noGl: boolean }) {
  const r = useRow(v);
  const xRef = useRef(r.x);
  xRef.current = r.x;
  const ep = v.epochs && v.epochs.frames.length > 1 ? v.epochs : null;
  const [mode, setMode] = useState<'final' | 'epocas'>('final');
  const [epoch, setEpoch] = useState(ep ? ep.frames.length - 1 : 0);
  const sceneRef = useRef<NetScene | null>(null);
  const [scene, setScene] = useState<NetScene | null>(null);
  const curveMark = useRef<SVGLineElement>(null);
  const W = mode === 'epocas' && ep ? ep.frames[epoch].weights : v.weights;
  const B = mode === 'epocas' && ep ? ep.frames[epoch].biases : v.biases;
  const pass = useMemo(() => (W && B ? forward(v, r.x, W, B) : null), [v, r.x, W, B]);

  useEffect(() => {
    if (!stage) return;
    const s = new NetScene(stage, v);
    sceneRef.current = s;
    setScene(s);
    return () => { stage.clearScene(s.group); sceneRef.current = null; setScene(null); };
  }, [stage, v]);

  const flow = usePlayer(stage, v.layers.length - 1, scene ? t => sceneRef.current?.setProgress(t) : null, 850);
  // entrenamiento: entre dos cuadros, los pesos se interpolan; la marca de la curva va a la par
  const epochAt = (t: number) => {
    if (!ep) return 0;
    const k = Math.min(ep.frames.length - 1, Math.floor(t)), f = t - k;
    const a = ep.frames[k], b = ep.frames[Math.min(ep.frames.length - 1, k + 1)];
    return { k, f, a, b, e: a.epoch + (b.epoch - a.epoch) * f };
  };
  const train = usePlayer(stage, ep ? ep.frames.length - 1 : 0, scene && ep ? t => {
    const s = sceneRef.current, at = epochAt(t);
    if (!s || !at) return;
    const Wi = lerpW(at.a.weights, at.b.weights, at.f), Bi = lerpB(at.a.biases, at.b.biases, at.f);
    s.setWeights(Wi, Bi);
    s.setPass(forward(v, xRef.current, Wi, Bi), xRef.current);
    curveMark.current?.setAttribute('transform', `translate(${(at.e / Math.max(1, ep.loss.length - 1)) * 100} 0)`);
  } : null, 420);

  useEffect(() => { if (mode === 'epocas') setEpoch(train.st.at); }, [train.st.at, mode]);

  // pesos y pasada a la escena; con una fila nueva, el dato vuelve a recorrer la red
  useEffect(() => {
    if (!scene || !W || !B) return;
    scene.setWeights(W, B);
  }, [scene, W, B]);
  useEffect(() => {
    if (!scene || !pass) return;
    scene.setPass(pass, r.x);
  }, [scene, pass, r.x]);
  // fila nueva: el dato vuelve a recorrer la red (con valores a mano o sin animación, salta al final)
  useEffect(() => {
    const p = flow.player.current;
    if (!scene || !p || mode !== 'final') return;
    if (r.row === -1 || reducedMotion()) p.seek(p.end);
    else { p.seek(0); p.play(); }
  }, [scene, r.row, mode, flow.player]);
  useEffect(() => {
    if (mode === 'epocas') { flow.player.current?.seek(v.layers.length - 1); train.player.current?.seek(ep ? ep.frames.length - 1 : 0); }
    else train.player.current?.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    onOut({ kind: 'mlp', row: r.row === -1 ? 'manual' : r.row, out: pass ? { proba: pass.proba, pred: pass.pred } : {}, epoch: mode === 'epocas' && ep ? ep.frames[epoch].epoch : null });
  }, [pass, r.row, mode, epoch, ep, onOut]);

  const real = v.sample?.real?.[r.row];
  const flowWhat = (at: number) => (at <= 0 ? 'el dato está en la entrada' : at >= v.layers.length - 1 ? 'llegó a la salida' : `pasó la capa oculta ${at}`);
  return (
    <>
      {v.weights == null && <p className="callout mv-note">La red tiene {v.layers.join(' → ')} neuronas: pasa del tope de pesos que se mandan, así que se ve la forma sin las conexiones ni la pasada.{v.truncated ? ` (${v.truncated})` : ''}</p>}
      <div className="mv-tools">
        <RowInputs v={v} r={r} realLabel={c => classLabel(v.classes, c)} />
        {ep && <Seg label="Qué pesos se ven" value={mode} onChange={setMode} options={[{ value: 'final', label: 'red final' }, { value: 'epocas', label: 'cómo aprendió' }]} />}
      </div>
      {mode === 'final'
        ? <Transport p={flow} end={v.layers.length - 1} what={flowWhat} onReset={() => stage?.resetView()} />
        : ep && <Transport p={train} end={ep.frames.length - 1} what={at => `época ${ep.frames[Math.min(at, ep.frames.length - 1)].epoch + 1} de ${ep.loss.length}`} onReset={() => stage?.resetView()} />}
      {mode === 'epocas' && ep && <LossCurve ep={ep} markRef={curveMark} at={ep.frames[epoch].epoch} onSeek={i => train.player.current?.seek(i)} />}
      <SidePanel>
        {pass && (
          <>
            <h4>sale</h4>
            <Bars items={v.classes.map((c, i) => ({ label: c, p: pass.proba[i], on: i === pass.pred }))} />
            <p className="mv-verdict">predice <b>{v.classes[pass.pred]}</b>{real != null && <> · real <b>{classLabel(v.classes, real)}</b> {classLabel(v.classes, real) === v.classes[pass.pred] ? <span className="badge" data-k="ok">acierta</span> : <span className="badge" data-k="bad">se equivoca</span>}</>}</p>
          </>
        )}
        <h4>la red</h4>
        <dl className="kv mv-kv">
          <dt>capas</dt><dd className="mono">{v.layers.join(' → ')}</dd>
          <dt>ocultas</dt><dd>{v.hidden}</dd>
          <dt>salida</dt><dd>{v.out === 'softmax' ? 'softmax (una por clase)' : 'logística (una sola: P de la segunda clase)'}</dd>
          {scene && scene.edgeCount.total > 0 && <><dt>conexiones</dt><dd>{scene.edgeCount.total === scene.edgeCount.drawn ? nf(scene.edgeCount.total) : `se dibujan las ${nf(scene.edgeCount.drawn)} más fuertes de ${nf(scene.edgeCount.total)} (tope ${nf(MAX_EDGES)})`}</dd></>}
        </dl>
        {v.epochsNote && <p className="muted mv-small">{v.epochsNote}</p>}
        <Legend items={[['pos', 'peso positivo / se activa'], ['neg', 'peso negativo'], ['node', 'apagada (0)']]} />
      </SidePanel>
      {noGl && pass && (
        <div className="tbl-wrap mv-table"><table className="tbl" aria-label="Pasada de la red, capa por capa">
          <thead><tr><th>capa</th><th>lo que sale de cada neurona</th></tr></thead>
          <tbody>{pass.acts.map((a, k) => <tr key={k}><td>{k === 0 ? 'entrada (escalada)' : k === pass.acts.length - 1 ? 'salida' : `oculta ${k} (${v.hidden})`}</td><td className="mono">{a.map(t => fmt(t)).join('   ')}</td></tr>)}</tbody>
        </table></div>
      )}
    </>
  );
}

function LossCurve({ ep, markRef, at, onSeek }: { ep: NonNullable<MlpViz['epochs']>; markRef: React.RefObject<SVGLineElement | null>; at: number; onSeek: (frame: number) => void }) {
  const n = ep.loss.length;
  const lo = Math.min(...ep.loss), hi = Math.max(...ep.loss);
  const X = (i: number) => (i / Math.max(1, n - 1)) * 100;
  const Y = (y: number) => 34 - ((y - lo) / (hi - lo || 1)) * 30;
  const line = ep.loss.map((y, i) => `${i ? 'L' : 'M'}${X(i).toFixed(2)},${Y(y).toFixed(2)}`).join('');
  const val = ep.val;
  const vlo = val ? Math.min(...val) : 0, vhi = val ? Math.max(...val) : 1;
  const vline = val?.map((y, i) => `${i ? 'L' : 'M'}${X(i).toFixed(2)},${(34 - ((y - vlo) / (vhi - vlo || 1)) * 30).toFixed(2)}`).join('');
  return (
    <div className="mv-curve">
      <div className="mv-curve-h">
        <span><i className="mv-k-loss" />pérdida de entrenamiento</span>
        {val && <span><i className="mv-k-val" />aciertos en validación</span>}
        {ep.best != null && <span className="muted">mejor época: {ep.best + 1} ({ep.chosen})</span>}
        <span className="mono muted">época {at + 1} · pérdida {fmt(ep.loss[at])}</span>
      </div>
      <svg viewBox="0 0 100 36" preserveAspectRatio="none" role="img" aria-label="Curva de pérdida por época"
        onClick={e => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const epoch = ((e.clientX - r.left) / r.width) * (n - 1);
          let best = 0;
          ep.frames.forEach((f, i) => { if (Math.abs(f.epoch - epoch) < Math.abs(ep.frames[best].epoch - epoch)) best = i; });
          onSeek(best);
        }}>
        {ep.frames.map(f => <line key={f.epoch} className="mv-tick" x1={X(f.epoch)} x2={X(f.epoch)} y1={35} y2={36} />)}
        {vline && <path className="mv-val" d={vline} />}
        <path className="mv-loss" d={line} />
        {ep.best != null && <line className="mv-best" x1={X(ep.best)} x2={X(ep.best)} y1={2} y2={36} />}
        <line ref={markRef} className="mv-mark" x1={0} x2={0} y1={0} y2={36} transform={`translate(${X(at)} 0)`} />
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ árbol */

interface ViewProps { stage: Stage | null; onOut: (o: Out) => void; noGl: boolean }

function TreeView({ v, stage, onOut }: ViewProps & { v: TreeViz }) {
  const r = useRow(v);
  const res = useMemo(() => treePath(v, r.x), [v, r.x]);
  const sceneRef = useRef<TreeScene | null>(null);
  const [scene, setScene] = useState<TreeScene | null>(null);
  useEffect(() => {
    if (!stage) return;
    const s = new TreeScene(stage, v);
    sceneRef.current = s;
    setScene(s);
    return () => { stage.clearScene(s.group); sceneRef.current = null; setScene(null); };
  }, [stage, v]);
  const p = usePlayer(stage, res.path.length - 1, scene ? t => sceneRef.current?.setProgress(t) : null, 700);
  useEffect(() => {
    if (!scene) return;
    scene.setPath(res.path);
    const pl = p.player.current;
    if (!pl) return;
    pl.setEnd(res.path.length - 1);
    if (reducedMotion() || r.row === -1) pl.seek(res.path.length - 1);
    else { pl.seek(0); pl.play(); }
  }, [scene, res.path, r.row, p.player]);
  const pred = argmax(res.proba);
  useEffect(() => { onOut({ kind: 'tree', row: r.row === -1 ? 'manual' : r.row, out: { proba: res.proba, pred, leaf: res.leaf } }); }, [res, pred, r.row, onOut]);
  const real = v.sample?.real?.[r.row];
  const xs = v.float32 ? r.x.map(Math.fround) : r.x;
  return (
    <>
      <div className="mv-tools"><RowInputs v={v} r={r} realLabel={c => classLabel(v.classes, c)} /></div>
      <Transport p={p} end={res.path.length - 1} what={at => (at >= res.path.length - 1 ? 'llegó a una hoja' : `pregunta ${at + 1} de ${res.path.length - 1}`)} onReset={() => stage?.resetView()} />
      <SidePanel>
        <h4>el camino</h4>
        <ol className="mv-path">
          {res.path.slice(0, -1).map((n, i) => {
            const node = v.nodes[n], yes = res.path[i + 1] === node.l;
            return <li key={n} data-on={p.st.at >= i || undefined}><span className="mono">{condition(v, n)}</span><b>{yes ? 'sí' : 'no'}</b><span className="muted">la fila tiene {fmt(xs[node.f])}</span></li>;
          })}
        </ol>
        <h4>{v.nodes[res.leaf].cut ? 'se corta acá (árbol más grande que el tope)' : 'la hoja'}</h4>
        <Bars items={v.classes.map((c, i) => ({ label: c, p: res.proba[i], on: i === pred }))} />
        <p className="mv-verdict">predice <b>{v.classes[pred]}</b>{real != null && <> · real <b>{classLabel(v.classes, real)}</b> {classLabel(v.classes, real) === v.classes[pred] ? <span className="badge" data-k="ok">acierta</span> : <span className="badge" data-k="bad">se equivoca</span>}</>}</p>
        <p className="muted mv-small">{v.nodes[res.leaf].n} filas de entrenamiento cayeron en esta hoja; la probabilidad es la proporción de cada clase ahí.{v.float32 ? ' scikit-learn compara en float32.' : ''}</p>
        <Legend items={[['pos', `más «${v.classes.at(-1)}»`], ['neg', `más «${v.classes[0]}»`], ['text', 'la fila y su camino']]} />
      </SidePanel>
    </>
  );
}

/* ------------------------------------------------------------------ KMeans */

function KMeansView({ v, stage, onOut }: ViewProps & { v: KMeansViz }) {
  const r = useRow(v);
  const sceneRef = useRef<KMeansScene | null>(null);
  const [scene, setScene] = useState<KMeansScene | null>(null);
  const end = v.frames.length - 1;
  useEffect(() => {
    if (!stage) return;
    const s = new KMeansScene(stage, v, i => r.pickRef.current(i));
    sceneRef.current = s;
    setScene(s);
    return () => { stage.clearScene(s.group); sceneRef.current = null; setScene(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, v]);
  const p = usePlayer(stage, end, scene ? t => sceneRef.current?.setProgress(t) : null, 1100);
  const z = useMemo(() => kmScale(v, r.x), [v, r.x]);
  useEffect(() => { scene?.select(r.row, z); }, [scene, r.row, z]);
  const started = useRef(false);
  useEffect(() => {
    const pl = p.player.current;
    if (!scene || !pl || started.current) return;
    started.current = true;
    if (reducedMotion()) pl.seek(end);
    else { pl.seek(0); pl.play(); }
  }, [scene, p.player, end]);
  const group = kmGroup(v, r.x);
  useEffect(() => { onOut({ kind: 'kmeans', row: r.row === -1 ? 'manual' : r.row, out: { group } }); }, [group, r.row, onOut]);
  const centers = v.frames[Math.min(end, p.st.at)].centers;
  const dist = centers.map(c => Math.sqrt(c.reduce((s, ci, i) => s + (z[i] - ci) ** 2, 0)));
  const now = nearest(centers, z);
  const counts = useMemo(() => {
    const n = new Array(v.k).fill(0);
    (v.sample?.rows ?? []).forEach(x => { n[nearest(centers, kmScale(v, x))]++; });
    return n;
  }, [v, centers]);
  const tones = ['pos', 'neg', 'muted'];
  return (
    <>
      <div className="mv-tools"><RowInputs v={v} r={r} /></div>
      <Transport p={p} end={end} what={at => `iteración ${v.frames[Math.min(end, at)].it} de ${v.frames[end].it}${at >= end ? ' · los centros del modelo' : ''}`} onReset={() => stage?.resetView()} />
      <SidePanel>
        <h4>esta fila</h4>
        <p className="mv-verdict">va al <b>grupo {group + 1}</b>{v.sample?.real?.[r.row] != null && <> · segmento real <b>{String(v.sample.real[r.row])}</b></>}</p>
        <h4>distancia a cada centro <span className="muted">(iteración {v.frames[Math.min(end, p.st.at)].it})</span></h4>
        <ul className="mv-dist">
          {dist.map((d, g) => (
            <li key={g} data-on={g === now || undefined}><i className="mv-sw" data-t={tones[g % 3]} data-l={Math.floor(g / 3) || undefined} /><span>grupo {g + 1}</span><b className="mono">{fmt(d, 3)}</b><span className="muted">{counts[g]} puntos</span></li>
          ))}
        </ul>
        <p className="muted mv-small">
          Cada iteración: cada punto va al centro más cercano y cada centro se muda al promedio de sus puntos. {v.pca ? 'Hay más de 3 columnas: se dibujan las 3 direcciones principales (PCA); el grupo se calcula con todas.' : ''}
          {v.replaySame ? '' : ' El recorrido rehecho no terminó justo en los centros del modelo: el último cuadro son los del modelo.'}
        </p>
      </SidePanel>
    </>
  );
}

/* ------------------------------------------------------------------ regresiones y tonto */

function surfaceModel(v: LinearViz | LogisticViz | DummyViz, all: { min: number[]; max: number[] }): SurfaceModel {
  const s = v.sample!;
  // los ejes cubren el grueso de las filas de muestra (del 3 % al 97 %): con colas largas, como el ticket,
  // el rango entero aplasta todo contra una punta. Las filas que quedan afuera no se dibujan.
  const q = (i: number, p: number) => { const c = s.rows.map(r => r[i]).sort((a, b) => a - b); return c[Math.round(p * (c.length - 1))]; };
  const ranges = s.rows.length > 4
    ? { min: all.min.map((lo, i) => q(i, 0.03) < q(i, 0.97) ? q(i, 0.03) : lo), max: all.max.map((hi, i) => q(i, 0.03) < q(i, 0.97) ? q(i, 0.97) : hi) }
    : all;
  if (v.kind === 'linear') {
    return { features: v.features, yLabel: v.target, f: x => linearPredict(v, x).value, ...ranges,
      points: s.rows.map((x, i) => ({ x, pred: s.pred![i], real: Number(s.real![i]) })) };
  }
  const yes = v.classes.length - 1;
  const f = v.kind === 'logistic' ? (x: number[]) => logisticProba(v, x).proba[yes] : () => dummyProba(v)?.[yes] ?? v.prior[yes];
  const realNum = (c: number | string) => (typeof c === 'number' ? c : v.classes.indexOf(c));
  return { features: v.features, yLabel: `P(${v.classes[yes]})`, f, ...ranges, yFixed: [0, 1], yFormat: y => pct(y, 0),
    points: s.rows.map((x, i) => ({ x, pred: s.proba![i][yes], real: realNum(s.real![i]) === yes ? 1 : 0 })) };
}

function influence(v: LinearViz | LogisticViz | DummyViz, ranges: { min: number[]; max: number[] }): number[] {
  if (v.kind === 'dummy') return v.features.map((_, i) => -i);
  return v.coef.map((c, i) => Math.abs(c) * (ranges.max[i] - ranges.min[i]) / (v.kind === 'logistic' ? v.scaler.scale[i] || 1 : 1));
}

function SurfaceView({ v, stage, onOut }: ViewProps & { v: LinearViz | LogisticViz | DummyViz }) {
  const r = useRow(v);
  const model = useMemo(() => surfaceModel(v, r.ranges), [v, r.ranges]);
  const order = useMemo(() => influence(v, r.ranges).map((m, i) => [m, i]).sort((a, b) => b[0] - a[0]).map(x => x[1]), [v, r.ranges]);
  const [ax, setAx] = useState<[number, number]>([order[0] ?? 0, order[1] ?? Math.min(1, v.features.length - 1)]);
  const sceneRef = useRef<SurfaceScene | null>(null);
  const [scene, setScene] = useState<SurfaceScene | null>(null);
  useEffect(() => {
    if (!stage || v.features.length < 2) return;
    const s = new SurfaceScene(stage, model, ax[0], ax[1], i => r.pickRef.current(i));
    sceneRef.current = s;
    setScene(s);
    return () => { stage.clearScene(s.group); sceneRef.current = null; setScene(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, model, ax[0], ax[1]]);
  const p = usePlayer(stage, 1, scene ? t => sceneRef.current?.setProgress(t) : null, 1300);
  useEffect(() => { scene?.setBase(r.x); }, [scene, r.x]);
  const started = useRef<SurfaceScene | null>(null);
  useEffect(() => {
    const pl = p.player.current;
    if (!scene || !pl || started.current === scene) return;
    started.current = scene;
    if (reducedMotion()) pl.seek(1);
    else { pl.seek(0); pl.play(); }
  }, [scene, p.player]);

  let out: Out['out'], panel: ReactNode;
  const real = v.sample?.real?.[r.row];
  if (v.kind === 'linear') {
    const { value, parts } = linearPredict(v, r.x);
    out = { value };
    const mx = Math.max(...parts.map(Math.abs), 1e-9);
    panel = (
      <>
        <h4>la cuenta</h4>
        <ul className="mv-parts">
          <li><span>constante</span><i /><b className="mono">{fmt(v.intercept)}</b></li>
          {parts.map((pt, i) => (
            <li key={v.features[i]} data-neg={pt < 0 || undefined}>
              <span className="mono" title={`${fmt(v.coef[i])} × ${fmt(r.x[i])}`}>{v.features[i]}</span>
              <i style={{ ['--w' as string]: `${(Math.abs(pt) / mx) * 100}%` }} />
              <b className="mono">{pt >= 0 ? '+' : '−'}{fmt(Math.abs(pt))}</b>
            </li>
          ))}
        </ul>
        <p className="mv-verdict">predice <b>{fmt(value)}</b>{real != null && <> · real <b>{fmt(Number(real))}</b> · residuo <b>{fmt(Number(real) - value)}</b></>}</p>
      </>
    );
  } else {
    const proba = v.kind === 'logistic' ? logisticProba(v, r.x).proba : dummyProba(v);
    const pred = proba ? argmax(proba) : null;
    out = proba ? { proba, pred } : {};
    panel = (
      <>
        {v.kind === 'logistic' && (() => {
          const { z, parts } = logisticProba(v, r.x);
          const xs = scaleRow(v.scaler, r.x);
          const mx = Math.max(...parts.map(Math.abs), 1e-9);
          return (
            <>
              <h4>la cuenta <span className="muted">(columnas escaladas)</span></h4>
              <ul className="mv-parts">
                <li><span>constante</span><i /><b className="mono">{fmt(v.intercept)}</b></li>
                {parts.map((pt, i) => (
                  <li key={v.features[i]} data-neg={pt < 0 || undefined}>
                    <span className="mono" title={`${fmt(v.coef[i])} × ${fmt(xs[i])}`}>{v.features[i]}</span>
                    <i style={{ ['--w' as string]: `${(Math.abs(pt) / mx) * 100}%` }} />
                    <b className="mono">{pt >= 0 ? '+' : '−'}{fmt(Math.abs(pt))}</b>
                  </li>
                ))}
              </ul>
              <p className="muted mv-small">z = {fmt(z)} → sigmoide(z) = {pct(proba![1], 2)}</p>
            </>
          );
        })()}
        {v.kind === 'dummy' && <p className="muted mv-small">No mira la fila: {v.strategy === 'most_frequent' ? 'siempre dice la clase más común del entrenamiento' : v.strategy === 'prior' ? 'siempre da las proporciones del entrenamiento' : v.strategy === 'uniform' ? 'reparte parejo' : 'sortea según las proporciones, así que no se puede rehacer la cuenta'}. Sirve de piso: un modelo que no le gana no aprendió nada.</p>}
        {proba && pred != null && (
          <>
            <h4>sale</h4>
            <Bars items={v.classes.map((c, i) => ({ label: c, p: proba[i], on: i === pred }))} />
            <p className="mv-verdict">predice <b>{v.classes[pred]}</b>{real != null && <> · real <b>{classLabel(v.classes, real)}</b> {classLabel(v.classes, real) === v.classes[pred] ? <span className="badge" data-k="ok">acierta</span> : <span className="badge" data-k="bad">se equivoca</span>}</>}</p>
          </>
        )}
      </>
    );
  }
  useEffect(() => { onOut({ kind: v.kind, row: r.row === -1 ? 'manual' : r.row, out }); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(out), r.row, v.kind, onOut]);

  const axisPick = (which: 0 | 1) => (
    <label className="mv-ax">
      <span>{which === 0 ? 'eje x' : 'eje z'}</span>
      <select value={ax[which]} onChange={e => { const n = Number(e.target.value); setAx(old => (which === 0 ? [n, old[1] === n ? old[0] : old[1]] : [old[0] === n ? old[1] : old[0], n])); }}>
        {v.features.map((f, i) => <option key={f} value={i}>{f}</option>)}
      </select>
    </label>
  );
  return (
    <>
      <div className="mv-tools"><RowInputs v={v} r={r} realLabel={v.kind === 'linear' ? c => fmt(Number(c)) : c => classLabel(v.classes, c)} />{v.features.length >= 2 && <div className="mv-axes">{axisPick(0)}{axisPick(1)}</div>}</div>
      <Transport p={p} end={1} what={at => (at >= 1 ? 'residuos: de lo que predijo a lo real' : 'lo que predijo para cada fila')} onReset={() => stage?.resetView()} />
      <SidePanel>
        {panel}
        <p className="muted mv-small">La {v.kind === 'linear' ? 'superficie (un plano)' : 'superficie'} es lo que predice el modelo moviendo {v.features[ax[0]]} y {v.features[ax[1]]}; las demás columnas quedan como la fila elegida (punto negro). Cada punto es una fila de prueba parada en lo que predijo, con una línea hasta lo real.</p>
        <Legend items={[['pos', v.kind === 'linear' ? 'real por encima' : `real «${v.classes.at(-1)}»`], ['neg', v.kind === 'linear' ? 'real por debajo' : `real «${v.classes[0]}»`], ['text', 'la fila elegida']]} />
      </SidePanel>
    </>
  );
}

/* ------------------------------------------------------------------ armado */

function SidePanel({ children }: { children: ReactNode }) { return <aside className="mv-side">{children}</aside>; }

function Legend({ items }: { items: [string, string][] }) {
  return <ul className="mv-legend">{items.map(([t, l]) => <li key={l}><i className="mv-sw" data-t={t} />{l}</li>)}</ul>;
}

const TITLE: Record<Viz['kind'], string> = {
  mlp: 'la red neuronal por dentro', tree: 'el árbol por dentro', kmeans: 'los grupos por dentro',
  linear: 'el plano de la regresión', logistic: 'la superficie de la regresión logística', dummy: 'el clasificador tonto',
};
const HOW: Record<Viz['kind'], string> = {
  mlp: 'Elegí una fila y mirá cómo el dato cruza la red: cada pulso es entrada × peso, las neuronas se encienden según lo que les llega y a la derecha sale la probabilidad. Pasá el mouse por una neurona o una conexión para ver la cuenta.',
  tree: 'La fila baja por el árbol respondiendo una pregunta por nodo (sí a la izquierda) hasta una hoja, que decide por mayoría.',
  kmeans: 'Los centros arrancan donde los pone k-means++ y en cada iteración se mudan al promedio de sus puntos; los puntos cambian de grupo cuando otro centro les queda más cerca.',
  linear: 'Lo que predice la regresión es una suma: una constante más cada columna por su coeficiente.',
  logistic: 'La regresión logística suma como la lineal y pasa el resultado por una sigmoide: la superficie es la probabilidad.',
  dummy: 'El tonto no aprende de las columnas: su superficie es plana.',
};

/** Por dentro del modelo. default export: la carga React.lazy desde ModelDetail */
export default function ModelViz({ run }: { run: ModelRun }) {
  const { data: v, error, loading, reload } = useApi(a => a.modelViz(run.id), [run.id]);
  const [problem, setProblem] = useState<string | null>(() => webglProblem());
  const { stage, fail, view } = useStage(!!v && !problem);
  const [out, setOut] = useState<Out | null>(null);
  const reason = problem ?? fail;

  if (loading && !v) return <section className="mv" aria-busy="true"><SkeletonLines n={4} /></section>;
  if (error || !v) {
    return (
      <section className="mv">
        <div className="callout" data-k="bad" role="alert"><span><b>No se pudo traer el dibujo del modelo.</b> <span className="mono">{error}</span></span>
          <button type="button" className="btn btn-sm" onClick={reload}><RotateCcw size={14} />probar de nuevo</button></div>
      </section>
    );
  }
  const props = { stage: reason ? null : stage, onOut: setOut, noGl: !!reason };
  return (
    <section className="mv" data-viz-kind={v.kind} data-viz-row={out?.row ?? ''} data-viz-out={out ? JSON.stringify(out.out) : ''}
      data-viz-epoch={out?.epoch ?? ''} data-viz-mode={reason ? 'tabla' : '3d'} aria-label={TITLE[v.kind]}>
      <header className="mv-h">
        <h3 className="md-t">{TITLE[v.kind]}</h3>
        <span className="muted mv-how">{HOW[v.kind]}</span>
        {v.truncated && <span className="tag" title={v.truncated}>muestra recortada</span>}
      </header>
      <div className="mv-body">
        <div className="mv-stagewrap">
          {reason ? (
            <div className="mv-nogl" role="status">
              <b>No se puede dibujar en 3D.</b>
              <span>{reason}.</span>
              <span className="muted">La cuenta es la misma: abajo y al costado tenés la fila, lo que pasa en cada paso y lo que sale.</span>
              <button type="button" className="btn btn-sm" onClick={() => setProblem(webglProblem())}><RotateCcw size={14} />probar de nuevo</button>
            </div>
          ) : view}
        </div>
        <div className="mv-ctl">
          {v.kind === 'mlp' && <NetView v={v} {...props} />}
          {v.kind === 'tree' && <TreeView v={v} {...props} />}
          {v.kind === 'kmeans' && <KMeansView v={v} {...props} />}
          {(v.kind === 'linear' || v.kind === 'logistic' || v.kind === 'dummy') && <SurfaceView v={v} {...props} />}
        </div>
      </div>
    </section>
  );
}
