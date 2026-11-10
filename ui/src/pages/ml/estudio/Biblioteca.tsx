/* Biblioteca de modelos (#ml/biblioteca, #ml/biblioteca/<nombre>): los modelos que se usan, con sus versiones
   (candidato, en producción, archivado), de dónde salió cada una (linaje), comparar, promover y volver atrás, y
   predecir con datos nuevos: al instante (unas filas) o por lotes con Spark en YARN (HDFS o Hive → HDFS o Hive),
   con la validación del esquema y la deriva contra el entrenamiento. Todo sale de /api/ml/library. */
import { Suspense, lazy, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, Columns3, Download, History, Library, Play, RotateCcw, Rocket, Archive, Code2, FlaskConical } from 'lucide-react';
import { api } from '../../../api';
import type {
  MlCatalogo, MlColumnaEntrada, MlDatos, MlDeriva, MlDerivaColumna, MlEstadoVersion, MlLote, MlModeloBiblioteca, MlModeloFila,
  MlPedidoLote, MlPrediccion, MlValor, MlVersion,
} from '../../../api/types';
import { EmptyState, KeyValue, Panel, ResultTable, SkeletonLines, Stat, StatRow } from '../../../components/base';
import { Seg } from '../../../components/ui';
import { confirm, navigate, toast } from '../../../state/ui';
import { useApi } from '../../../state/useApi';
import { Consola, useCorrida } from './comun';
import { fmtBytes, fmtMb, fmtMetrica, fmtSeg } from './estado';

const Editor = lazy(() => import('./Editor'));

const ESTADO_V: Record<MlEstadoVersion, { label: string; k?: 'ok' | 'run' | 'bad' }> = {
  produccion: { label: 'en producción', k: 'ok' }, candidato: { label: 'candidato', k: 'run' }, archivado: { label: 'archivado' },
};
const NIVEL: Record<string, 'ok' | 'run' | 'bad'> = { estable: 'ok', moderada: 'run', fuerte: 'bad' };
const LOTE: Record<MlLote['estado'], 'ok' | 'bad' | 'run'> = { listo: 'ok', 'falló': 'bad', corriendo: 'run' };

const errorTexto = (e: unknown) => (e instanceof Error ? e.message : String(e));
const fecha = (s?: string | null) => (s ? s.replace('T', ' ').slice(0, 16) : '—');
const valorPrincipal = (x: MlVersion) => {
  const m = x.metricas[x.metrica ?? ''] ?? {};
  return m.prueba ?? m.cv ?? null;
};

async function bajar(url: string, name: string) {
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
}

export function Biblioteca({ cat, arg }: { cat: MlCatalogo; arg: string[] }) {
  if (arg[0]) return <Modelo cat={cat} nombre={decodeURIComponent(arg[0])} />;
  return <Lista cat={cat} />;
}

/* ---------------------------------------------------------------- la lista */

function Lista({ cat }: { cat: MlCatalogo }) {
  const modelos = useApi(a => a.mlLibrary(), [], e => e.type === 'mlrun' && e.run.estado !== 'corriendo');
  const lotes = useApi(a => a.mlLibraryBatches(), [], e => e.type === 'mlrun' && e.run.tipo === 'lote' && e.run.estado !== 'corriendo');
  if (modelos.error) return <Panel title="Biblioteca de modelos"><EmptyState compact kind="error" title="No se pudo leer la biblioteca">{modelos.error}</EmptyState></Panel>;
  if (!modelos.data) return <Panel title="Biblioteca de modelos"><SkeletonLines n={6} /></Panel>;
  return (
    <div className="es-pila">
      <Panel title="Biblioteca de modelos" sub={`${modelos.data.length} modelo${modelos.data.length === 1 ? '' : 's'} en /hadoop/ml/biblioteca`} flush>
        {!modelos.data.length ? (
          <div className="es-pad">
            <EmptyState icon={<Library size={20} aria-hidden="true" />} title="Todavía no hay modelos guardados"
              actions={<button type="button" className="btn btn-primary" onClick={() => navigate('ml', 'experimentos')}>Ir a Experimentos</button>}>
              Un experimento es una corrida; un modelo de la biblioteca es un nombre (churn, gasto) con versiones. Abrí un experimento que
              terminó bien y tocá <b>Guardar en la biblioteca</b>: queda como candidato, con su linaje, y se puede promover a producción.
            </EmptyState>
          </div>
        ) : <TablaModelos cat={cat} filas={modelos.data} />}
      </Panel>
      <Panel title="Lotes de predicción" sub="los últimos, de todos los modelos" flush>
        {lotes.data?.length ? <TablaLotes cat={cat} lotes={lotes.data} conModelo /> : (
          <div className="es-pad"><p className="es-nota">Cuando predigas por lotes (en cada modelo, pestaña <b>predecir</b>), aparecen acá: qué datos, adónde fueron las predicciones, cuántas filas y cuánta deriva hubo.</p></div>
        )}
      </Panel>
    </div>
  );
}

