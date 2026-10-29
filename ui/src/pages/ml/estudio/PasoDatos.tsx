/* Paso 1, Datos: elegir lo que haya en /datos, en HDFS (Parquet, ORC, Avro, JSON, CSV o texto, comprimido o
   en carpetas particionadas anio=/mes=) o una tabla de Hive, decir cómo leerlo y ver su perfil: con pandas
   (lo chico, en una máquina) o con Spark en YARN (a escala, sobre una muestra o la pasada completa). El esquema
   que infiere Spark se puede editar: cada tipo cambiado se aplica con un cast al leer. */
import { useMemo, useState } from 'react';
import { Database, FileArchive, FileSpreadsheet, FolderTree, RefreshCw, Sparkles, Wand2 } from 'lucide-react';
import { api } from '../../../api';
import type { MlCatalogo, MlColumnaPerfil, MlDatos, MlFormato, MlFuente, MlParticiones, MlPerfil } from '../../../api/types';
import { EmptyState, Panel, ResultTable, SkeletonLines, Stat, StatRow } from '../../../components/base';
import { Seg, Switch } from '../../../components/ui';
import { toast } from '../../../state/ui';
import { useApi } from '../../../state/useApi';
import { Campo, Numero, olvidarPerfiles, pedirPerfil, usePerfil } from './comun';
import { editar, fmtBytes, recetaParaDatos, ROL_LABEL, setEstudio, useEstudio, type PerfilOpciones } from './estado';
import { MiniHist, fnum } from './graficos';

type Origen = 'local' | 'hdfs' | 'hive';

const mismo = (a: MlDatos, b: MlDatos) => a.origen === b.origen && (a.ruta ?? a.tabla) === (b.ruta ?? b.tabla);
const SEP: Record<string, string> = { ',': 'coma', ';': 'punto y coma', '\t': 'tabulación', '|': 'barra' };
const pct = (v: number) => `${(v * 100).toFixed(1).replace('.', ',')} %`;

/** Lo que dice la lista de fuentes de un archivo o carpeta: formato, compresión, partes y particiones */
function meta(f: MlFuente, cat: MlCatalogo | undefined): string {
  if (f.origen === 'hive') return f.filas != null ? `${fnum(f.filas)} filas` : `${f.columnas?.length ?? 0} columnas`;
  const fmt = f.formato === 'csv' && f.separador === '\t' ? 'TSV' : cat?.formatos[f.formato as MlFormato]?.etiqueta ?? f.formato;
  return [fmt, f.compresion && f.compresion !== 'interna' ? f.compresion : null, f.partes ? `${f.partes} partes` : null,
    f.particiones ? `${f.particiones.n} particiones` : null, fmtBytes(f.bytes)].filter(Boolean).join(' · ');
}

