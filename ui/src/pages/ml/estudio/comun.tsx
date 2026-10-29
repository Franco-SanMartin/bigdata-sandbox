/* Lo que comparten los pasos del estudio: catálogo, perfil y revisión de la receta (con espera), campos
   de formulario con su ayuda y el seguimiento de una corrida en vivo. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Info, ShieldAlert, XCircle } from 'lucide-react';
import { api } from '../../../api';
import type { MlCatalogo, MlCorrida, MlDatos, MlIssue, MlLinea, MlPerfil, MlReceta, MlRevision } from '../../../api/types';
import { HelpTip } from '../../../components/base';
import { onEvent } from '../../../state/store';
import { useApi } from '../../../state/useApi';

/* ---------- catálogo (no cambia: se pide una vez) ---------- */

let catalogo: Promise<MlCatalogo> | null = null;
export function useCatalogo() {
  return useApi(a => (catalogo ??= a.mlCatalog().catch(e => { catalogo = null; throw e; })), []);
}

/* ---------- perfil de los datos (caché por datos + objetivo) ---------- */

const perfiles = new Map<string, Promise<MlPerfil>>();
export function pedirPerfil(datos: MlDatos, objetivo: string | null): Promise<MlPerfil> {
  const k = JSON.stringify([datos.origen, datos.ruta ?? datos.tabla, datos.formato ?? null, datos.separador ?? ',', objetivo]);
  let p = perfiles.get(k);
  if (!p) {
    p = api().mlProfile(datos, objetivo).catch(e => { perfiles.delete(k); throw e; });
    perfiles.set(k, p);
  }
  return p;
}
export const olvidarPerfiles = () => perfiles.clear();

export function usePerfil(datos: MlDatos | null, objetivo: string | null) {
  const k = datos ? JSON.stringify([datos, objetivo]) : '';
  return useApi(() => (datos ? pedirPerfil(datos, objetivo) : Promise.resolve(null)), [k]);
}

/* ---------- revisión de la receta: el servidor la completa y avisa (con 350 ms de espera) ---------- */

export function useRevision(receta: MlReceta): { rev: MlRevision | null; cargando: boolean; error: string | null } {
  const [rev, setRev] = useState<MlRevision | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const k = JSON.stringify(receta);
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    setCargando(true);
    const t = setTimeout(() => {
      api().mlCheck(receta).then(
        r => { if (n === seq.current) { setRev(r); setError(null); setCargando(false); } },
        e => { if (n === seq.current) { setError(e instanceof Error ? e.message : String(e)); setCargando(false); } },
      );
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k]);
  return { rev, cargando, error };
}

/* ---------- formulario ---------- */

export function Campo({ label, nombre, ayuda, children, nota, error, ancho }: {
  label: ReactNode; nombre?: string; ayuda?: ReactNode; children: ReactNode; nota?: ReactNode; error?: string | null; ancho?: 'full';
}) {
  return (
    <div className="es-campo" data-ancho={ancho} data-error={error ? true : undefined}>
      <span className="es-cl">{label}{nombre && <span className="mono">{nombre}</span>}{ayuda && <HelpTip label={`Qué es ${typeof label === 'string' ? label : nombre ?? ''}`}>{ayuda}</HelpTip>}</span>
      {children}
      {error ? <span className="es-cerr" role="alert">{error}</span> : nota && <span className="es-cnota">{nota}</span>}
    </div>
  );
}

export function Opciones<T extends string>({ value, onChange, opciones, label }: {
  value: T; onChange: (v: T) => void; opciones: { valor: string; etiqueta: string; ayuda?: string; deshabilitada?: string }[]; label: string;
}) {
  return (
    <div className="es-ops" role="radiogroup" aria-label={label}>
      {opciones.map(o => (
        <button key={o.valor} type="button" role="radio" aria-checked={o.valor === value} disabled={!!o.deshabilitada}
          title={o.deshabilitada || o.ayuda} onClick={() => onChange(o.valor as T)}>
          <b>{o.etiqueta}</b>{o.ayuda && <span>{o.ayuda}</span>}
        </button>
      ))}
    </div>
  );
}

export function Numero({ value, onChange, min, max, paso, label, nulo, ancho = 110 }: {
  value: number | null; onChange: (v: number | null) => void; min?: number; max?: number; paso?: number | 'any'; label: string;
  nulo?: string; ancho?: number;
}) {
  const [txt, setTxt] = useState(value == null ? '' : String(value));
  useEffect(() => { setTxt(value == null ? '' : String(value)); }, [value]);
  const fuera = txt.trim() !== '' && (Number.isNaN(Number(txt.replace(',', '.'))) || (min != null && Number(txt.replace(',', '.')) < min) || (max != null && Number(txt.replace(',', '.')) > max));
  return (
    <input className="input mono es-num" style={{ width: ancho }} value={txt} inputMode="decimal" aria-label={label}
      placeholder={nulo} aria-invalid={fuera || undefined} step={paso}
      onChange={e => {
        const s = e.target.value; setTxt(s);
        if (s.trim() === '') { if (nulo) onChange(null); return; }
        const n = Number(s.replace(',', '.'));
        if (!Number.isNaN(n)) onChange(n);
      }} />
  );
}

/* ---------- avisos de la revisión ---------- */

