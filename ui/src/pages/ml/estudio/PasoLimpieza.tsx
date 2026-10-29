/* Paso 2, Limpieza: la receta de limpieza columna por columna (sandbox_ml/limpieza.py), versionada. Los pasos
   caen en dos fases: lo que es solo del entrenamiento (duplicados, filtros, filas que se sacan: antes de partir,
   los datos nuevos no pasan por acá) y lo que va adentro del modelo (tipos, texto, regex, fechas, nulos, extremos,
   categorías raras, mapeos y columnas derivadas: el paso Limpiar del Pipeline, que se aplica igual al predecir).
   La vista previa corre los pasos en Spark local sobre una muestra: filas afectadas, lo aprendido y antes/después. */
import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, FileCode2, History, Play, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../../../api';
import { ApiFailure, detalleDe } from '../../../api/errors';
import type {
  MlCatalogo, MlFase, MlLimpieza, MlLimpiezaFila, MlPaso, MlPasoTipo, MlPasoVista, MlPerfil, MlReceta, MlRevision, MlRol, MlValor, MlVistaLimpieza,
} from '../../../api/types';
import { EmptyState, Panel, ResultTable, SkeletonLines, Stat, StatRow } from '../../../components/base';
import { Switch } from '../../../components/ui';
import { toast } from '../../../state/ui';
import { useApi } from '../../../state/useApi';
import { Avisos, Campo, Numero, usePerfil } from './comun';
import { creadasPor, creadasPorLimpieza, editar, faseDe, irA, ROL_LABEL, setEstudio, useEstudio } from './estado';
import { fnum } from './graficos';

const DEL_MODELO: MlPasoTipo[] = ['tipo', 'texto', 'regex', 'fecha', 'nulos', 'outliers', 'raras', 'mapeo', 'derivada'];
const DE_ENTRENAMIENTO: MlPasoTipo[] = ['duplicados', 'filtro'];
const ROLES: MlRol[] = ['numerica', 'categorica', 'fecha', 'texto', 'id', 'ignorar'];

function nuevoPaso(tipo: MlPasoTipo, columna: string): MlPaso {
  switch (tipo) {
    case 'tipo': return { tipo, columna, a: 'double' };
    case 'texto': return { tipo, columna, ops: ['recortar', 'minusculas'] };
    case 'regex': return { tipo, columna, patron: '', reemplazo: '', modo: 'reemplazar' };
    case 'fecha': return { tipo, columna, formato: 'dd/MM/yyyy', con_hora: false, partes: [] };
    case 'nulos': return { tipo, columna, estrategia: 'mediana', indicador: true };
    case 'outliers': return { tipo, columna, metodo: 'iqr', factor: 1.5, accion: 'recortar' };
    case 'raras': return { tipo, columna, min_pct: 0.01, max_categorias: 50, otra: '(otra)' };
    case 'mapeo': return { tipo, columna, mapa: {}, resto: 'conservar' };
    case 'derivada': return { tipo, nombre: 'nueva', expresion: '', rol: 'numerica' };
    case 'duplicados': return { tipo, columnas: [] };
    default: return { tipo, condicion: '' };
  }
}

/** Cambia la receta de limpieza y los roles de las columnas que crea (las nuevas entran con su rol sugerido;
 *  las que ya no crea nadie, y no están en los datos, se van). La versión guardada deja de valer. */
function editarLimpieza(f: (l: MlLimpieza) => MlLimpieza, perfil: MlPerfil | null) {
  editar(r => {
    const antes = r.limpieza ?? { pasos: [] };
    const despues = f(antes);
    const viejas = creadasPorLimpieza(antes), nuevas = creadasPorLimpieza(despues);
    const columnas = { ...r.columnas };
    for (const c of Object.keys(viejas)) if (!(c in nuevas) && !perfil?.columnas.some(x => x.nombre === c)) delete columnas[c];
    for (const [c, rol] of Object.entries(nuevas)) if (!(c in columnas)) columnas[c] = rol;
    const cambio = JSON.stringify(antes.pasos) !== JSON.stringify(despues.pasos);
    return { ...r, columnas, limpieza: { ...despues, version: cambio ? null : despues.version } };
  });
}

/* La última vista previa se guarda acá: al volver al paso sigue a la vista */
let ultima: { firma: string; vista: MlVistaLimpieza } | null = null;
const firmaDe = (r: MlReceta, filas: number) => JSON.stringify([r.datos, r.objetivo, r.limpieza?.pasos ?? [], filas]);