export function PasoDatos({ cat }: { cat?: MlCatalogo }) {
  const { receta, perfil: op } = useEstudio();
  const [origen, setOrigen] = useState<Origen>(receta.datos.origen);
  const [filtro, setFiltro] = useState('');
  const fuentes = useApi(a => a.mlSources(), [], e => e.type === 'hdfs');
  const perfil = usePerfil(receta.datos, receta.objetivo);
  const [generando, setGenerando] = useState<string | null>(null);

  const lista = useMemo(() => {
    const l = fuentes.data?.[origen] ?? [];
    const f = filtro.trim().toLowerCase();
    return f ? l.filter(x => x.nombre.toLowerCase().includes(f)) : l;
  }, [fuentes.data, origen, filtro]);

  async function elegir(f: MlFuente | MlDatos) {
    const datos: MlDatos = f.origen === 'hive' ? { origen: 'hive', tabla: f.tabla }
      : { origen: f.origen, ruta: f.ruta, formato: f.formato, ...(f.separador ? { separador: f.separador } : {}),
          ...(f.multilinea ? { multilinea: true } : {}) };
    editar(r => ({ ...r, datos: { ...datos, limite: r.datos.limite ?? null } }));
    try {
      const p = await pedirPerfil(datos, null);
      editar(r => (mismo(r.datos, datos) ? recetaParaDatos({ ...r, objetivo: p.columnas.some(c => c.nombre === r.objetivo) ? r.objetivo : null }, p) : r));
    } catch { /* el error se ve en el panel del perfil */ }
  }

  async function generar(ejemplo: 'senal' | 'sucias') {
    setGenerando(ejemplo);
    try {
      const d = await api().mlExample(ejemplo);
      olvidarPerfiles();
      fuentes.reload();
      setOrigen('local');
      await elegir({ ...d, nombre: d.ruta ?? '' });
      toast({ kind: 'ok', title: `Listo: ${d.ruta}` });
    } catch (e) {
      toast({ kind: 'bad', title: 'No se pudo generar el ejemplo', description: e instanceof Error ? e.message : String(e) });
    } finally { setGenerando(null); }
  }

  const sel = receta.datos;
  const hayEjemplo = (n: string) => fuentes.data?.local.some(f => f.ruta?.endsWith('/' + n));
  const fuenteSel = fuentes.data?.[sel.origen]?.find(f => mismo(f, sel));
  const particiones = perfil.data?.fuente?.particiones ?? fuenteSel?.particiones;
  const setDatos = (d: Partial<MlDatos>) => editar(r => ({ ...r, datos: { ...r.datos, ...d } }));

  return (
    <div className="es-paso es-datos">
      <Panel title="Fuentes" sub="/datos, HDFS en cualquier formato y tablas de Hive" flush
        end={<button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={() => { olvidarPerfiles(); fuentes.reload(); }} aria-label="Volver a leer las fuentes"><RefreshCw size={14} /></button>}>
        <div className="es-fbar">
          <Seg value={origen} onChange={setOrigen} label="Origen de los datos" options={[
            { value: 'local', label: `/datos${fuentes.data ? ` · ${fuentes.data.local.length}` : ''}` },
            { value: 'hdfs', label: `HDFS${fuentes.data ? ` · ${fuentes.data.hdfs.length}` : ''}` },
            { value: 'hive', label: `Hive${fuentes.data ? ` · ${fuentes.data.hive.length}` : ''}` },
          ]} />
          <input className="input es-buscar" placeholder="Filtrar" value={filtro} onChange={e => setFiltro(e.target.value)} aria-label="Filtrar fuentes" />
        </div>
        {fuentes.error ? <div className="es-pad"><EmptyState compact kind="error" title="No se pudieron leer las fuentes">{fuentes.error}</EmptyState></div>
          : !fuentes.data ? <div className="es-pad"><SkeletonLines n={5} /></div>
          : (
            <ul className="es-fuentes" aria-label="Fuentes de datos">
              {lista.map(f => (
                <li key={f.origen + (f.ruta ?? f.tabla)}>
                  <button type="button" aria-current={mismo(f, sel) || undefined} onClick={() => elegir(f)}>
                    {f.origen === 'hive' ? <Database size={14} aria-hidden="true" /> : f.partes || f.particiones ? <FolderTree size={14} aria-hidden="true" />
                      : f.compresion && f.compresion !== 'interna' ? <FileArchive size={14} aria-hidden="true" /> : <FileSpreadsheet size={14} aria-hidden="true" />}
                    <span className="mono es-fn">{f.nombre}</span>
                    <span className="muted es-fm">{meta(f, cat)}</span>
                  </button>
                </li>
              ))}
              {!lista.length && <li className="es-pad muted">{filtro ? 'Nada coincide con el filtro.' : origen === 'local' ? 'No hay archivos de datos en /datos.' : fuentes.data.avisos.find(a => a.toLowerCase().includes(origen === 'hdfs' ? 'hdfs' : 'hive')) ?? 'No hay nada acá todavía.'}</li>}
            </ul>
          )}
        <div className="es-ejemplos">
          <span className="muted">Ejemplos para practicar</span>
          <button type="button" className="btn btn-sm" disabled={!!generando} onClick={() => generar('senal')}>
            <Sparkles size={13} aria-hidden="true" />{generando === 'senal' ? 'Generando…' : hayEjemplo('clientes_senal.csv') ? 'Regenerar clientes_senal.csv' : 'Generar clientes_senal.csv'}
          </button>
          <button type="button" className="btn btn-sm" disabled={!!generando} onClick={() => generar('sucias')}>
            <Sparkles size={13} aria-hidden="true" />{generando === 'sucias' ? 'Generando…' : 'Generar ventas_sucias.csv'}
          </button>
        </div>
      </Panel>

      <div className="es-col">
        <Panel title={<span className="mono">{sel.ruta ?? sel.tabla}</span>} sub={sel.origen === 'hive' ? 'tabla de Hive' : sel.origen === 'hdfs' ? 'HDFS' : 'disco del contenedor'}>
          <div className="es-form es-form-fila">
            {sel.origen !== 'hive' && (
              <Campo label="Formato" nombre="spark.read" ayuda={cat?.formatos[sel.formato ?? 'csv']?.ayuda}>
                <select className="input" value={sel.formato ?? 'csv'} aria-label="Formato"
                  onChange={e => setDatos({ formato: e.target.value as MlFormato, multilinea: undefined, encabezado: undefined, inferir: undefined })}>
                  {Object.entries(cat?.formatos ?? { csv: { etiqueta: 'CSV / TSV' }, parquet: { etiqueta: 'Parquet' } }).map(([k, f]) => <option key={k} value={k}>{f.etiqueta}</option>)}
                </select>
              </Campo>
            )}
            {sel.origen !== 'hive' && (sel.formato ?? 'csv') === 'csv' && <>
              <Campo label="Separador" nombre="sep" ayuda="El carácter que separa las columnas.">
                <select className="input" value={sel.separador ?? ','} onChange={e => setDatos({ separador: e.target.value })} aria-label="Separador">
                  {Object.entries(SEP).map(([v, e]) => <option key={v} value={v}>{e} {v === '\t' ? '' : v}</option>)}
                </select>
              </Campo>
              <Campo label="Encabezado" nombre="header" ayuda="Si la primera fila tiene los nombres de las columnas. Sin encabezado se llaman _c0, _c1…">
                <Switch checked={sel.encabezado !== false} onChange={v => setDatos({ encabezado: v ? undefined : false })} label="La primera fila es el encabezado" />
              </Campo>
              <Campo label="Inferir tipos" nombre="inferSchema" ayuda="Spark lee los datos una vez más para adivinar qué columnas son números o fechas. Apagado, todo es texto (y lo convertís en el esquema o en la limpieza).">
                <Switch checked={sel.inferir !== false} onChange={v => setDatos({ inferir: v ? undefined : false })} label="Inferir los tipos" />
              </Campo>
            </>}
            {sel.origen !== 'hive' && sel.formato === 'json' && (
              <Campo label="Multilínea" nombre="multiLine" ayuda="Apagado: un objeto JSON por línea (JSON lines, lo que escribe Spark). Prendido: un documento entero, o un array de objetos.">
                <Switch checked={!!sel.multilinea} onChange={v => setDatos({ multilinea: v || undefined })} label="Un documento entero" />
              </Campo>
            )}
            {particiones && (
              <Campo label="Filtro de particiones" nombre="filter" ayuda={`Una condición sobre ${particiones.columnas.join(', ')}: Spark ni abre las carpetas que no la cumplen (partition pruning).`}
                nota={sel.filtro_particiones ? 'solo esas particiones' : `las ${particiones.n}`}>
                <input className="input mono" style={{ width: 260 }} placeholder={`${particiones.columnas[0]} = …`} value={sel.filtro_particiones ?? ''}
                  onChange={e => setDatos({ filtro_particiones: e.target.value || null })} aria-label="Filtro de particiones" />
              </Campo>
            )}
            <Campo label="Límite de filas" nombre="limite" ayuda="Entrena con una muestra fija (con la semilla) de esta cantidad de filas. Vacío = todas. Sirve para probar rápido con datos grandes."
              nota={sel.limite ? 'muestra fija con la semilla' : 'todas las filas'}>
              <Numero value={sel.limite ?? null} nulo="todas" min={100} label="Límite de filas" ancho={140}
                onChange={v => setDatos({ limite: v == null ? null : Math.round(v) })} />
            </Campo>
          </div>
          <Fuente perfil={perfil.data ?? null} particiones={particiones} compresion={fuenteSel?.compresion ?? sel.compresion} />
        </Panel>
        <Perfil cat={cat} perfil={perfil.data ?? null} cargando={perfil.loading} error={perfil.error} detalle={perfil.detalle} op={op}
          datos={sel} onReintentar={() => { olvidarPerfiles(); perfil.reload(); }} />
      </div>
    </div>
  );
}