const ICONO: Record<string, ReactNode> = {
  error: <XCircle size={14} aria-hidden="true" />, fuga: <ShieldAlert size={14} aria-hidden="true" />,
  id: <AlertTriangle size={14} aria-hidden="true" />, desbalance: <AlertTriangle size={14} aria-hidden="true" />,
  aviso: <AlertTriangle size={14} aria-hidden="true" />, info: <Info size={14} aria-hidden="true" />,
};
const TIPO_LABEL: Record<string, string> = { error: 'error', fuga: 'posible fuga', id: 'columna id', desbalance: 'desbalance', aviso: 'aviso', info: 'nota' };

export function Avisos({ rev, prefijos, vacio }: { rev: MlRevision | null; prefijos?: string[]; vacio?: ReactNode }) {
  if (!rev) return null;
  const toca = (i: MlIssue) => !prefijos || prefijos.some(p => i.campo === p || i.campo.startsWith(p + '.'));
  const lista = [...rev.errores.filter(toca).map(e => ({ ...e, tipo: 'error' as const })), ...rev.avisos.filter(toca)];
  if (!lista.length) return vacio ? <>{vacio}</> : null;
  return (
    <ul className="es-avisos" aria-label="Avisos de la receta">
      {lista.map((i, n) => (
        <li key={n} data-k={i.tipo === 'error' ? 'bad' : i.tipo === 'info' ? undefined : 'run'}>
          {ICONO[i.tipo ?? 'aviso']}<span><b>{TIPO_LABEL[i.tipo ?? 'aviso']}</b> <span className="mono muted">{i.campo}</span> {i.mensaje}</span>
        </li>
      ))}
    </ul>
  );
}

/* ---------- una corrida en vivo: estado por SSE (mlrun) y las líneas de salida pidiendo de a tramos ---------- */

export function useCorrida(id: string | null): { corrida: MlCorrida | null; lineas: MlLinea[] } {
  const [corrida, setCorrida] = useState<MlCorrida | null>(null);
  const [lineas, setLineas] = useState<MlLinea[]>([]);
  useEffect(() => {
    setCorrida(null); setLineas([]);
    if (!id) return;
    let desde = 0, vivo = true, t: ReturnType<typeof setTimeout> | undefined;
    const traer = async () => {
      try {
        const c = await api().mlRun(id, desde);
        if (!vivo) return;
        const nuevas = c.lineas ?? [];
        if (nuevas.length) setLineas(l => [...l, ...nuevas].slice(-3000));
        desde = c.total ?? desde;
        setCorrida(c);
        if (c.estado === 'corriendo') t = setTimeout(traer, 700);
      } catch { if (vivo) t = setTimeout(traer, 2000); }
    };
    traer();
    const off = onEvent(e => { if (e.type === 'mlrun' && e.run.id === id) setCorrida(c => ({ ...c, ...e.run, lineas: undefined })); });
    return () => { vivo = false; clearTimeout(t); off(); };
  }, [id]);
  return { corrida, lineas };
}

export function Consola({ lineas, alto = 260, vacio }: { lineas: MlLinea[]; alto?: number; vacio?: string }) {
  const ref = useRef<HTMLPreElement>(null);
  const pegado = useRef(true);
  useEffect(() => { const el = ref.current; if (el && pegado.current) el.scrollTop = el.scrollHeight; }, [lineas]);
  return (
    <pre className="es-log" ref={ref} style={{ maxHeight: alto }} tabIndex={0} aria-label="Salida de la corrida" aria-live="off"
      onScroll={e => { const el = e.currentTarget; pegado.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}>
      {lineas.length ? lineas.map(l => (
        <div key={l.n} data-s={l.stream} data-k={/^\[\s*\d+%\]/.test(l.texto) ? 'paso' : /^\[CV/.test(l.texto) ? 'cv' : undefined}>{l.texto || ' '}</div>
      )) : <span className="muted">{vacio ?? 'Todavía no salió nada'}</span>}
    </pre>
  );
}

/** Baja un texto como archivo (código editado que todavía no es un experimento) */
export function bajarTexto(nombre: string, texto: string, tipo = 'text/x-python') {
  const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
  const a = document.createElement('a');
  a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** El script partido en celdas # %% como notebook (lo mismo que sandbox_ml.codigo.a_notebook) */
export function aNotebook(codigo: string): string {
  const celdas: object[] = [];
  let tipo: 'code' | 'markdown' = 'code', lineas: string[] = [];
  const fuente = (txt: string) => { const ls = txt.split('\n'); return [...ls.slice(0, -1).map(l => l + '\n'), ls[ls.length - 1]]; };
  const cerrar = () => {
    const txt = lineas.join('\n').replace(/^\n+|\n+$/g, '');
    if (!txt) return;
    if (tipo === 'markdown') celdas.push({ cell_type: 'markdown', metadata: {}, source: fuente(txt.split('\n').map(l => (l.startsWith('# ') ? l.slice(2) : l.replace(/^#+/, ''))).join('\n')) });
    else celdas.push({ cell_type: 'code', metadata: {}, execution_count: null, outputs: [], source: fuente(txt) });
  };
  for (const l of codigo.split('\n')) {
    if (l.startsWith('# %%')) {
      cerrar(); lineas = [];
      tipo = l.includes('[markdown]') ? 'markdown' : 'code';
      const resto = l.slice(4).replace('[markdown]', '').trim();
      if (resto && tipo === 'code') lineas.push(`# ${resto}`);
      continue;
    }
    lineas.push(l);
  }
  cerrar();
  return JSON.stringify({ cells: celdas, metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' }, language_info: { name: 'python' } }, nbformat: 4, nbformat_minor: 5 }, null, 1);
}