function TablaModelos({ cat, filas }: { cat: MlCatalogo; filas: MlModeloFila[] }) {
  return (
    <div className="tbl-wrap">
      <table className="tbl es-lb" aria-label="Modelos de la biblioteca">
        <thead><tr><th>modelo</th><th>predice</th><th>en producción</th><th>métrica</th><th className="r">valor</th><th className="r">versiones</th><th>actualizado</th></tr></thead>
        <tbody>
          {filas.map(f => (
            <tr key={f.nombre} className="es-lbf" onClick={() => navigate('ml', `biblioteca/${encodeURIComponent(f.nombre)}`)}>
              <td><b className="mono">{f.nombre}</b>{f.descripcion && <span className="es-lbn">{f.descripcion}</span>}</td>
              <td>{cat.tareas[f.tarea]?.etiqueta}{f.objetivo && <span className="muted"> → <span className="mono">{f.objetivo}</span></span>}</td>
              <td>{f.produccion != null
                ? <><span className="badge" data-k="ok">v{f.produccion}</span> {f.modeloEtiqueta} <span className={f.motor === 'spark' ? 'eng eng-spark' : 'eng eng-uno'}>{f.motor === 'spark' ? 'MLlib' : 'sklearn'}</span></>
                : <span className="muted">ninguna</span>}</td>
              <td>{f.metrica ? cat.metricas[f.metrica]?.etiqueta ?? f.metrica : '—'}</td>
              <td className="r mono">{fmtMetrica(f.valor)}</td>
              <td className="r mono">{f.versiones}{f.candidatas ? <span className="muted"> · {f.candidatas} cand.</span> : null}</td>
              <td className="mono muted">{fecha(f.actualizado)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TablaLotes({ cat, lotes, conModelo, onAbrir }: { cat: MlCatalogo; lotes: MlLote[]; conModelo?: boolean; onAbrir?: (l: MlLote) => void }) {
  void cat;
  return (
    <div className="tbl-wrap">
      <table className="tbl es-lb" aria-label="Lotes de predicción">
        <thead><tr>{conModelo && <th>modelo</th>}<th>datos nuevos</th><th>predicciones</th><th className="r">filas</th><th>deriva</th><th className="r">tiempo</th><th>cuándo</th><th>estado</th></tr></thead>
        <tbody>
          {lotes.map(l => {
            const r = l.resumen;
            return (
              <tr key={l.id} className={onAbrir || conModelo ? 'es-lbf' : undefined}
                onClick={() => (onAbrir ? onAbrir(l) : conModelo ? navigate('ml', `biblioteca/${encodeURIComponent(l.modelo)}`) : undefined)}>
                {conModelo && <td><b className="mono">{l.modelo}</b> <span className="muted">v{l.version}</span></td>}
                <td className="mono muted es-lbd" title={l.entrada}>{l.entrada}</td>
                <td className="mono muted es-lbd" title={r?.destino}>{r?.destino ?? (l.salida.tipo === 'hive' ? l.salida.tabla : l.salida.ruta)}</td>
                <td className="r mono">{r ? r.filas.toLocaleString('es-AR') : '—'}</td>
                <td>{r?.deriva?.nivel ? <span className="badge" data-k={NIVEL[r.deriva.nivel]}>{r.deriva.nivel}</span> : <span className="muted">—</span>}</td>
                <td className="r mono">{fmtSeg(r?.tiempo)}</td>
                <td className="mono muted">{fecha(l.creado)}</td>
                <td><span className="badge" data-k={LOTE[l.estado]} title={l.error}>{l.estado}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------- un modelo */

type Vista = 'versiones' | 'predecir' | 'lotes' | 'historial';

function Modelo({ cat, nombre }: { cat: MlCatalogo; nombre: string }) {
  const m = useApi(a => a.mlLibraryModel(nombre), [nombre], e => e.type === 'mlrun' && e.run.tipo === 'lote' && e.run.modelo === nombre && e.run.estado !== 'corriendo');
  const [vista, setVista] = useState<Vista>('versiones');
  const [elegida, setElegida] = useState<number | null>(null);
  const [marcadas, setMarcadas] = useState<number[]>([]);
  const [lote, setLote] = useState<MlLote | null>(null);
  if (m.error) return <Panel title={nombre}><EmptyState compact kind="error" title="No se pudo abrir el modelo">{m.error}</EmptyState></Panel>;
  if (!m.data) return <Panel title={nombre}><SkeletonLines n={8} /></Panel>;
  const mod = m.data;
  const prod = mod.versiones.find(x => x.estado === 'produccion') ?? null;
  const puedeVolver = mod.historial.some(h => (h.accion === 'promover' || h.accion === 'volver') && h.version !== prod?.version);

  async function cambiar(accion: 'promover' | 'archivar' | 'volver', version?: number) {
    const titulo = accion === 'promover' ? `Promover la versión ${version} a producción`
      : accion === 'archivar' ? `Archivar la versión ${version}` : 'Volver a la versión anterior';
    const descripcion = accion === 'promover'
      ? (prod ? `La versión ${prod.version} (hoy en producción) pasa a archivada. La predicción sin versión usa la ${version}.` : `Queda como la versión en producción de ${nombre}.`)
      : accion === 'archivar' ? (version === prod?.version ? `Es la que está en producción: ${nombre} queda sin versión en producción.` : 'Deja de estar disponible como candidata; se puede volver a promover.')
        : 'Promueve la versión que estuvo en producción antes de la actual, y archiva la actual.';
    const ok = await confirm({ title: titulo, description: descripcion, confirmLabel: accion === 'volver' ? 'Volver atrás' : accion === 'promover' ? 'Promover' : 'Archivar', danger: accion !== 'promover' });
    if (!ok) return;
    try {
      await api().mlLibraryState(nombre, { accion, version });
      m.reload();
      toast({ kind: 'ok', title: accion === 'volver' ? 'Volvió a la versión anterior' : accion === 'promover' ? `v${version} en producción` : `v${version} archivada` });
    } catch (e) { toast({ kind: 'bad', title: 'No se pudo cambiar el estado', description: errorTexto(e) }); }
  }
  async function exportar(version?: number) {
    try { const d = await api().mlLibraryExport(nombre, version ?? null); await bajar(d.url, d.name); }
    catch (e) { toast({ kind: 'bad', title: 'No se pudo exportar', description: errorTexto(e) }); }
  }

  const x = mod.versiones.find(v => v.version === (elegida ?? prod?.version ?? mod.versiones[mod.versiones.length - 1]?.version)) ?? null;
  return (
    <div className="es-detalle">
      <div className="es-det-bar">
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => navigate('ml', 'biblioteca')}><ArrowLeft size={13} aria-hidden="true" />Biblioteca</button>
        <Seg value={vista} onChange={v => { setVista(v); setLote(null); }} label="Vista del modelo" options={[
          { value: 'versiones', label: 'versiones' }, { value: 'predecir', label: 'predecir', disabled: !mod.versiones.some(v => v.estado !== 'archivado') && !prod },
          { value: 'lotes', label: `lotes${mod.lotes.length ? ` (${mod.lotes.length})` : ''}` }, { value: 'historial', label: 'historial' },
        ]} />
        <span className="es-det-acc">
          <button type="button" className="btn btn-sm" disabled={!puedeVolver} onClick={() => cambiar('volver')} title="Promueve la versión que estuvo en producción antes"><RotateCcw size={13} aria-hidden="true" />Volver atrás</button>
          <button type="button" className="btn btn-sm" disabled={!mod.versiones.length} onClick={() => exportar(prod?.version)}><Download size={13} aria-hidden="true" />Exportar{prod ? ` v${prod.version}` : ''}</button>
        </span>
      </div>
      <Panel title={<span className="mono">{nombre}</span>} sub={mod.descripcion || undefined}>
        <StatRow label={`Resumen de ${nombre}`}>
          <Stat label="predice" value={cat.tareas[mod.tarea]?.etiqueta ?? mod.tarea} sub={mod.objetivo ? <>la columna <span className="mono">{mod.objetivo}</span></> : 'sin objetivo'} />
          <Stat label="en producción" value={prod ? `v${prod.version}` : '—'} k={prod ? 'ok' : undefined} sub={prod ? `${prod.modelo.etiqueta} · ${prod.motor === 'spark' ? 'Spark MLlib' : 'scikit-learn'}` : 'promové una versión para predecir sin elegir'} />
          <Stat label={mod.metrica ? cat.metricas[mod.metrica]?.etiqueta ?? mod.metrica : 'métrica'} value={prod ? fmtMetrica(valorPrincipal(prod)) : '—'} sub="en la prueba" />
          <Stat label="versiones" value={mod.versiones.length} sub={`${mod.versiones.filter(v => v.estado === 'candidato').length} candidatas · ${mod.versiones.filter(v => v.estado === 'archivado').length} archivadas`} />
        </StatRow>
      </Panel>
      {vista === 'versiones' && (
        <>
          <Versiones cat={cat} mod={mod} elegida={x?.version ?? null} onElegir={setElegida} marcadas={marcadas}
            onMarcar={v => setMarcadas(l => (l.includes(v) ? l.filter(y => y !== v) : [...l, v].slice(-4)))} onCambiar={cambiar} />
          {marcadas.length >= 2 && <Comparar nombre={nombre} versiones={marcadas} />}
          {x && <DetalleVersion cat={cat} x={x} onExportar={() => exportar(x.version)} onCambiar={cambiar} />}
        </>
      )}
      {vista === 'predecir' && <Predecir cat={cat} mod={mod} onLote={() => m.reload()} />}
      {vista === 'lotes' && (lote ? <ResumenLote cat={cat} lote={lote} onVolver={() => setLote(null)} />
        : mod.lotes.length ? <Panel title="Lotes de este modelo" flush><TablaLotes cat={cat} lotes={mod.lotes} onAbrir={setLote} /></Panel>
          : <Panel title="Lotes de este modelo"><p className="es-nota">Todavía no hay lotes. En <b>predecir</b> → <b>por lotes</b> se eligen los datos nuevos (HDFS o Hive) y adónde van las predicciones.</p></Panel>)}
      {vista === 'historial' && <Historial mod={mod} />}
    </div>
  );
}

function Versiones({ cat, mod, elegida, onElegir, marcadas, onMarcar, onCambiar }: {
  cat: MlCatalogo; mod: MlModeloBiblioteca; elegida: number | null; onElegir: (v: number) => void; marcadas: number[];
  onMarcar: (v: number) => void; onCambiar: (a: 'promover' | 'archivar', v: number) => void;
}) {
  const metrica = mod.metrica ? cat.metricas[mod.metrica] : undefined;
  return (
    <Panel title="Versiones" sub={marcadas.length ? `${marcadas.length} marcadas para comparar` : 'marcá 2 a 4 para compararlas'} flush>
      <div className="tbl-wrap">
        <table className="tbl es-lb" aria-label={`Versiones de ${mod.nombre}`}>
          <thead><tr><th aria-label="Comparar" /><th>versión</th><th>estado</th><th>modelo</th><th className="r">{metrica?.etiqueta ?? 'métrica'}</th><th>nota</th><th>guardada</th><th aria-label="Acciones" /></tr></thead>
          <tbody>
            {[...mod.versiones].reverse().map(v => (
              <tr key={v.version} className="es-lbf" data-elegida={v.version === elegida || undefined} onClick={() => onElegir(v.version)}>
                <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={marcadas.includes(v.version)} onChange={() => onMarcar(v.version)} aria-label={`Comparar la versión ${v.version}`} /></td>
                <td className="mono"><b>v{v.version}</b></td>
                <td><span className="badge" data-k={ESTADO_V[v.estado].k}>{ESTADO_V[v.estado].label}</span></td>
                <td>{v.modelo.etiqueta} <span className={v.motor === 'spark' ? 'eng eng-spark' : 'eng eng-uno'}>{v.motor === 'spark' ? 'MLlib' : 'sklearn'}</span></td>
                <td className="r mono">{fmtMetrica(valorPrincipal(v))}</td>
                <td className="es-lbd" title={v.nota}>{v.nota || <span className="muted">—</span>}</td>
                <td className="mono muted">{fecha(v.creado)}</td>
                <td onClick={e => e.stopPropagation()} className="es-acc-fila">
                  {v.estado !== 'produccion' && <button type="button" className="btn btn-sm" onClick={() => onCambiar('promover', v.version)}><Rocket size={12} aria-hidden="true" />Promover</button>}
                  {v.estado !== 'archivado' && <button type="button" className="btn btn-sm btn-ghost" onClick={() => onCambiar('archivar', v.version)} aria-label={`Archivar la versión ${v.version}`}><Archive size={12} aria-hidden="true" /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Comparar({ nombre, versiones }: { nombre: string; versiones: number[] }) {
  const c = useApi(a => a.mlLibraryCompare(nombre, [...versiones].sort((p, q) => p - q)), [nombre, versiones.join(',')]);
  const [todos, setTodos] = useState(false);
  if (c.error) return <Panel title="Comparar"><EmptyState compact kind="error" title="No se pudo comparar">{c.error}</EmptyState></Panel>;
  if (!c.data) return <Panel title="Comparar"><SkeletonLines n={5} /></Panel>;
  const d = c.data;
  const params = todos ? d.params : d.params.filter(p => p.cambia);
  return (
    <Panel title={<><Columns3 size={14} aria-hidden="true" /> Comparar versiones</>} sub="la mejor de cada métrica, en verde" flush
      end={<label className="es-check"><input type="checkbox" checked={todos} onChange={e => setTodos(e.target.checked)} /> todos los hiperparámetros</label>}>
      <div className="tbl-wrap">
        <table className="tbl es-cmp" aria-label="Comparación de versiones">
          <thead><tr><th />{d.versiones.map(v => <th key={v.version} scope="col"><b className="mono">v{v.version}</b> <span className="badge" data-k={ESTADO_V[v.estado].k}>{ESTADO_V[v.estado].label}</span><span className="es-lbn">{v.modelo} · {v.motor === 'spark' ? 'MLlib' : 'sklearn'}</span></th>)}</tr></thead>
          <tbody>
            {d.metricas.map(mt => (
              <tr key={mt.metrica}>
                <th scope="row">{mt.etiqueta}{mt.principal && <span className="tag">principal</span>}{!mt.mayor_mejor && <span className="muted"> (menos es mejor)</span>}</th>
                {mt.valores.map((v, i) => <td key={i} className="mono" data-mejor={mt.mejor?.includes(d.versiones[i].version) || undefined}>{fmtMetrica(v)}</td>)}
              </tr>
            ))}
            {d.versiones.some(v => v.umbral) && (
              <tr><th scope="row">umbral</th>{d.versiones.map(v => <td key={v.version} className="mono">{v.umbral ? `${v.umbral.valor} (${v.umbral.criterio})` : '—'}</td>)}</tr>
            )}
            <tr className="es-cmp-sep"><th colSpan={d.versiones.length + 1}>hiperparámetros {todos ? '' : '(solo los que cambian)'}</th></tr>
            {params.length ? params.map(p => (
              <tr key={p.param} data-distinto={p.cambia || undefined}><th scope="row" className="mono">{p.param}</th>{p.valores.map((v, i) => <td key={i} className="mono">{v == null ? '—' : String(v)}</td>)}</tr>
            )) : <tr><td colSpan={d.versiones.length + 1} className="muted">Los mismos hiperparámetros en todas.</td></tr>}
            <tr className="es-cmp-sep"><th colSpan={d.versiones.length + 1}>datos</th></tr>
            <tr><th scope="row">fuente</th>{d.datos.map(x => <td key={x.version} className="mono es-lbd" title={x.fuente ?? ''}>{(x.fuente ?? '—').split('/').pop()}</td>)}</tr>
            <tr><th scope="row">filas</th>{d.datos.map(x => <td key={x.version} className="mono">{x.filas ? `${x.filas.entrenamiento.toLocaleString('es-AR')} / ${x.filas.prueba.toLocaleString('es-AR')}` : '—'}</td>)}</tr>
            <tr><th scope="row">limpieza</th>{d.datos.map(x => <td key={x.version}>{x.limpieza ? `${x.limpieza.nombre ?? 'sin nombre'}${x.limpieza.version ? ` v${x.limpieza.version}` : ''} · ${x.limpieza.pasos} pasos` : <span className="muted">ninguna</span>}</td>)}</tr>
            <tr><th scope="row">huella de la receta</th>{d.datos.map(x => <td key={x.version} className="mono">{x.huella ?? '—'}</td>)}</tr>
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function DetalleVersion({ cat, x, onExportar, onCambiar }: { cat: MlCatalogo; x: MlVersion; onExportar: () => void; onCambiar: (a: 'promover' | 'archivar', v: number) => void }) {
  const l = x.linaje;
  const d = l.datos;
  return (
    <div className="es-graf-grid">
      <Panel title={<>Linaje de <span className="mono">v{x.version}</span></>} sub="de dónde salió esta versión"
        end={<>
          <button type="button" className="btn btn-sm" onClick={() => navigate('ml', `experimentos/${x.experimento}`)}><FlaskConical size={13} aria-hidden="true" />Experimento</button>
          <button type="button" className="btn btn-sm" onClick={onExportar}><Download size={13} aria-hidden="true" />.zip</button>
          {x.estado !== 'produccion' && <button type="button" className="btn btn-sm btn-primary" onClick={() => onCambiar('promover', x.version)}><Rocket size={13} aria-hidden="true" />Promover</button>}
        </>}>
        <KeyValue items={[
          ['datos', <span className="mono" key="d">{d?.ruta ?? d?.tabla ?? '—'}{d?.formato ? ` (${d.formato})` : ''}</span>],
          ['filas', l.filas ? `${l.filas.entrenamiento.toLocaleString('es-AR')} entrenamiento${l.filas.validacion != null ? ` · ${l.filas.validacion.toLocaleString('es-AR')} validación` : ''} · ${l.filas.prueba.toLocaleString('es-AR')} prueba` : '—'],
          ['limpieza', l.limpieza ? `${l.limpieza.nombre ?? 'sin nombre'}${l.limpieza.version ? ` v${l.limpieza.version}` : ''} (${l.limpieza.pasos} pasos, adentro del modelo)` : 'ninguna'],
          ['receta', <span className="mono" key="h">huella {l.huella_receta ?? '—'}{l.editado ? ' · código editado' : ''}</span>],
          ['modelo', `${x.modelo.etiqueta} (${x.motor === 'spark' ? 'Spark MLlib' : 'scikit-learn'})`],
          ['validación', [l.validacion.particion, l.validacion.cv && l.validacion.cv !== 'ninguna' ? `CV ${l.validacion.cv} k=${l.validacion.k}` : null, l.validacion.metrica ? `métrica ${cat.metricas[String(l.validacion.metrica)]?.etiqueta ?? l.validacion.metrica}` : null].filter(Boolean).join(' · ') || '—'],
          ...(x.umbral ? [['umbral', `${x.umbral.valor} (${x.umbral.criterio}, elegido en la validación)`] as [string, string]] : []),
          ...(l.busqueda?.mejores_params ? [['búsqueda', `${l.busqueda.tipo}: ${Object.entries(l.busqueda.mejores_params).map(([k, v]) => `${k}=${v}`).join(', ')}`] as [string, string]] : []),
          ...(l.yarn ? [['YARN', <span className="mono" key="y">{l.yarn}</span>] as [string, ReactNode]] : []),
          ...(l.recursos ? [['recursos', `${l.recursos.executors} executors de ${l.recursos.memoria_executor_mb} MB · driver ${l.recursos.memoria_driver_mb} MB`] as [string, string]] : []),
          ['artefacto', <span className="mono" key="a">{x.motor === 'spark' ? `hdfs://${x.artefacto}` : x.artefacto}{x.modelo_bytes ? ` · ${fmtBytes(x.modelo_bytes)}` : ''}</span>],
          ...(x.copia_hdfs ? [['copia en HDFS', <span className="mono" key="c">hdfs://{x.copia_hdfs}</span>] as [string, ReactNode]] : []),
          ['entorno', l.entorno ? Object.entries(l.entorno).filter(([k]) => !['maquina', 'cpus'].includes(k)).map(([k, v]) => `${k} ${v}`).join(' · ') : '—'],
        ]} />
        {x.nota && <p className="es-nota">Nota: {x.nota}</p>}
      </Panel>
      <Panel title="Lo que espera" sub="columnas que tienen que venir en los datos nuevos" flush>
        <EsquemaEntrada entrada={x.entrada} />
        <div className="es-pad"><p className="es-nota">{x.deriva ? 'Guardó la distribución de cada variable en el entrenamiento: al predecir por lotes se mide la deriva (PSI).' : 'Esta versión no guardó la referencia del entrenamiento: los lotes no miden la deriva.'} La limpieza y el preprocesamiento van adentro del modelo: los datos nuevos llegan crudos.</p></div>
      </Panel>
    </div>
  );
}

function EsquemaEntrada({ entrada }: { entrada?: MlColumnaEntrada[] | null }) {
  if (!entrada?.length) return <div className="es-pad"><p className="es-nota">Sin esquema guardado (versión vieja).</p></div>;
  return (
    <div className="tbl-wrap">
      <table className="tbl" aria-label="Esquema de entrada">
        <thead><tr><th>columna</th><th>rol</th><th>tipo en el entrenamiento</th></tr></thead>
        <tbody>{entrada.map(c => <tr key={c.columna}><td className="mono">{c.columna}</td><td>{c.rol}</td><td className="mono muted">{c.tipo ?? '—'}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function Historial({ mod }: { mod: MlModeloBiblioteca }) {
  const ACC: Record<string, string> = { registrar: 'guardada', promover: 'promovida a producción', archivar: 'archivada', volver: 'volvió a producción' };
  return (
    <Panel title={<><History size={14} aria-hidden="true" /> Historial</>} sub="cada cambio de estado, del más nuevo al más viejo">
      <ol className="es-hist">
        {[...mod.historial].reverse().map((h, i) => (
          <li key={i} data-accion={h.accion}>
            <span className="mono muted">{fecha(h.cuando)}</span>
            <span><b className="mono">v{h.version}</b> {ACC[h.accion] ?? h.accion}{h.detalle && <span className="muted"> · {h.detalle}</span>}</span>
            {h.nota && <span className="es-hist-nota">“{h.nota}”</span>}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

/* ---------------------------------------------------------------- predecir */

function Predecir({ cat, mod, onLote }: { cat: MlCatalogo; mod: MlModeloBiblioteca; onLote: () => void }) {
  const prod = mod.versiones.find(v => v.estado === 'produccion');
  const usables = mod.versiones.filter(v => v.estado !== 'archivado' || v === prod);
  const [version, setVersion] = useState<number>(prod?.version ?? usables[usables.length - 1]?.version ?? mod.versiones[mod.versiones.length - 1].version);
  const [modo, setModo] = useState<'instante' | 'lote'>('instante');
  const x = mod.versiones.find(v => v.version === version)!;
  return (
    <div className="es-pila">
      <div className="es-det-bar">
        <label className="es-campo es-campo-fila"><span className="es-cl">Versión</span>
          <select className="input" value={version} onChange={e => setVersion(Number(e.target.value))}>
            {[...mod.versiones].reverse().map(v => <option key={v.version} value={v.version}>v{v.version} · {ESTADO_V[v.estado].label} · {v.modelo.etiqueta}</option>)}
          </select>
        </label>
        <Seg value={modo} onChange={setModo} label="Cómo predecir" options={[
          { value: 'instante', label: 'al instante' }, { value: 'lote', label: 'por lotes (Spark en YARN)' },
        ]} />
        {x.estado !== 'produccion' && <span className="muted">Probando una versión que no está en producción.</span>}
      </div>
      {modo === 'instante' ? <AlInstante mod={mod} x={x} /> : <PorLotes cat={cat} mod={mod} x={x} onLote={onLote} />}
    </div>
  );
}

function AlInstante({ mod, x }: { mod: MlModeloBiblioteca; x: MlVersion }) {
  const entrada = x.entrada ?? [];
  const [fila, setFila] = useState<Record<string, string>>({});
  const [json, setJson] = useState('');
  const [res, setRes] = useState<(MlPrediccion & { version: number }) | null>(null);
  const [cargando, setCargando] = useState(false);
  const numerica = (c: MlColumnaEntrada) => c.rol === 'numerica' || ['double', 'float', 'int', 'bigint', 'long'].includes((c.tipo ?? '').split('(')[0]);
  const convertir = (c: MlColumnaEntrada, v: string): MlValor => (numerica(c) ? (v.trim() === '' ? null : Number(v.replace(',', '.'))) : v === '' ? null : v);
  async function predecir(filas: Record<string, unknown>[]) {
    setCargando(true);
    try { setRes(await api().mlLibraryPredict(mod.nombre, { filas, version: x.version })); }
    catch (e) { toast({ kind: 'bad', title: 'No se pudo predecir', description: errorTexto(e) }); }
    finally { setCargando(false); }
  }
  function desdeJson() {
    try {
      const v = JSON.parse(json);
      const filas = Array.isArray(v) ? v : [v];
      if (!filas.length || !filas.every(f => f && typeof f === 'object' && !Array.isArray(f))) throw new Error('una fila es un objeto {columna: valor}');
      predecir(filas);
    } catch (e) { toast({ kind: 'bad', title: 'El JSON no es válido', description: errorTexto(e) }); }
  }
  return (
    <div className="es-graf-grid">
      <Panel title="Una fila" sub={`v${x.version} · ${x.modelo.etiqueta}`}>
        {entrada.length ? (
          <div className="es-pred-form">
            {entrada.map(c => (
              <label key={c.columna} className="es-campo"><span className="es-cl"><span className="mono">{c.columna}</span><span className="muted">{numerica(c) ? 'número' : c.rol}</span></span>
                <input className="input mono" value={fila[c.columna] ?? ''} onChange={e => setFila(f => ({ ...f, [c.columna]: e.target.value }))} inputMode={numerica(c) ? 'decimal' : undefined} /></label>
            ))}
          </div>
        ) : <p className="es-nota">Esta versión no guardó su esquema de entrada: usá el JSON.</p>}
        <button type="button" className="btn btn-primary" disabled={cargando || !entrada.length} onClick={() => predecir([Object.fromEntries(entrada.map(c => [c.columna, convertir(c, fila[c.columna] ?? '')]))])}>
          <Play size={13} aria-hidden="true" />{cargando ? 'Prediciendo…' : 'Predecir'}
        </button>
      </Panel>
      <Panel title="Varias filas en JSON" sub="lo mismo que POST /predecir del paquete exportado">
        <div className="es-form">
          <textarea className="input mono es-json" rows={7} value={json} onChange={e => setJson(e.target.value)} aria-label="Filas en JSON"
            placeholder={JSON.stringify([Object.fromEntries(entrada.slice(0, 4).map(c => [c.columna, numerica(c) ? 0 : 'valor']))], null, 1)} />
          <button type="button" className="btn" disabled={cargando || !json.trim()} onClick={desdeJson}>Predecir el JSON</button>
          <p className="es-nota">{x.motor === 'spark' ? 'Con Spark arranca una sesión local en el servidor: tarda unos segundos la primera vez.' : 'Corre con el Pipeline de scikit-learn guardado (joblib).'} Hasta 1.000 filas.</p>
        </div>
      </Panel>
      {res && (
        <Panel title="Predicciones" sub={`${res.filas.toLocaleString('es-AR')} fila${res.filas === 1 ? '' : 's'} con v${res.version}`} flush>
          <ResultTable columns={res.columnas} rows={res.muestra} total={res.filas} label="Predicciones" fileName={`${mod.nombre}-v${res.version}-predicciones`} maxHeight={320} />
        </Panel>
      )}
    </div>
  );
}

const FORMATOS_ENTRADA = ['parquet', 'orc', 'csv', 'json', 'avro'] as const;

function PorLotes({ cat, mod, x, onLote }: { cat: MlCatalogo; mod: MlModeloBiblioteca; x: MlVersion; onLote: () => void }) {
  const ultimo = mod.lotes[0];
  const [origen, setOrigen] = useState<'hdfs' | 'hive'>(ultimo?.datos.origen === 'hive' ? 'hive' : 'hdfs');
  const [ruta, setRuta] = useState(ultimo?.datos.origen !== 'hive' ? ultimo?.datos.ruta ?? '' : '');
  const [formato, setFormato] = useState<string>(ultimo?.datos.formato ?? 'parquet');
  const [tabla, setTabla] = useState(ultimo?.datos.origen === 'hive' ? ultimo.datos.tabla ?? '' : '');
  const [destino, setDestino] = useState<'hdfs' | 'hive'>('hdfs');
  const [rutaSal, setRutaSal] = useState(`/user/root/ml/predicciones/${mod.nombre}-v${x.version}`);
  const [formatoSal, setFormatoSal] = useState<'parquet' | 'orc' | 'csv' | 'json'>('parquet');
  const [tablaSal, setTablaSal] = useState(`default.pred_${mod.nombre.replace(/-/g, '_')}_v${x.version}`);
  const [modo, setModo] = useState<'overwrite' | 'append' | 'error'>('overwrite');
  const [executors, setExecutors] = useState(cat.recursos.executors.defecto);
  const [memoria, setMemoria] = useState(cat.recursos.memoria_executor_mb.defecto);
  const [codigo, setCodigo] = useState<{ codigo: string; comando: string } | null>(null);
  const [run, setRun] = useState<string | null>(null);
  const { corrida, lineas } = useCorrida(run);
  const pedido = (): MlPedidoLote => ({
    version: x.version,
    datos: (origen === 'hive' ? { origen: 'hive', tabla } : { origen: 'hdfs', ruta, formato }) as MlDatos,
    salida: destino === 'hive' ? { tipo: 'hive', tabla: tablaSal, modo } : { tipo: 'hdfs', ruta: rutaSal, formato: formatoSal, modo },
    recursos: { executors, memoria_executor_mb: memoria },
  });
  const listo = origen === 'hive' ? /^[\w]+(\.[\w]+)?$/.test(tabla) : ruta.startsWith('/');
  async function verCodigo() {
    try { setCodigo(await api().mlLibraryBatchCode(mod.nombre, pedido())); }
    catch (e) { toast({ kind: 'bad', title: 'No se pudo armar el código', description: errorTexto(e) }); }
  }
  async function correr() {
    try { const r = await api().mlLibraryBatch(mod.nombre, pedido()); setRun(r.run); }
    catch (e) { toast({ kind: 'bad', title: 'No se pudo lanzar el lote', description: errorTexto(e) }); }
  }
  const termino = corrida && corrida.estado !== 'corriendo';
  const resumen = corrida?.resultado;
  return (
    <div className="es-pila">
      <div className="es-graf-grid">
        <Panel title="Datos nuevos" sub="en HDFS (cualquier formato) o una tabla de Hive">
          <div className="es-form">
            <Seg value={origen} onChange={setOrigen} label="Origen de los datos nuevos" options={[{ value: 'hdfs', label: 'HDFS' }, { value: 'hive', label: 'Hive' }]} />
            {origen === 'hdfs' ? (
              <div className="es-form-fila">
                <label className="es-campo" data-ancho="full"><span className="es-cl">Ruta en HDFS</span><input className="input mono" placeholder="/user/root/ml/nuevos" value={ruta} onChange={e => setRuta(e.target.value)} /></label>
                <label className="es-campo"><span className="es-cl">Formato</span>
                  <select className="input" value={formato} onChange={e => setFormato(e.target.value)}>{FORMATOS_ENTRADA.map(f => <option key={f}>{f}</option>)}</select></label>
              </div>
            ) : (
              <label className="es-campo"><span className="es-cl">Tabla</span><input className="input mono" placeholder="ventas.clientes_nuevos" value={tabla} onChange={e => setTabla(e.target.value)} /></label>
            )}
            <p className="es-nota">Tienen que traer las columnas de <b>lo que espera</b> la versión, crudas (la limpieza va adentro del modelo). Las que sobran pasan tal cual a la salida.</p>
          </div>
        </Panel>
        <Panel title="Predicciones" sub="las columnas de entrada más la predicción">
          <div className="es-form">
            <Seg value={destino} onChange={setDestino} label="Adónde van las predicciones" options={[{ value: 'hdfs', label: 'carpeta en HDFS' }, { value: 'hive', label: 'tabla de Hive' }]} />
            {destino === 'hdfs' ? (
              <div className="es-form-fila">
                <label className="es-campo" data-ancho="full"><span className="es-cl">Carpeta</span><input className="input mono" value={rutaSal} onChange={e => setRutaSal(e.target.value)} /></label>
                <label className="es-campo"><span className="es-cl">Formato</span>
                  <select className="input" value={formatoSal} onChange={e => setFormatoSal(e.target.value as typeof formatoSal)}>{['parquet', 'orc', 'csv', 'json'].map(f => <option key={f}>{f}</option>)}</select></label>
              </div>
            ) : (
              <label className="es-campo"><span className="es-cl">Tabla</span><input className="input mono" value={tablaSal} onChange={e => setTablaSal(e.target.value)} /></label>
            )}
            <div className="es-form-fila">
              <label className="es-campo"><span className="es-cl">Si ya existe</span>
                <select className="input" value={modo} onChange={e => setModo(e.target.value as typeof modo)}>
                  <option value="overwrite">reemplazar</option><option value="append">agregar</option><option value="error">fallar</option>
                </select></label>
              <label className="es-campo"><span className="es-cl">Executors</span><input className="input mono" type="number" min={1} max={64} value={executors} onChange={e => setExecutors(Number(e.target.value) || 1)} /></label>
              <label className="es-campo"><span className="es-cl">MB por executor</span><input className="input mono" type="number" min={512} max={16384} step={256} value={memoria} onChange={e => setMemoria(Number(e.target.value) || 1024)} /></label>
            </div>
          </div>
        </Panel>
      </div>
      <div className="es-det-bar">
        <button type="button" className="btn" disabled={!listo} onClick={verCodigo}><Code2 size={13} aria-hidden="true" />Ver el PySpark</button>
        <button type="button" className="btn btn-primary" disabled={!listo || corrida?.estado === 'corriendo'} onClick={correr}><Play size={13} aria-hidden="true" />Predecir en YARN</button>
        {x.motor === 'sklearn' && <span className="muted">El modelo de scikit-learn viaja a cada executor y predice con mapInPandas.</span>}
      </div>
      {codigo && (
        <Panel title="El script del lote" sub={<span className="mono">{codigo.comando}</span>} flush>
          <Suspense fallback={<div className="es-pad"><SkeletonLines n={10} /></div>}><Editor value={codigo.codigo} readOnly label="Código del lote" alto="min(60vh, 560px)" /></Suspense>
        </Panel>
      )}
      {corrida && (
        <Panel title={corrida.estado === 'corriendo' ? `Prediciendo… ${Math.round(corrida.progreso * 100)} %` : corrida.estado === 'listo' ? 'Lote terminado' : 'El lote falló'}
          sub={corrida.mensaje} flush end={corrida.appId ? <span className="mono muted">{corrida.appId}</span> : undefined}>
          {corrida.estado === 'falló' && <div className="es-pad"><EmptyState compact kind="error" title={corrida.error ?? 'falló'}>{corrida.errorDetalle}</EmptyState></div>}
          <div className="es-pad"><Consola lineas={lineas} alto={termino ? 160 : 240} /></div>
        </Panel>
      )}
      {termino && resumen && <ResumenLote cat={cat} lote={{ id: corrida.lote ?? '', modelo: mod.nombre, version: x.version, datos: pedido().datos, salida: resumen.salida, estado: 'listo', creado: '', resumen }} onVolver={() => { setRun(null); onLote(); }} volverLabel="Listo" />}
    </div>
  );
}

/* ---------------------------------------------------------------- el resumen de un lote y la deriva */

function ResumenLote({ cat, lote, onVolver, volverLabel = 'Lotes' }: { cat: MlCatalogo; lote: MlLote; onVolver: () => void; volverLabel?: string }) {
  void cat;
  const r = lote.resumen;
  return (
    <div className="es-pila">
      <div className="es-det-bar">
        <button type="button" className="btn btn-sm btn-ghost" onClick={onVolver}><ArrowLeft size={13} aria-hidden="true" />{volverLabel}</button>
        <span className="mono muted">{lote.id}</span>
      </div>
      {!r ? <Panel title="Lote"><EmptyState compact kind={lote.estado === 'falló' ? 'error' : 'empty'} title={lote.error ?? 'Sin resumen'}>{lote.error_detalle}</EmptyState></Panel> : (
        <>
          <Panel title={`v${r.version} sobre ${lote.entrada ?? (lote.datos.ruta ?? lote.datos.tabla)}`} sub={`→ ${r.destino}`}>
            <StatRow label="Resumen del lote">
              <Stat label="predicciones" value={r.filas.toLocaleString('es-AR')} sub={`${r.nuevas.join(', ')}`} />
              <Stat label="deriva" value={r.deriva?.nivel ?? '—'} k={r.deriva?.nivel ? NIVEL[r.deriva.nivel] : undefined} sub={r.deriva?.psi_max != null ? `PSI máximo ${r.deriva.psi_max.toFixed(3).replace('.', ',')}` : 'sin referencia del entrenamiento'} />
              <Stat label="tiempo" value={fmtSeg(r.tiempo)} sub={r.motor === 'spark' ? 'PipelineModel de Spark' : 'scikit-learn con mapInPandas'} />
              {lote.memoria_yarn_mb != null && <Stat label="YARN" value={fmtMb(lote.memoria_yarn_mb)} sub="en promedio en los contenedores" />}
            </StatRow>
            {r.conteo && <p className="es-nota">Predicho: {Object.entries(r.conteo).map(([k, v]) => `${k} ${v.toLocaleString('es-AR')}`).join(' · ')}</p>}
          </Panel>
          {(r.avisos.length > 0 || r.esquema.convertidas.length > 0 || r.esquema.sobran.length > 0) && (
            <Panel title="Esquema" sub="los datos nuevos contra lo que espera el modelo">
              <ul className="es-lista">
                {r.esquema.convertidas.map(c => <li key={c.columna}><span className="mono">{c.columna}</span> llegó como <span className="mono">{c.de}</span> y se convirtió a <span className="mono">{c.a}</span>{c.no_convertidos ? <b> · {c.no_convertidos.toLocaleString('es-AR')} valores no se pudieron convertir (quedan nulos)</b> : ' sin pérdidas'}</li>)}
                {r.esquema.sobran.length > 0 && <li>No las usa el modelo (pasan a la salida): <span className="mono">{r.esquema.sobran.join(', ')}</span></li>}
                {r.avisos.filter(a => !r.esquema.convertidas.some(c => a.startsWith(c.columna))).map(a => <li key={a}>{a}</li>)}
              </ul>
            </Panel>
          )}
          {r.deriva && <Deriva d={r.deriva} />}
          <Panel title="Muestra" sub={`las primeras ${r.muestra.length} filas de lo escrito`} flush>
            <ResultTable columns={r.columnas} rows={r.muestra} total={r.filas} label="Predicciones" fileName={`${r.modelo}-v${r.version}-lote`} maxHeight={320} />
          </Panel>
        </>
      )}
    </div>
  );
}

const PSI_MAX = 0.5;

function Deriva({ d }: { d: MlDeriva }) {
  const [abierta, setAbierta] = useState<string | null>(d.columnas[0]?.psi != null && d.columnas[0].psi >= 0.1 ? d.columnas[0].columna : null);
  return (
    <Panel title="Deriva contra el entrenamiento" sub={d.explicacion} flush>
      <div className="tbl-wrap">
        <table className="tbl es-deriva" aria-label="Deriva por variable">
          <thead><tr><th>variable</th><th>PSI</th><th className="r">valor</th><th>nivel</th></tr></thead>
          <tbody>
            {d.columnas.map(c => (
              <FilaDeriva key={c.columna} c={c} abierta={abierta === c.columna} onClick={() => setAbierta(a => (a === c.columna ? null : c.columna))} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="es-pad"><p className="es-nota">El PSI compara qué proporción de filas cae en cada tramo (deciles del entrenamiento, o sus categorías más comunes). Tocá una variable para ver los tramos. Una deriva fuerte no rompe el modelo, pero sus métricas de prueba dejan de valer: conviene reentrenar con datos recientes.</p></div>
    </Panel>
  );
}

function FilaDeriva({ c, abierta, onClick }: { c: MlDerivaColumna; abierta: boolean; onClick: () => void }) {
  const ancho = c.psi == null ? 0 : Math.min(1, c.psi / PSI_MAX) * 100;
  return (
    <>
      <tr className="es-lbf" onClick={onClick} aria-expanded={abierta}>
        <td><span className="mono">{c.columna}</span> <span className="muted">{c.tipo === 'numerica' ? 'número' : 'categoría'}</span></td>
        <td className="es-psi-c">
          <div className="es-psi" aria-hidden="true">
            <b style={{ width: `${ancho}%` }} data-k={c.nivel ? NIVEL[c.nivel] : 'bad'} />
            <i style={{ left: `${(0.1 / PSI_MAX) * 100}%` }} /><i style={{ left: `${(0.25 / PSI_MAX) * 100}%` }} />
          </div>
        </td>
        <td className="r mono">{c.psi == null ? '—' : c.psi.toFixed(3).replace('.', ',')}</td>
        <td>{c.psi == null ? <span className="badge" data-k="bad">falta</span> : <span className="badge" data-k={NIVEL[c.nivel ?? 'fuerte']}>{c.nivel}</span>}</td>
      </tr>
      {abierta && c.nuevo && (
        <tr className="es-deriva-det"><td colSpan={4}><Tramos c={c} /></td></tr>
      )}
    </>
  );
}

function Tramos({ c }: { c: MlDerivaColumna }) {
  const max = useMemo(() => Math.max(...c.referencia, ...(c.nuevo ?? []), 0.01), [c]);
  return (
    <div className="es-tramos" role="table" aria-label={`Tramos de ${c.columna}`}>
      <div className="es-tramo es-tramo-h" role="row"><span role="columnheader">tramo</span><span role="columnheader">entrenamiento</span><span role="columnheader">datos nuevos</span></div>
      {c.etiquetas.map((e, i) => (
        <div key={e} className="es-tramo" role="row">
          <span role="cell" className="mono">{e}</span>
          <span role="cell" className="es-tramo-b"><b data-ref style={{ width: `${(c.referencia[i] / max) * 100}%` }} /><small>{(c.referencia[i] * 100).toFixed(1)} %</small></span>
          <span role="cell" className="es-tramo-b"><b style={{ width: `${((c.nuevo?.[i] ?? 0) / max) * 100}%` }} /><small>{((c.nuevo?.[i] ?? 0) * 100).toFixed(1)} %</small></span>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- guardar un experimento */

/** El botón "Guardar en la biblioteca" del detalle de un experimento: elige el modelo (uno que predice lo mismo, o uno nuevo) */
export function GuardarEnBiblioteca({ exp }: { exp: { id: string; tarea: string | null; objetivo?: string | null; nombre?: string | null } }) {
  const lista = useApi(a => a.mlLibrary(), []);
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState('');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const compatibles = (lista.data ?? []).filter(m => m.tarea === exp.tarea && (m.objetivo ?? null) === (exp.objetivo ?? null));
  const sugerido = compatibles[0]?.nombre ?? (exp.objetivo ?? exp.tarea ?? 'modelo').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const valido = /^[a-z0-9][a-z0-9_-]{0,47}$/.test(nombre);
  async function guardar() {
    setGuardando(true);
    try {
      const m = await api().mlLibraryRegister({ nombre, experimento: exp.id, nota });
      const v = m.versiones[m.versiones.length - 1];
      toast({ kind: 'ok', title: `Guardado como ${nombre} v${v.version}`, description: 'Queda como candidato: promovelo cuando quieras que sea el que se usa.' });
      setAbierto(false);
      navigate('ml', `biblioteca/${encodeURIComponent(nombre)}`);
    } catch (e) { toast({ kind: 'bad', title: 'No se pudo guardar', description: errorTexto(e) }); }
    finally { setGuardando(false); }
  }
  if (!abierto) {
    return <button type="button" className="btn btn-sm btn-primary" onClick={() => { setNombre(sugerido); setAbierto(true); }}><Library size={13} aria-hidden="true" />Guardar en la biblioteca</button>;
  }
  return (
    <div className="es-guardar" role="group" aria-label="Guardar en la biblioteca">
      <label className="es-campo"><span className="es-cl">Modelo</span>
        <input className="input mono" list="es-modelos-bib" value={nombre} onChange={e => setNombre(e.target.value.toLowerCase())} aria-invalid={!valido} />
        <datalist id="es-modelos-bib">{compatibles.map(m => <option key={m.nombre} value={m.nombre}>{`${m.versiones} versiones`}</option>)}</datalist>
      </label>
      <label className="es-campo es-guardar-nota"><span className="es-cl">Nota</span><input className="input" value={nota} maxLength={500} placeholder="por qué esta versión" onChange={e => setNota(e.target.value)} /></label>
      <button type="button" className="btn btn-sm btn-primary" disabled={!valido || guardando} onClick={guardar}>{guardando ? 'Guardando…' : 'Guardar'}</button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAbierto(false)}>Cancelar</button>
      <span className="muted">{compatibles.some(m => m.nombre === nombre) ? 'versión nueva de un modelo que ya existe' : 'modelo nuevo (minúsculas, números, - y _)'}</span>
    </div>
  );
}