/** Lo que se sabe de lo que hay en disco: formato, compresión, archivos, tamaño y particiones */
function Fuente({ perfil, particiones, compresion }: { perfil: MlPerfil | null; particiones?: MlParticiones; compresion?: string | null }) {
  const f = perfil?.fuente;
  const comp = f?.compresion ?? compresion;
  if (!f && !particiones && !comp) return null;
  return (
    <dl className="kv es-fuente">
      {f?.ubicacion && <><dt>ubicación</dt><dd className="mono">{f.ubicacion}</dd></>}
      {f?.formato && <><dt>formato</dt><dd className="mono">{f.formato}</dd></>}
      {comp && <><dt>compresión</dt><dd>{comp}{comp.includes('gzip') && <span className="muted"> · un .gz no se puede partir: cada archivo lo lee una sola tarea</span>}</dd></>}
      {f?.archivos != null && <><dt>en disco</dt><dd className="mono">{fnum(f.archivos)} archivos · {fmtBytes(f.bytes)}{f.leidos != null && f.leidos !== f.archivos ? ` (${fnum(f.leidos)} leídos)` : ''}</dd></>}
      {particiones && <><dt>particiones</dt><dd><span className="mono">{particiones.columnas.join(' / ')}</span> · {fnum(particiones.n)} <span className="muted mono">({particiones.ejemplos.slice(0, 3).join(', ')}{particiones.n > 3 ? ', …' : ''})</span></dd></>}
      {f?.aviso && <><dt>aviso</dt><dd className="muted">{f.aviso}</dd></>}
    </dl>
  );
}

