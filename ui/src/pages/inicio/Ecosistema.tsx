/* El mapa vivo del ecosistema (Inicio): todas las herramientas de la imagen ordenadas por capa,
   de dónde trabajás (arriba) a dónde quedan los datos (abajo), con lo que corre en una sola
   máquina al costado. Cada lámpara es el estado real de sus procesos; las flechas dicen quién le
   pide qué a quién y se mueven cuando hay un trabajo de ese motor corriendo en YARN.
   Tocar una herramienta abre su ficha: qué hace, qué podés hacer ahí, cómo (la pantalla y el
   comando, que se puede mandar a la terminal integrada) y con qué no confundirla. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, Route, X } from 'lucide-react';
import { useSnapshot } from '../../state/store';
import { useCapabilities } from '../../state/capabilities';
import { navigate, setRouteArg, useRouteArg } from '../../state/ui';
import { Codigo } from '../../components/Comando';
import {
  CAPAS, COMPARAR, DONDE, FILAS, FLECHAS, HERRAMIENTAS, PANTALLA, RECORRIDOS,
  flechasVivas, parecidas, vivo, type CapaId, type Flecha, type Lampara, type ToolId, type Vivo,
} from '../../lib/ecosistema';
import './ecosistema.css';

const LAMPARA: Record<Lampara, string> = { up: 'Andando', starting: 'Arrancando', down: 'Caído', off: 'Apagado', lib: 'Biblioteca, sin proceso' };
/** Numeradas desde abajo: primero se guardan los datos, después se reparte, se procesa y se pide */
const NUMERO: Partial<Record<CapaId, string>> = { datos: '1', recursos: '2', motores: '3', lenguajes: '4' };
const VIVA_COLOR: Record<string, string> = {
  e_streaming_mr: 'var(--eng-mr)', e_pig_mr: 'var(--eng-mr)', e_mr_yarn: 'var(--eng-mr)',
  e_hive_tez: 'var(--eng-tez)', e_hive_meta: 'var(--eng-tez)', e_tez_yarn: 'var(--eng-tez)',
  e_sparksql_spark: 'var(--eng-spark)', e_pyspark_spark: 'var(--eng-spark)', e_spark_yarn: 'var(--eng-spark)',
};
const BASH = /^(hdfs|hadoop|yarn|spark-submit|spark-sql|beeline|sqoop|mysql|python3)\b/;
/** Puertos de clientes (JDBC, thrift, bases): se muestran, pero no se abren en el navegador */
const SIN_WEB = new Set(['10000', '9083', '2181', '3306', '27017']);

const html = (s: string) => ({ __html: s });

/* ---------- Medir dónde quedó cada herramienta para dibujar las flechas ---------- */

type Caja = { x: number; y: number; w: number; h: number };

function useCajas(ref: React.RefObject<HTMLDivElement | null>) {
  const [cajas, setCajas] = useState<Partial<Record<ToolId, Caja>>>({});
  const medir = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const base = el.getBoundingClientRect();
    const out: Partial<Record<ToolId, Caja>> = {};
    el.querySelectorAll<HTMLElement>('[data-tool]').forEach(n => {
      const r = n.getBoundingClientRect();
      out[n.dataset.tool as ToolId] = { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
    });
    setCajas(out);
  }, [ref]);
  useLayoutEffect(() => {
    medir();
    const ro = new ResizeObserver(medir);
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [medir, ref]);
  return cajas;
}

function camino(a: Caja, b: Caja): { d: string; mx: number; my: number } {
  const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
  if (Math.abs(ay - by) < a.h / 2) {
    const der = ax < bx;
    const x1 = der ? a.x + a.w : a.x, x2 = der ? b.x : b.x + b.w, k = (x2 - x1) / 2;
    return { d: `M${x1},${ay} C${x1 + k},${ay} ${x2 - k},${by} ${x2},${by}`, mx: (x1 + x2) / 2, my: (ay + by) / 2 };
  }
  const baja = ay < by;
  const y1 = baja ? a.y + a.h : a.y, y2 = baja ? b.y : b.y + b.h, k = (y2 - y1) * 0.55;
  return { d: `M${ax},${y1} C${ax},${y1 + k} ${bx},${y2 - k} ${bx},${y2}`, mx: (ax + bx) / 2, my: (y1 + y2) / 2 };
}