export function PasoLimpieza({ cat, rev }: { cat: MlCatalogo; rev: MlRevision | null }) {
  const { receta } = useEstudio();
  const perfil = usePerfil(receta.datos, null);
  const lim: MlLimpieza = receta.limpieza ?? { pasos: [] };
  const [filas, setFilas] = useState(5000);
  const [vista, setVista] = useState<MlVistaLimpieza | null>(ultima?.vista ?? null);
  const [firmaVista, setFirmaVista] = useState<string | null>(ultima?.firma ?? null);
  const [error, setError] = useState<ApiFailure | Error | null>(null);
  const [corriendo, setCorriendo] = useState(false);
  const [abierto, setAbierto] = useState<number | null>(null);
  const p = perfil.data ?? null;
  const spark = cat.modelos.find(m => m.id === receta.modelo.id)?.motor === 'spark';
  const firma = firmaDe(receta, filas);
  const vieja = vista != null && firmaVista !== firma;
  const porPaso = useMemo(() => new Map((vista?.pasos ?? []).map(v => [v.paso, v])), [vista]);

  /** Las columnas que ve el paso i: las de los datos y las que crearon los pasos anteriores */
  const columnasHasta = (i: number) => {
    const base = p?.columnas.map(c => c.nombre) ?? Object.keys(receta.columnas);
    const creadas = lim.pasos.slice(0, i).flatMap(x => Object.keys(creadasPor(x)));
    return [...base, ...creadas.filter(c => !base.includes(c))];
  };
  const set = (f: (l: MlLimpieza) => MlLimpieza) => editarLimpieza(f, p);
  const cambiar = (i: number, cambio: Partial<MlPaso>) => set(l => ({ ...l, pasos: l.pasos.map((x, j) => (j === i ? { ...x, ...cambio } : x)) }));
  const agregar = (tipo: MlPasoTipo) => {
    const cols = columnasHasta(lim.pasos.length).filter(c => c !== receta.objetivo);
    set(l => ({ ...l, pasos: [...l.pasos, nuevoPaso(tipo, cols[0] ?? '')] }));
    setAbierto(lim.pasos.length);
  };
  const mover = (i: number, d: -1 | 1) => set(l => {
    const ps = [...l.pasos]; const j = i + d;
    if (j < 0 || j >= ps.length) return l;
    [ps[i], ps[j]] = [ps[j], ps[i]];
    return { ...l, pasos: ps };
  });
  const quitar = (i: number) => set(l => ({ ...l, pasos: l.pasos.filter((_, j) => j !== i) }));

  async function probar() {
    setCorriendo(true); setError(null);
    const f = firmaDe(receta, filas);
    try {
      const v = await api().mlCleaningPreview(receta.datos, lim, receta.objetivo, filas);
      setVista(v); setFirmaVista(f); ultima = { firma: f, vista: v };
      const malos = v.pasos.filter(x => !x.ok).length;
      toast({ kind: malos ? 'run' : 'ok', title: malos ? `${malos} paso${malos > 1 ? 's' : ''} con error` : 'Vista previa lista', description: `${fnum(v.filas.leidas)} filas de muestra en ${v.segundos.toString().replace('.', ',')} s` });
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally { setCorriendo(false); }
  }

  const errDe = (i: number) => (rev?.errores ?? []).filter(e => e.campo === `limpieza.pasos.${i}` || e.campo.startsWith(`limpieza.pasos.${i}.`));
  const grupos: { fase: MlFase; titulo: string; nota: string }[] = [
    { fase: 'entrenamiento', titulo: 'Solo para entrenar', nota: 'Antes de partir en entrenamiento y prueba. Los datos nuevos (al predecir) no pasan por acá.' },
    { fase: 'modelo', titulo: 'Adentro del modelo', nota: 'El paso Limpiar del Pipeline: se guarda con el modelo y se aplica igual a los datos nuevos. Lo que aprende sale solo del entrenamiento.' },
  ];

  return (
    <div className="es-paso es-limpieza">
      <Versiones lim={lim} nombreSugerido={(receta.datos.ruta ?? receta.datos.tabla ?? 'datos').split('/').filter(Boolean).pop()!.split('.')[0]} perfil={p} />
      {!spark && lim.pasos.length > 0 && (
        <p className="es-sugerencia" role="status">La limpieza columna por columna corre en Spark: para entrenar con ella elegí un modelo de Spark MLlib (en «Modelo e hiperparámetros»).</p>
      )}
      <Avisos rev={rev} prefijos={['limpieza']} />
      <div className="es-limp-grid">
        <div className="es-col">
          <Panel title="Pasos" sub={`${lim.pasos.length} paso${lim.pasos.length === 1 ? '' : 's'} · se aplican en orden, dentro de cada fase`}>
            <div className="es-agregar" role="group" aria-label="Agregar un paso">
              <span className="muted">Adentro del modelo</span>
              {DEL_MODELO.map(t => <button key={t} type="button" className="btn btn-sm" title={cat.limpieza.pasos[t].ayuda} onClick={() => agregar(t)}><Plus size={12} aria-hidden="true" />{cat.limpieza.pasos[t].etiqueta}</button>)}
              <span className="muted">Solo para entrenar</span>
              {DE_ENTRENAMIENTO.map(t => <button key={t} type="button" className="btn btn-sm" title={cat.limpieza.pasos[t].ayuda} onClick={() => agregar(t)}><Plus size={12} aria-hidden="true" />{cat.limpieza.pasos[t].etiqueta}</button>)}
            </div>
            {!lim.pasos.length && <EmptyState compact title="Sin pasos todavía">Agregá el primero con los botones de arriba. Sin limpieza, los datos entran al preprocesamiento como vienen.</EmptyState>}
            {grupos.map(g => {
              const idx = lim.pasos.map((x, i) => [x, i] as const).filter(([x]) => faseDe(x, receta.objetivo) === g.fase);
              if (!idx.length) return null;
              return (
                <section key={g.fase} className="es-fase" data-fase={g.fase} aria-label={g.titulo}>
                  <h3>{g.titulo} <span className="muted">{g.nota}</span></h3>
                  <ol>
                    {idx.map(([x, i]) => (
                      <PasoFila key={i} cat={cat} paso={x} i={i} total={lim.pasos.length} columnas={columnasHasta(i)} perfil={p} objetivo={receta.objetivo}
                        vista={vieja ? undefined : porPaso.get(i)} errores={errDe(i).map(e => e.mensaje)} abierto={abierto === i}
                        onAbrir={() => setAbierto(a => (a === i ? null : i))} onCambiar={c => cambiar(i, c)} onMover={d => mover(i, d)} onQuitar={() => quitar(i)} />
                    ))}
                  </ol>
                </section>
              );
            })}
          </Panel>
        </div>
        <div className="es-col">
          <Panel title="Vista previa" sub="Spark local sobre una muestra de los datos" flush
            end={<>
              <Numero value={filas} onChange={v => v != null && setFilas(Math.round(v))} min={100} max={50000} label="Filas de la muestra" ancho={90} />
              <button type="button" className="btn btn-sm btn-primary" disabled={corriendo || !lim.pasos.length} onClick={probar}><Play size={12} aria-hidden="true" />{corriendo ? 'Corriendo…' : 'Probar'}</button>
            </>}>
            {error ? (
              <div className="es-pad">
                <EmptyState compact kind="error" title="No se pudo correr la vista previa">{error.message}</EmptyState>
                {detalleDe(error) && <details className="es-detalle"><summary>Lo que dijo Spark</summary><pre className="mono">{detalleDe(error)}</pre></details>}
              </div>
            ) : corriendo && !vista ? <div className="es-pad"><p className="muted es-nota">python3 -m sandbox_ml.limpieza: arranca Spark, lee {fnum(filas)} filas y corre los pasos uno por uno…</p><SkeletonLines n={6} /></div>
              : !vista ? <div className="es-pad"><EmptyState compact title="Probá la receta">Corre los pasos sobre una muestra: cuántas filas toca cada uno, qué aprendió y cómo quedan antes y después. Lo aprendido acá sale de la muestra; al entrenar, del entrenamiento.</EmptyState></div>
              : <Vista vista={vista} vieja={vieja} abierto={abierto} onAbrir={setAbierto} />}
          </Panel>
          <Panel title="El código" sub="Cada paso genera su PySpark: se puede correr solo con spark-submit">
            <p className="es-nota">El script de la limpieza lee los datos, aplica los pasos, imprime cuántas filas toca cada uno y guarda los datos limpios en HDFS (Parquet) junto con el paso <span className="mono">Limpiar</span> como <span className="mono">PipelineModel</span>.</p>
            <div className="es-acciones">
              <button type="button" className="btn btn-sm" disabled={!lim.pasos.length} onClick={() => { setEstudio(e => ({ ...e, parteCodigo: 'limpieza' })); irA('codigo'); }}><FileCode2 size={13} aria-hidden="true" />Ver el PySpark de la limpieza</button>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function PasoFila({ cat, paso, i, total, columnas, perfil, objetivo, vista, errores, abierto, onAbrir, onCambiar, onMover, onQuitar }: {
  cat: MlCatalogo; paso: MlPaso; i: number; total: number; columnas: string[]; perfil: MlPerfil | null; objetivo: string | null;
  vista?: MlPasoVista; errores: string[]; abierto: boolean; onAbrir: () => void; onCambiar: (c: Partial<MlPaso>) => void;
  onMover: (d: -1 | 1) => void; onQuitar: () => void;
}) {
  const def = cat.limpieza.pasos[paso.tipo];
  const apagado = paso.activo === false;
  return (
    <li className="es-paso-limp" data-estado={errores.length || (vista && !vista.ok) ? 'error' : apagado ? 'apagado' : undefined}>
      <div className="es-pl-cab">
        <button type="button" className="es-pl-tit" onClick={onAbrir} aria-expanded={abierto}>
          <span className="es-rn">{i + 1}</span>
          <b>{def.etiqueta}</b>
          <span className="mono es-resu">{resumen(paso)}</span>
        </button>
        {vista?.ok && <span className="badge" data-k={vista.afectadas ? 'run' : undefined} title={vista.quita ? 'filas que se sacan' : 'filas que cambian'}>
          {vista.quita ? `−${fnum(vista.afectadas ?? 0)} filas` : `${fnum(vista.afectadas ?? 0)} filas`}</span>}
        {vista && !vista.ok && <span className="badge" data-k="bad">falló</span>}
        <span className="es-pl-btns">
          <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={() => onCambiar({ activo: apagado ? undefined : false })} aria-label={apagado ? 'Prender el paso' : 'Apagar el paso (sin borrarlo)'}>{apagado ? <EyeOff size={13} /> : <Eye size={13} />}</button>
          <button type="button" className="btn btn-sm btn-ghost btn-icon" disabled={i === 0} onClick={() => onMover(-1)} aria-label="Subir el paso"><ArrowUp size={13} /></button>
          <button type="button" className="btn btn-sm btn-ghost btn-icon" disabled={i === total - 1} onClick={() => onMover(1)} aria-label="Bajar el paso"><ArrowDown size={13} /></button>
          <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={onQuitar} aria-label="Borrar el paso"><Trash2 size={13} /></button>
        </span>
      </div>
      {errores.map((e, n) => <p key={n} className="es-cerr">{e}</p>)}
      {vista && !vista.ok && vista.error && <p className="es-cerr">Spark: {vista.error.mensaje}</p>}
      {abierto && (
        <div className="es-pl-cuerpo">
          <p className="es-nota">{def.ayuda}</p>
          <div className="es-form-fila">
            <Formulario cat={cat} paso={paso} columnas={columnas} perfil={perfil} objetivo={objetivo} onCambiar={onCambiar} />
          </div>
        </div>
      )}
    </li>
  );
}

function resumen(p: MlPaso): string {
  switch (p.tipo) {
    case 'tipo': return `${p.columna} → ${p.a}${p.formato ? ` (${p.formato})` : ''}`;
    case 'texto': return `${p.columna}: ${(p.ops ?? []).join(', ')}`;
    case 'regex': return `${p.columna}: ${p.modo === 'extraer' ? 'extraer' : 'reemplazar'} /${p.patron ?? ''}/${p.destino ? ` → ${p.destino}` : ''}`;
    case 'fecha': return `${p.columna} (${p.formato || 'yyyy-MM-dd'})${p.partes?.length ? ` → ${p.partes.join(', ')}` : ''}`;
    case 'nulos': return `${p.columna}: ${p.estrategia}${p.indicador ? `, con ${p.columna}_nulo` : ''}`;
    case 'outliers': return `${p.columna}: ${p.metodo} ${p.factor}, ${p.accion}`;
    case 'raras': return `${p.columna}: menos de ${((p.min_pct ?? 0) * 100).toLocaleString('es-AR')} % → ${p.otra}`;
    case 'mapeo': return `${p.columna}: ${Object.keys(p.mapa ?? {}).length} valores`;
    case 'derivada': return `${p.nombre} = ${p.expresion}`;
    case 'duplicados': return p.columnas?.length ? `por ${p.columnas.join(', ')}` : 'todas las columnas';
    default: return p.condicion ?? '';
  }
}

function Formulario({ cat, paso: p, columnas, perfil, objetivo, onCambiar }: {
  cat: MlCatalogo; paso: MlPaso; columnas: string[]; perfil: MlPerfil | null; objetivo: string | null; onCambiar: (c: Partial<MlPaso>) => void;
}) {
  const op = (k: string) => cat.limpieza.opciones[k] ?? [];
  const sel = (k: keyof MlPaso, opciones: { valor: string; etiqueta: string }[], label: string) => (
    <select className="input" value={String(p[k] ?? '')} onChange={e => onCambiar({ [k]: e.target.value } as Partial<MlPaso>)} aria-label={label}>
      {opciones.map(o => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
    </select>
  );
  const txt = (k: keyof MlPaso, label: string, ph?: string, ancho = 220) => (
    <input className="input mono" style={{ width: ancho }} value={String(p[k] ?? '')} placeholder={ph} aria-label={label}
      onChange={e => onCambiar({ [k]: e.target.value } as Partial<MlPaso>)} />
  );
  const marcas = (k: 'ops' | 'partes' | 'columnas', opciones: { valor: string; etiqueta: string }[], label: string) => (
    <div className="es-marcas" role="group" aria-label={label}>
      {opciones.map(o => {
        const on = (p[k] ?? []).includes(o.valor);
        return (
          <label key={o.valor} className="es-marca">
            <input type="checkbox" checked={on} onChange={() => onCambiar({ [k]: on ? (p[k] ?? []).filter(x => x !== o.valor) : [...(p[k] ?? []), o.valor] } as Partial<MlPaso>)} />
            <span className={k === 'columnas' ? 'mono' : undefined}>{o.etiqueta}</span>
          </label>
        );
      })}
    </div>
  );
  const columna = p.tipo !== 'duplicados' && p.tipo !== 'filtro' && p.tipo !== 'derivada' && (
    <Campo label="Columna">
      <select className="input mono" value={p.columna ?? ''} onChange={e => onCambiar({ columna: e.target.value })} aria-label="Columna">
        {!columnas.includes(p.columna ?? '') && <option value={p.columna ?? ''}>{p.columna || '(elegí una)'}</option>}
        {columnas.map(c => <option key={c} value={c}>{c}{c === objetivo ? ' (objetivo)' : ''}</option>)}
      </select>
    </Campo>
  );
  const info = perfil?.columnas.find(c => c.nombre === p.columna);
  switch (p.tipo) {
    case 'tipo': return <>{columna}
      <Campo label="A">{sel('a', op('a'), 'Tipo nuevo')}</Campo>
      {(p.a === 'date' || p.a === 'timestamp') && <Campo label="Formato" nombre="to_date" ayuda="El patrón de Java: dd/MM/yyyy, yyyy-MM-dd HH:mm:ss… Vacío: el formato ISO.">{txt('formato', 'Formato de la fecha', 'dd/MM/yyyy', 160)}</Campo>}
    </>;
    case 'texto': return <>{columna}<Campo label="Qué hacer">{marcas('ops', op('texto'), 'Operaciones de texto')}</Campo></>;
    case 'regex': return <>{columna}
      <Campo label="Modo">{sel('modo', op('modo'), 'Reemplazar o extraer')}</Campo>
      <Campo label="Patrón" nombre="regexp" ayuda="Regex de Java: [$.] saca $ y puntos; ^\s+ los espacios del principio; (\d+) un grupo de dígitos.">{txt('patron', 'Patrón', '[$.]', 200)}</Campo>
      {p.modo === 'extraer'
        ? <Campo label="Grupo"><Numero value={p.grupo ?? 1} onChange={v => onCambiar({ grupo: v == null ? 1 : Math.round(v) })} min={0} max={20} label="Grupo" ancho={70} /></Campo>
        : <Campo label="Reemplazo" ayuda="$1, $2… para los grupos. Vacío borra lo que coincide.">{txt('reemplazo', 'Reemplazo', '', 140)}</Campo>}
      <Campo label="A la columna" ayuda="Vacío: la misma. Con un nombre nuevo, el resultado va a una columna aparte.">{txt('destino', 'Columna destino', p.columna, 160)}</Campo>
    </>;
    case 'fecha': return <>{columna}
      <Campo label="Formato" nombre="to_timestamp" ayuda="dd/MM/yyyy, MM-dd-yyyy, yyyy-MM-dd HH:mm… Vacío: el formato ISO (yyyy-MM-dd).">{txt('formato', 'Formato de la fecha', 'dd/MM/yyyy', 160)}</Campo>
      <Campo label="Con hora"><Switch checked={!!p.con_hora} onChange={v => onCambiar({ con_hora: v })} label="La fecha tiene hora" /></Campo>
      <Campo label="Separar en columnas" ayuda="Columnas numéricas nuevas: col_anio, col_mes…">{marcas('partes', op('partes'), 'Partes de la fecha')}</Campo>
    </>;
    case 'nulos': return <>{columna}
      <Campo label="Rellenar con" ayuda={info ? `${fnum(info.nulos)} vacías en el perfil (${(info.nulos_pct * 100).toFixed(1).replace('.', ',')} %)` : undefined}>{sel('estrategia', op('estrategia'), 'Cómo rellenar')}</Campo>
      {p.estrategia === 'constante' && <Campo label="Valor">{txt('valor', 'Valor fijo', '0', 120)}</Campo>}
      {p.estrategia !== 'eliminar' && <Campo label="Columna indicadora" nombre={`${p.columna}_nulo`}><Switch checked={!!p.indicador} onChange={v => onCambiar({ indicador: v })} label="Agregar la columna 0/1 de los nulos" /></Campo>}
    </>;
    case 'outliers': {
      const f = cat.limpieza.factor[p.metodo ?? 'iqr'];
      return <>{columna}
        <Campo label="Método">{sel('metodo', op('metodo'), 'Método de los bordes')}</Campo>
        <Campo label={p.metodo === 'zscore' ? 'z' : p.metodo === 'percentiles' ? 'percentil' : 'k'} ayuda={p.metodo === 'percentiles' ? 'Bordes en el percentil p y 100 − p.' : p.metodo === 'zscore' ? 'Bordes en la media ± z desvíos.' : '1,5 es la regla de Tukey; 3 solo toca lo muy lejano.'}>
          <Numero value={p.factor ?? f.defecto} onChange={v => v != null && onCambiar({ factor: v })} min={f.min} max={f.max} label="Factor" ancho={80} />
        </Campo>
        <Campo label="Qué hacer">{sel('accion', op('accion'), 'Qué hacer con los extremos')}</Campo>
      </>;
    }
    case 'raras': return <>{columna}
      <Campo label="Mínimo" nota="de las filas" ayuda="Las categorías con menos filas que esto se juntan.">
        <Numero value={(p.min_pct ?? 0.01) * 100} onChange={v => v != null && onCambiar({ min_pct: v / 100 })} min={0} max={50} label="Mínimo en %" ancho={80} />
      </Campo>
      <Campo label="Máximo de categorías"><Numero value={p.max_categorias ?? 50} onChange={v => v != null && onCambiar({ max_categorias: Math.round(v) })} min={1} max={1000} label="Máximo de categorías" ancho={80} /></Campo>
      <Campo label="Se juntan en">{txt('otra', 'Nombre de la categoría que junta', '(otra)', 120)}</Campo>
    </>;
    case 'mapeo': return <>{columna}<Mapa paso={p} info={info} onCambiar={onCambiar} op={op('resto')} /></>;
    case 'derivada': return <>
      <Campo label="Nombre">{txt('nombre', 'Nombre de la columna nueva', 'total', 160)}</Campo>
      <Campo label="Expresión" nombre="Spark SQL" ayuda="Sobre las columnas ya limpias: precio * cantidad, datediff(entrega, fecha), length(comentario), CASE WHEN … END">{txt('expresion', 'Expresión de Spark SQL', 'precio * cantidad', 320)}</Campo>
      <Campo label="Rol">
        <select className="input" value={p.rol ?? 'numerica'} onChange={e => onCambiar({ rol: e.target.value as MlRol })} aria-label="Rol de la columna nueva">
          {ROLES.map(r => <option key={r} value={r}>{ROL_LABEL[r]}</option>)}
        </select>
      </Campo>
    </>;
    case 'duplicados': return <Campo label="Repetidas en" ayuda="Ninguna marcada: filas iguales en todas las columnas.">{marcas('columnas', columnas.map(c => ({ valor: c, etiqueta: c })), 'Columnas que definen un duplicado')}</Campo>;
    default: return <Campo label="Dejar las filas donde" nombre="filter" ayuda="Una condición de Spark SQL sobre las columnas como vienen: cantidad > 0, pais = 'AR', fecha IS NOT NULL">{txt('condicion', 'Condición', 'cantidad > 0', 360)}</Campo>;
  }
}

/** La tabla de un mapeo: de → a, con los valores más comunes del perfil a mano */
function Mapa({ paso: p, info, onCambiar, op }: { paso: MlPaso; info?: MlPerfil['columnas'][number]; onCambiar: (c: Partial<MlPaso>) => void; op: { valor: string; etiqueta: string }[] }) {
  const filas = Object.entries(p.mapa ?? {});
  const poner = (m: [string, MlValor][]) => onCambiar({ mapa: Object.fromEntries(m) });
  return <>
    <Campo label="Valores" ayuda="Lo de la izquierda pasa a ser lo de la derecha (se compara como texto).">
      <div className="es-mapa">
        {filas.map(([de, a], n) => (
          <div key={n} className="es-mapa-fila">
            <input className="input mono" value={de} aria-label="Valor original" onChange={e => poner(filas.map((f, j) => (j === n ? [e.target.value, f[1]] : f)))} />
            <span aria-hidden="true">→</span>
            <input className="input mono" value={String(a ?? '')} aria-label="Valor nuevo" onChange={e => poner(filas.map((f, j) => (j === n ? [f[0], e.target.value] : f)))} />
            <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={() => poner(filas.filter((_, j) => j !== n))} aria-label="Sacar este valor"><Trash2 size={12} /></button>
          </div>
        ))}
        <div className="es-acciones">
          <button type="button" className="btn btn-sm" onClick={() => poner([...filas, ['', '']])}><Plus size={12} aria-hidden="true" />Agregar</button>
          {info?.top && <button type="button" className="btn btn-sm" onClick={() => poner([...filas, ...info.top!.filter(t => !(t.valor in (p.mapa ?? {}))).map(t => [t.valor, t.valor] as [string, MlValor])])}>Traer los más comunes ({info.top.length})</button>}
        </div>
      </div>
    </Campo>
    <Campo label="Lo que no está">
      <select className="input" value={p.resto ?? 'conservar'} onChange={e => onCambiar({ resto: e.target.value as MlPaso['resto'] })} aria-label="Lo que no está en la tabla">
        {op.map(o => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
      </select>
    </Campo>
    {p.resto === 'valor' && <Campo label="Valor"><input className="input mono" value={String(p.otro ?? '')} onChange={e => onCambiar({ otro: e.target.value })} aria-label="Valor para lo que no está" /></Campo>}
  </>;
}

function Vista({ vista, vieja, abierto, onAbrir }: { vista: MlVistaLimpieza; vieja: boolean; abierto: number | null; onAbrir: (i: number | null) => void }) {
  const sel = vista.pasos.find(p => p.paso === abierto) ?? vista.pasos.find(p => p.ok && p.ejemplos?.filas.length) ?? null;
  const sacadas = vista.filas.leidas - vista.filas.entrenamiento;
  return (
    <>
      <div className="es-pad">
        {vieja && <p className="es-sugerencia" role="status">La receta cambió desde esta vista previa: volvé a probarla.</p>}
        <StatRow label="Resumen de la vista previa">
          <Stat label="filas de muestra" value={fnum(vista.filas.leidas)} />
          <Stat label="quedan para entrenar" value={fnum(vista.filas.entrenamiento)} sub={sacadas ? `−${fnum(sacadas)} (${((sacadas / Math.max(1, vista.filas.leidas)) * 100).toFixed(1).replace('.', ',')} %)` : 'ninguna sacada'} k={sacadas ? 'run' : undefined} />
          <Stat label="expresiones en el modelo" value={vista.expresiones.length} sub="paso Limpiar" />
          <Stat label="tardó" value={`${vista.segundos.toString().replace('.', ',')} s`} sub="Spark local" />
        </StatRow>
      </div>
      <div className="tbl-wrap">
        <table className="tbl es-vista-pasos" aria-label="Lo que hizo cada paso">
          <thead><tr><th>#</th><th>paso</th><th>fase</th><th className="r">filas</th><th className="r">afectadas</th><th>aprendido</th></tr></thead>
          <tbody>
            {vista.pasos.map(p => (
              <tr key={p.paso} aria-selected={sel?.paso === p.paso} onClick={() => onAbrir(p.paso)} data-k={p.ok ? undefined : 'bad'}>
                <td className="mono">{p.paso + 1}</td>
                <td>{p.titulo}{!p.ok && p.error && <div className="es-cerr">{p.error.mensaje}</div>}</td>
                <td className="muted">{p.fase === 'entrenamiento' ? 'entrenamiento' : 'modelo'}</td>
                <td className="r mono">{p.ok ? (p.filas_antes !== p.filas_despues ? `${fnum(p.filas_antes)} → ${fnum(p.filas_despues)}` : fnum(p.filas_despues)) : '—'}</td>
                <td className="r mono">{p.ok ? `${p.quita ? '−' : ''}${fnum(p.afectadas ?? 0)}` : '—'}</td>
                <td className="mono muted es-resu">{p.aprendido ? aprendido(p.aprendido) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sel && (
        <div className="es-pad">
          <h3 className="es-h3">Paso {sel.paso + 1}: {sel.quita ? 'filas que se sacan' : 'antes → después'} <span className="muted">(hasta 8 de {fnum(sel.afectadas ?? 0)})</span></h3>
          {sel.ok && sel.ejemplos?.filas.length
            ? <ResultTable columns={sel.ejemplos.columnas} rows={sel.ejemplos.filas} label={`Ejemplos del paso ${sel.paso + 1}`} fileName={`paso_${sel.paso + 1}`} maxHeight={260} />
            : <p className="muted es-nota">{sel.ok ? 'Este paso no cambió ninguna fila de la muestra.' : sel.error?.detalle ?? sel.error?.mensaje}</p>}
          {sel.expresiones?.length ? <pre className="mono es-expr">{sel.expresiones.map(([c, e]) => `${c} = ${e}`).join('\n')}</pre> : null}
        </div>
      )}
      <div className="es-pad"><h3 className="es-h3">Cómo quedan <span className="muted">(las primeras 20 filas, después de todos los pasos)</span></h3></div>
      <ResultTable columns={vista.final.columnas} rows={vista.final.filas} label="Datos limpios" fileName="limpios" maxHeight={320} />
    </>
  );
}

function aprendido(a: Record<string, MlValor | MlValor[]>): string {
  return Object.entries(a).map(([k, v]) => `${k} ${Array.isArray(v) ? `[${v.slice(0, 6).join(', ')}${v.length > 6 ? ', …' : ''}]` : typeof v === 'number' ? fnum(v) : String(v)}`).join(' · ');
}

/** Nombre, versión guardada y las versiones anteriores de la receta de limpieza */
function Versiones({ lim, nombreSugerido, perfil }: { lim: MlLimpieza; nombreSugerido: string; perfil: MlPerfil | null }) {
  const lista = useApi(a => a.mlCleanings(), []);
  const [nombre, setNombre] = useState(lim.nombre ?? nombreSugerido);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [elegida, setElegida] = useState('');
  useEffect(() => { if (lim.nombre) setNombre(lim.nombre); }, [lim.nombre]);

  async function guardar() {
    setGuardando(true);
    try {
      const r = await api().mlSaveCleaning(nombre.trim(), { pasos: lim.pasos }, nota || null);
      editar(x => ({ ...x, limpieza: { ...(x.limpieza ?? { pasos: [] }), nombre: r.nombre, version: r.version } }));
      setNota('');
      lista.reload();
      toast({ kind: 'ok', title: r.nueva ? `Guardada: ${r.nombre} v${r.version}` : `Sin cambios: sigue siendo ${r.nombre} v${r.version}` });
    } catch (e) {
      toast({ kind: 'bad', title: 'No se pudo guardar la receta', description: e instanceof Error ? e.message : String(e) });
    } finally { setGuardando(false); }
  }

  async function cargar(v: string) {
    setElegida(v);
    const [n, ver] = v.split('@');
    if (!n) return;
    try {
      const doc = await api().mlCleaning(n);
      const version = doc.versiones.find(x => String(x.version) === ver) ?? doc.versiones[doc.versiones.length - 1];
      editarLimpieza(() => ({ ...version.limpieza, nombre: doc.nombre }), perfil);
      editar(x => ({ ...x, limpieza: { ...(x.limpieza ?? version.limpieza), nombre: doc.nombre, version: version.version } }));
      toast({ kind: 'ok', title: `Cargada: ${doc.nombre} v${version.version}`, description: version.nota ?? `${version.limpieza.pasos.length} pasos` });
    } catch (e) {
      toast({ kind: 'bad', title: 'No se pudo cargar', description: e instanceof Error ? e.message : String(e) });
    } finally { setElegida(''); }
  }

  return (
    <Panel title="Receta de limpieza" sub={lim.version ? <span className="badge" data-k="ok">{lim.nombre} v{lim.version}</span> : lim.pasos.length ? <span className="badge" data-k="run">sin guardar</span> : 'vacía'}>
      <div className="es-form-fila">
        <Campo label="Nombre"><input className="input mono" value={nombre} onChange={e => setNombre(e.target.value)} aria-label="Nombre de la receta de limpieza" style={{ width: 200 }} /></Campo>
        <Campo label="Nota de la versión"><input className="input" value={nota} placeholder="qué cambió" onChange={e => setNota(e.target.value)} aria-label="Nota de la versión" style={{ width: 240 }} /></Campo>
        <button type="button" className="btn btn-primary es-alinear" disabled={guardando || !lim.pasos.length || !nombre.trim()} onClick={guardar}><Save size={13} aria-hidden="true" />{guardando ? 'Guardando…' : 'Guardar versión'}</button>
        <Campo label="Abrir una guardada">
          <select className="input" value={elegida} onChange={e => cargar(e.target.value)} aria-label="Abrir una receta guardada" disabled={!lista.data?.length}>
            <option value="">{lista.data?.length ? 'elegí una…' : 'no hay guardadas'}</option>
            {(lista.data ?? []).map((f: MlLimpiezaFila) => <Opcion key={f.nombre} f={f} />)}
          </select>
        </Campo>
        <span className="muted es-alinear"><History size={13} aria-hidden="true" /> Cada versión queda en /hadoop/ml/limpiezas; el experimento guarda la que usó.</span>
      </div>
    </Panel>
  );
}

function Opcion({ f }: { f: MlLimpiezaFila }) {
  const versiones = Array.from({ length: Math.min(f.versiones, 10) }, (_, i) => f.version - i).filter(v => v > 0);
  return (
    <optgroup label={`${f.nombre} (${f.versiones} versión${f.versiones > 1 ? 'es' : ''})`}>
      {versiones.map(v => <option key={v} value={`${f.nombre}@${v}`}>{f.nombre} v{v}{v === f.version ? ` · ${f.pasos} pasos · ${f.creado.slice(0, 16).replace('T', ' ')}` : ''}</option>)}
    </optgroup>
  );
}