function Perfil({ cat, perfil, cargando, error, detalle, op, datos, onReintentar }: {
  cat?: MlCatalogo; perfil: MlPerfil | null; cargando: boolean; error: string | null; detalle: string | null; op: PerfilOpciones; datos: MlDatos;
  onReintentar: () => void;
}) {
  const [vista, setVista] = useState<'columnas' | 'esquema' | 'filas'>('columnas');
  const spark = op.motor === 'spark' || (op.motor === 'auto' && datos.origen !== 'local') || perfil?.motor === 'spark';
  const setOp = (o: Partial<PerfilOpciones>) => setEstudio(e => ({ ...e, perfil: { ...e.perfil, ...o } }));
  const controles = (
    <div className="es-perfil-op">
      <Seg value={op.motor} onChange={v => setOp({ motor: v })} label="Con qué se calcula el perfil" options={[
        { value: 'auto', label: 'auto', tip: 'pandas para lo chico de /datos (con la asociación de cada columna con el objetivo); Spark para HDFS y Hive' },
        { value: 'pandas', label: 'pandas', tip: 'Una máquina, hasta 200.000 filas: CSV y Parquet' },
        { value: 'spark', label: 'Spark', tip: 'spark-submit en YARN (local[2] para /datos): cualquier formato y tamaño' },
      ]} />
      {spark && <Seg value={op.modo} onChange={v => setOp({ modo: v })} label="Muestra o pasada completa" options={[
        { value: 'muestra', label: 'muestra', tip: 'Cuenta todo y perfila una muestra al azar (con semilla)' },
        { value: 'completo', label: 'completo', tip: 'Una pasada entera: exacto en nulos, mínimos y máximos; tarda más' },
      ]} />}
      {spark && op.modo === 'muestra' && <Numero value={op.filas} onChange={v => v != null && setOp({ filas: Math.round(v) })} min={1000} max={5000000} label="Filas de la muestra" ancho={110} />}
    </div>
  );
  const otraVez = <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={onReintentar} aria-label="Volver a calcular el perfil"><RefreshCw size={14} /></button>;
  if (error) {
    return (
      <Panel title="Perfil" end={otraVez}>
        <div className="es-perfil-barra">{controles}</div>
        <EmptyState compact kind="error" title={spark ? 'Spark no pudo leer los datos' : 'No se pudo leer'}
          actions={<button type="button" className="btn btn-sm" onClick={onReintentar}>Probar de nuevo</button>}>
          {error}
        </EmptyState>
        {detalle && <details className="es-detalle"><summary>Lo que dijo Spark</summary><pre className="mono">{detalle}</pre></details>}
      </Panel>
    );
  }
  if (!perfil) {
    return (
      <Panel title="Perfil" end={otraVez}>
        <div className="es-perfil-barra">{controles}</div>
        {cargando ? <><p className="muted es-nota">{spark
          ? `Calculando el perfil con Spark (spark-submit perfil_spark.py${datos.origen === 'local' ? ', local[2]' : ' en YARN'})${op.modo === 'muestra' ? `, sobre una muestra de hasta ${fnum(op.filas)} filas` : ', pasada completa'}. Arrancar los executors tarda unos segundos; lo ves en Actividad y en YARN.`
          : 'Leyendo y perfilando los datos (pandas)…'}</p><SkeletonLines n={6} /></>
          : <EmptyState compact title="Elegí una fuente">Al elegirla se calcula el perfil de cada columna.</EmptyState>}
      </Panel>
    );
  }
  const nulos = perfil.columnas.reduce((a, c) => a + c.nulos, 0);
  const total = perfil.filas_total ?? perfil.filas;
  const sub = perfil.motor === 'spark'
    ? `Spark${perfil.master ? ` (${perfil.master})` : ''} · ${perfil.segundos.toString().replace('.', ',')} s · ${perfil.recortado ? `muestra de ${fnum(perfil.filas)} filas` : 'todas las filas'}`
    : `pandas · ${perfil.segundos.toString().replace('.', ',')} s${perfil.recortado ? ' · primeras 200.000 filas' : ''}`;
  return (
    <Panel title="Perfil" sub={<>{sub}{perfil.app_id && <span className="mono muted"> · {perfil.app_id}</span>}</>} flush end={otraVez}>
      <div className="es-pad es-perfil-barra">{controles}</div>
      <div className="es-pad">
        <StatRow label="Resumen de los datos">
          <Stat label="filas" value={fnum(total)} sub={perfil.recortado ? `${fnum(perfil.filas)} perfiladas` : undefined} />
          <Stat label="columnas" value={perfil.columnas.length} />
          <Stat label="celdas vacías" value={fnum(nulos)} sub={pct(nulos / Math.max(1, perfil.filas * perfil.columnas.length))} k={nulos ? 'run' : undefined} />
          <Stat label="filas repetidas" value={perfil.duplicadas == null ? '—' : fnum(perfil.duplicadas)} k={perfil.duplicadas ? 'run' : undefined} />
          {perfil.fuente?.bytes != null
            ? <Stat label="en disco" value={fmtBytes(perfil.fuente.bytes)} sub={perfil.fuente.compresion ?? perfil.fuente.formato ?? undefined} />
            : <Stat label="en memoria" value={perfil.memoria_mb == null ? '—' : `${perfil.memoria_mb.toString().replace('.', ',')} MB`} sub="pandas" />}
        </StatRow>
        {perfil.sugerencias?.separador && perfil.sugerencias.separador !== (datos.separador ?? ',') && (
          <p className="es-sugerencia" role="status">
            <Wand2 size={13} aria-hidden="true" /> Las primeras líneas parecen separadas por <b>{SEP[perfil.sugerencias.separador]}</b>, no por {SEP[datos.separador ?? ',']}.
            <button type="button" className="btn btn-sm" onClick={() => editar(r => ({ ...r, datos: { ...r.datos, separador: perfil.sugerencias!.separador } }))}>Usar {SEP[perfil.sugerencias.separador]}</button>
          </p>
        )}
      </div>
      <div className="es-pad es-vista-sel">
        <Seg value={vista} onChange={setVista} label="Vista del perfil" options={[
          { value: 'columnas', label: 'columnas' }, { value: 'esquema', label: 'esquema' }, { value: 'filas', label: 'primeras filas' }]} />
      </div>
      {vista === 'filas'
        ? <ResultTable columns={perfil.vista.columnas} rows={perfil.vista.filas} total={total} label="Primeras filas" fileName="muestra" maxHeight={420} />
        : vista === 'esquema' ? <Esquema cat={cat} perfil={perfil} datos={datos} />
        : <TablaColumnas columnas={perfil.columnas} filas={perfil.filas} />}
    </Panel>
  );
}