function Cables({ cajas, foco, vivas, rotular }: { cajas: Partial<Record<ToolId, Caja>>; foco: Set<string> | null; vivas: Set<string>; rotular: boolean }) {
  const lista = FLECHAS.map(f => ({ f, a: cajas[f.from], b: cajas[f.to] })).filter((x): x is { f: Flecha; a: Caja; b: Caja } => !!x.a && !!x.b);
  // Las del foco y las vivas arriba de todo
  lista.sort((x, y) => Number(!!foco?.has(x.f.id) || vivas.has(x.f.id)) - Number(!!foco?.has(y.f.id) || vivas.has(y.f.id)));
  return (
    <svg className="eco-wires" aria-hidden="true">
      <defs>
        {(['base', 'on', 'viva'] as const).map(k => (
          <marker key={k} id={`eco-m-${k}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0.8 L7.2,4 L0,7.2 Z" className={`eco-mk eco-mk-${k}`} />
          </marker>
        ))}
      </defs>
      {lista.map(({ f, a, b }) => {
        const p = camino(a, b);
        const on = !!foco?.has(f.id), viva = vivas.has(f.id), dim = !!foco && !on;
        return (
          <g key={f.id} className="eco-wire" data-k={f.kind} data-on={on || undefined} data-viva={viva || undefined} data-dim={dim || undefined}
            style={viva ? { color: VIVA_COLOR[f.id] ?? 'var(--n-11)' } : undefined}>
            <path d={p.d} markerEnd={`url(#eco-m-${on ? 'on' : viva ? 'viva' : 'base'})`} />
            {rotular && on && <text x={p.mx} y={p.my} textAnchor="middle" dominantBaseline="middle">{f.label}</text>}
          </g>
        );
      })}
    </svg>
  );
}

/* ---------- Cada herramienta en el mapa ---------- */

function Nodo({ id, v, dim, on, onPick, onHover }: { id: ToolId; v: Vivo; dim: boolean; on: boolean; onPick: (id: ToolId) => void; onHover: (id: ToolId | null) => void }) {
  const t = HERRAMIENTAS[id];
  return (
    <button type="button" data-tool={id} className="eco-node" data-capa={t.layer} data-l={v.lampara}
      data-dim={dim || undefined} data-on={on || undefined} data-run={v.corriendo > 0 || undefined}
      onClick={() => onPick(id)} onMouseEnter={() => onHover(id)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(id)} onBlur={() => onHover(null)}
      aria-label={`${t.name}, ${t.sub}. ${LAMPARA[v.lampara]}: ${v.linea}`}>
      <span className="eco-node-h">
        <span className="eco-lamp" data-l={v.lampara} aria-hidden="true" />
        <b>{t.name}</b>
        {v.corriendo > 0 && <span className="eco-run num" title={`${v.corriendo} corriendo en YARN`}>{v.corriendo}</span>}
      </span>
      <span className="eco-node-sub">{t.sub}</span>
      <span className="eco-node-vivo">{v.linea}</span>
    </button>
  );
}

/* ---------- La ficha de una herramienta ---------- */

function Seccion({ t, children }: { t: string; children: ReactNode }) {
  return <section className="eco-f-sec"><h4>{t}</h4>{children}</section>;
}

function Ficha({ id, v, lado, onPick, onClose }: { id: ToolId; v: Vivo; lado: 'der' | 'izq'; onPick: (id: ToolId) => void; onClose: () => void }) {
  const t = HERRAMIENTAS[id];
  const ir = PANTALLA[id];
  const donde = DONDE[id];
  const conPuerto = t.ui.filter(([, u]) => /^localhost:\d+$/.test(u));
  const webs = conPuerto.filter(([, u]) => !SIN_WEB.has(u.split(':')[1]));
  const puertos = conPuerto.filter(([, u]) => SIN_WEB.has(u.split(':')[1]));
  const conexiones = FLECHAS.filter(f => f.from === id || f.to === id);
  const parec = parecidas(id);
  const cerrar = useRef<HTMLButtonElement>(null);
  useEffect(() => { cerrar.current?.focus(); }, [id]);
  return (
    <aside className="eco-ficha" data-capa={t.layer} data-lado={lado} aria-label={`Ficha de ${t.name}`} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <header className="eco-f-h">
        <span className="eco-f-capa">{CAPAS[t.layer].name}</span>
        <button ref={cerrar} type="button" className="btn btn-sm btn-icon btn-ghost" onClick={onClose} aria-label="Cerrar la ficha"><X size={15} /></button>
        <h3>{t.name}<small className="mono">{t.version}</small></h3>
        <div className="eco-f-vivo" data-l={v.lampara}><span className="eco-lamp" data-l={v.lampara} aria-hidden="true" /><b>{LAMPARA[v.lampara]}</b><span>{v.linea}</span></div>
      </header>
      <div className="eco-f-body">
        <p className="eco-f-frase">{t.frase}</p>
        <blockquote className="eco-f-anal">{t.analogia}</blockquote>

        <Seccion t="Qué podés hacer acá">
          <p>{t.cursada}</p>
          <div className="eco-f-acc">
            {ir && <button type="button" className="btn btn-sm btn-primary" onClick={() => navigate(ir.page, ir.arg)}>{ir.label}<ArrowRight size={13} /></button>}
            {puertos.map(([que, u]) => <span key={u + que} className="eco-f-puerto" title="Puerto para clientes, no es una página web">{que} <span className="mono">{u.replace('localhost', '')}</span></span>)}
            {webs.map(([que, u]) => (
              <a key={u + que} className="btn btn-sm" href={`http://${u}`} target="_blank" rel="noreferrer" title={que}>
                <ExternalLink size={12} />{que.replace(/:$/, '')} <span className="mono eco-f-port">{u.replace('localhost', '')}</span>
              </a>
            ))}
          </div>
        </Seccion>

        <Seccion t="Cómo, con un comando">
          <Codigo cmd={t.ejemplo} bash={donde.bash} donde={donde.bash ? 'en la terminal del contenedor' : donde.donde} />
        </Seccion>

        {t.confunde.length > 0 && (
          <Seccion t="No la confundas con">
            <ul className="eco-f-conf">
              {t.confunde.map(c => {
                const o = parec.find(p => c.con.toLowerCase().includes(HERRAMIENTAS[p].name.toLowerCase()));
                return (
                  <li key={c.con}>
                    {o ? <button type="button" className="eco-chip" data-capa={HERRAMIENTAS[o].layer} onClick={() => onPick(o)}>{c.con}</button> : <b>{c.con}</b>}
                    <span>{c.dif}</span>
                  </li>
                );
              })}
            </ul>
          </Seccion>
        )}

        {conexiones.length > 0 && (
          <Seccion t="Con quién habla">
            <ul className="eco-f-con">
              {conexiones.map(f => {
                const otro = f.from === id ? f.to : f.from;
                return (
                  <li key={f.id}>
                    <span className="mono eco-f-dir">{f.from === id ? '→' : '←'}</span>
                    <button type="button" className="eco-chip" data-capa={HERRAMIENTAS[otro].layer} onClick={() => onPick(otro)}>{HERRAMIENTAS[otro].name}</button>
                    <span>{f.from === id ? f.label : `${HERRAMIENTAS[otro].name} ${f.label}`}</span>
                  </li>
                );
              })}
            </ul>
          </Seccion>
        )}
      </div>
    </aside>
  );
}

/* ---------- Recorridos guiados ---------- */

function Recorrido({ id, paso, lado, setPaso, onClose }: { id: string; paso: number; lado: 'der' | 'izq'; setPaso: (n: number) => void; onClose: () => void }) {
  const r = RECORRIDOS[id];
  const s = r.steps[paso];
  const n = r.steps.length;
  return (
    <section className="eco-tour" data-lado={lado} aria-label={`Recorrido: ${r.name}`} aria-live="polite">
      <header>
        <Route size={14} aria-hidden="true" />
        <b>{r.name}</b>
        <span className="num">{paso + 1} / {n}</span>
        <button type="button" className="btn btn-sm btn-icon btn-ghost" onClick={onClose} aria-label="Salir del recorrido"><X size={14} /></button>
      </header>
      <div className="eco-tour-bar" aria-hidden="true">{r.steps.map((_, i) => <i key={i} data-on={i <= paso || undefined} />)}</div>
      <h4>{s.t}</h4>
      <div className="eco-tour-x" dangerouslySetInnerHTML={html(s.x)} />
      {s.code && <Codigo cmd={s.code} bash={BASH.test(s.code.trim())} />}
      {s.tip && <p className="eco-tour-tip" dangerouslySetInnerHTML={html(s.tip)} />}
      <footer>
        <button type="button" className="btn btn-sm" disabled={paso === 0} onClick={() => setPaso(paso - 1)}><ArrowLeft size={13} />Anterior</button>
        {paso < n - 1
          ? <button type="button" className="btn btn-sm btn-primary" onClick={() => setPaso(paso + 1)}>Siguiente<ArrowRight size={13} /></button>
          : <button type="button" className="btn btn-sm btn-primary" onClick={onClose}>Terminar</button>}
      </footer>
    </section>
  );
}

/* ---------- El mapa ---------- */

const PANEL = 420;
/** De qué lado abrir la ficha o el recorrido: del que tape menos de lo que está iluminado */
function ladoLibre(cajas: Partial<Record<ToolId, Caja>>, nodos: Set<ToolId> | undefined, ancho: number): 'der' | 'izq' {
  if (!nodos || !ancho) return 'der';
  let der = 0, izq = 0;
  for (const id of nodos) {
    const c = cajas[id];
    if (!c) continue;
    if (c.x + c.w > ancho - PANEL) der++;
    if (c.x < PANEL) izq++;
  }
  return der <= izq ? 'der' : 'izq';
}

export function Ecosistema() {
  const { status: s, apps } = useSnapshot();
  const caps = useCapabilities();
  const mapa = useRef<HTMLDivElement>(null);
  const cajas = useCajas(mapa);
  const [hover, setHover] = useState<ToolId | null>(null);
  const [elegida, setElegida] = useState<ToolId | null>(null);
  const [tour, setTour] = useState<{ id: string; paso: number } | null>(null);
  const seccion = useRef<HTMLElement>(null);
  // #inicio/recorrido/tres abre ese recorrido (así lo enlaza Comparar)
  const arg = useRouteArg();
  useEffect(() => {
    const m = /^recorrido\/(\w+)$/.exec(arg);
    if (!m || !RECORRIDOS[m[1]]) return;
    setElegida(null);
    setTour({ id: m[1], paso: 0 });
    seccion.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [arg]);
  const salirTour = () => { setTour(null); if (arg) setRouteArg(''); };

  const estados = useMemo(() => {
    const out = {} as Record<ToolId, Vivo>;
    if (s) for (const id of Object.keys(HERRAMIENTAS) as ToolId[]) out[id] = vivo(id, s, caps, apps);
    return out;
  }, [s, caps, apps]);
  const vivas = useMemo(() => flechasVivas(apps), [apps]);

  // Qué se ilumina: el paso del recorrido, o la herramienta elegida (o bajo el mouse) con sus vecinas
  const foco = useMemo(() => {
    if (tour) {
      const p = RECORRIDOS[tour.id].steps[tour.paso];
      return { nodos: new Set<ToolId>(p.nodes), flechas: new Set(p.edges) };
    }
    const id = hover ?? elegida;
    if (!id) return null;
    const fs = FLECHAS.filter(f => f.from === id || f.to === id);
    return { nodos: new Set<ToolId>([id, ...fs.map(f => (f.from === id ? f.to : f.from))]), flechas: new Set(fs.map(f => f.id)) };
  }, [tour, hover, elegida]);

  if (!s) return null;
  const lado = ladoLibre(cajas, foco?.nodos, mapa.current?.offsetWidth ?? 0);
  const corriendo = apps.filter(a => a.state === 'RUNNING' || a.state === 'ACCEPTED').length;
  const pick = (id: ToolId) => { salirTour(); setElegida(e => (e === id ? null : id)); };
  const nodo = (id: ToolId) => (
    <Nodo key={id} id={id} v={estados[id]} on={!!foco?.nodos.has(id) && (!!tour || id === (hover ?? elegida))} dim={!!foco && !foco.nodos.has(id)} onPick={pick} onHover={setHover} />
  );

  return (
    <section className="eco" ref={seccion} aria-label="El ecosistema de la imagen">
      <div className="eco-head">
        <div className="eco-head-t">
          <h2>El ecosistema</h2>
          <p>Cada pieza con su estado real. Tocá una para ver qué hace, qué podés hacer ahí y cómo.
            {corriendo > 0 && <> Ahora hay <b>{corriendo} {corriendo === 1 ? 'trabajo' : 'trabajos'}</b> corriendo: mirá cómo se mueven las flechas.</>}</p>
        </div>
        <div className="eco-tours" role="group" aria-label="Recorridos guiados">
          <span><Route size={13} aria-hidden="true" />Recorridos</span>
          {Object.entries(RECORRIDOS).map(([id, r]) => (
            <button key={id} type="button" className="btn btn-sm" aria-pressed={tour?.id === id}
              onClick={() => { setElegida(null); setTour(t => (t?.id === id ? null : { id, paso: 0 })); }}>{r.name}</button>
          ))}
        </div>
      </div>

      <div className="eco-stage">
        <div className="eco-map" ref={mapa}>
          <div className="eco-frame eco-frame-cl" aria-hidden="true"><span>Cluster Hadoop · un contenedor, muchos procesos</span></div>
          <div className="eco-frame eco-frame-uno" aria-hidden="true"><span>Una sola máquina · fuera del cluster</span></div>
          <Cables cajas={cajas} foco={foco?.flechas ?? null} vivas={vivas} rotular={!!foco} />
          {FILAS.map((f, i) => (
            <div key={f.capa} className="eco-row">
              <div className="eco-row-l" data-capa={f.capa} style={{ gridRow: i + 1 }}>
                {NUMERO[f.capa] && <span className="eco-row-n num">{NUMERO[f.capa]}</span>}
                <b>{f.titulo}</b><small>{f.sub}</small>
              </div>
              <div className="eco-row-cl" style={{ gridRow: i + 1 }}>{f.cluster.map(nodo)}</div>
              <div className="eco-row-pu" style={{ gridRow: i + 1 }}>{f.costado.filter(id => HERRAMIENTAS[id].layer === 'puente').map(nodo)}</div>
              <div className="eco-row-uno" style={{ gridRow: i + 1 }}>{f.costado.filter(id => HERRAMIENTAS[id].layer !== 'puente').map(nodo)}</div>
            </div>
          ))}
        </div>
        {elegida && !tour && <Ficha id={elegida} v={estados[elegida]} lado={lado} onPick={pick} onClose={() => setElegida(null)} />}
        {tour && <Recorrido id={tour.id} paso={tour.paso} lado={lado} setPaso={p => setTour({ ...tour, paso: p })} onClose={salirTour} />}
      </div>

      <ul className="eco-legend" aria-label="Referencias">
        {(['up', 'starting', 'down', 'off', 'lib'] as Lampara[]).map(l => <li key={l}><span className="eco-lamp" data-l={l} aria-hidden="true" />{LAMPARA[l]}</li>)}
        <li><i className="eco-lg-wire" data-k="run" aria-hidden="true" />le pide trabajo</li>
        <li><i className="eco-lg-wire" data-k="read" aria-hidden="true" />consulta o lee</li>
        <li><i className="eco-lg-wire" data-k="puerta" aria-hidden="true" />se usa desde</li>
        <li><i className="eco-lg-wire" data-k="viva" aria-hidden="true" />trabajo corriendo</li>
      </ul>
    </section>
  );
}

/* ---------- ¿Cuál uso? Las preguntas; las respuestas, en Comparar ---------- */

export function CualUso() {
  return (
    <ul className="eco-preg" aria-label="Comparar herramientas">
      <li data-destacada>
        <button type="button" onClick={() => navigate('comparar')}>
          <b>La misma cuenta, cuatro maneras</b><small>MapReduce a mano, Pig, Hive y PySpark, con su código y su tiempo</small><ArrowRight size={16} />
        </button>
      </li>
      {COMPARAR.map(c => (
        <li key={c.id}>
          <button type="button" onClick={() => navigate('comparar', c.id)}><b>{c.pregunta}</b><small>{c.cuales}</small><ArrowRight size={16} /></button>
        </li>
      ))}
    </ul>
  );
}