/** El esquema que leyó Spark (o pandas), con el tipo de cada columna editable: se aplica con un cast al leer */
function Esquema({ cat, perfil, datos }: { cat?: MlCatalogo; perfil: MlPerfil; datos: MlDatos }) {
  const esq = datos.esquema ?? {};
  const tipos = cat?.tiposEsquema ?? ['string', 'int', 'bigint', 'double', 'boolean', 'date', 'timestamp'];
  const poner = (c: string, t: string) => editar(r => {
    const e = { ...(r.datos.esquema ?? {}) };
    if (t) e[c] = t; else delete e[c];
    return { ...r, datos: { ...r.datos, esquema: Object.keys(e).length ? e : undefined } };
  });
  return (
    <div className="tbl-wrap">
      <p className="es-pad es-nota">El tipo que se infirió al leer y el que querés que tenga. Lo que no se puede convertir queda vacío (miralo en la columna de vacías del perfil). Para texto con formato (como <span className="mono">$1.200,50</span> o <span className="mono">dd/MM/yyyy</span>), mejor un paso de la limpieza.</p>
      <table className="tbl es-esquema" aria-label="Esquema">
        <thead><tr><th>columna</th><th>leído como</th><th>tipo</th><th className="r">vacías</th><th>ejemplos</th></tr></thead>
        <tbody>
          {perfil.columnas.map(c => (
            <tr key={c.nombre} data-cambiado={esq[c.nombre] ? '' : undefined}>
              <td className="mono">{c.nombre}</td>
              <td className="mono muted">{c.dtype}</td>
              <td>
                <select className="input select-sm mono" value={esq[c.nombre] ?? ''} onChange={e => poner(c.nombre, e.target.value)} aria-label={`Tipo de ${c.nombre}`}>
                  <option value="">(como viene)</option>
                  {tipos.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </td>
              <td className="r mono" data-k={c.nulos ? 'run' : undefined}>{c.nulos ? pct(c.nulos_pct) : '—'}</td>
              <td className="mono muted es-resu">{c.ejemplos.map(String).join(' · ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TablaColumnas({ columnas, filas }: { columnas: MlColumnaPerfil[]; filas: number }) {
  const [abierta, setAbierta] = useState<string | null>(null);
  return (
    <div className="tbl-wrap">
      <table className="tbl es-cols" aria-label="Columnas">
        <thead><tr><th>columna</th><th>tipo</th><th>rol sugerido</th><th className="r">vacías</th><th className="r">distintos</th><th>distribución</th><th>resumen</th></tr></thead>
        <tbody>
          {columnas.map(c => (
            <FilaColumna key={c.nombre} c={c} filas={filas} abierta={abierta === c.nombre} onAbrir={() => setAbierta(a => (a === c.nombre ? null : c.nombre))} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FilaColumna({ c, filas, abierta, onAbrir }: { c: MlColumnaPerfil; filas: number; abierta: boolean; onAbrir: () => void }) {
  const resumen = c.num ? `${fnum(c.num.min)} a ${fnum(c.num.max)} · media ${fnum(c.num.media)}`
    : c.fecha ? `${c.fecha.min.slice(0, 10)} a ${c.fecha.max.slice(0, 10)}`
    : c.top?.length ? c.top.slice(0, 3).map(t => t.valor).join(', ') : '';
  return (
    <>
      <tr onClick={onAbrir} aria-expanded={abierta} className="es-fila-col">
        <td className="mono">{c.nombre}</td>
        <td className="mono muted">{c.tipo}</td>
        <td><span className="tag" title={c.por_que}>{ROL_LABEL[c.rol]}</span></td>
        <td className="r mono" data-k={c.nulos ? 'run' : undefined}>{c.nulos ? pct(c.nulos_pct) : '—'}</td>
        <td className="r mono" title={c.unicos_aprox ? 'aproximado (HyperLogLog, ±2 %)' : undefined}>{c.unicos_aprox ? '~' : ''}{fnum(c.unicos)}</td>
        <td>{c.histograma ? <MiniHist cuentas={c.histograma.cuentas} /> : c.top ? <MiniHist cuentas={c.top.slice(0, 10).map(t => t.n)} /> : null}</td>
        <td className="muted es-resu">{resumen}</td>
      </tr>
      {abierta && (
        <tr className="es-det-col"><td colSpan={7}>
          <div className="es-det-grid">
            <dl className="kv">
              <dt>dtype</dt><dd className="mono">{c.dtype}</dd>
              <dt>por qué ese rol</dt><dd>{c.por_que}</dd>
              <dt>ejemplos</dt><dd className="mono">{c.ejemplos.map(String).join(' · ')}</dd>
              {c.num && <><dt>cuartiles</dt><dd className="mono">{fnum(c.num.p25)} · {fnum(c.num.p50)} · {fnum(c.num.p75)}</dd>
                {c.num.p01 != null && <><dt>percentiles 1 · 5 · 95 · 99</dt><dd className="mono">{fnum(c.num.p01)} · {fnum(c.num.p05)} · {fnum(c.num.p95)} · {fnum(c.num.p99)}</dd></>}
                <dt>desvío</dt><dd className="mono">{fnum(c.num.desvio)}</dd>
                <dt>ceros</dt><dd className="mono">{fnum(c.num.ceros)}</dd>
                <dt>extremos (1,5·IQR)</dt><dd className="mono">{fnum(c.num.extremos)} ({pct(c.num.extremos / Math.max(1, filas))})</dd></>}
              {c.largo_medio != null && <><dt>largo medio</dt><dd className="mono">{c.largo_medio.toFixed(0)} caracteres</dd></>}
              {c.correlacion != null && <><dt>correlación con el objetivo</dt><dd className="mono">{c.correlacion.toFixed(3).replace('.', ',')}</dd></>}
            </dl>
            {c.top && (
              <ul className="es-top" aria-label={`Valores más comunes de ${c.nombre}`}>
                {c.top.map(t => <li key={t.valor}><span className="mono">{t.valor}</span><i style={{ width: `${(t.n / c.top![0].n) * 100}%` }} /><span className="mono muted">{fnum(t.n)}</span></li>)}
              </ul>
            )}
          </div>
        </td></tr>
      )}
    </>
  );
}
