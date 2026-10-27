/* Paso 1, Datos: elegir un CSV o Parquet de /datos o de HDFS, o una tabla de Hive, y ver su perfil
   (tipos, nulos, distintos, estadísticas y distribución de cada columna) y las primeras filas. */
import { useMemo, useState } from 'react';
import { Database, FileSpreadsheet, FolderTree, RefreshCw, Sparkles } from 'lucide-react';
import { api } from '../../../api';
import type { MlColumnaPerfil, MlDatos, MlFuente, MlPerfil } from '../../../api/types';
import { EmptyState, Panel, ResultTable, SkeletonLines, Stat, StatRow } from '../../../components/base';
import { Seg } from '../../../components/ui';
import { toast } from '../../../state/ui';
import { useApi } from '../../../state/useApi';
import { Campo, Numero, olvidarPerfiles, pedirPerfil, usePerfil } from './comun';
import { editar, recetaParaDatos, ROL_LABEL, useEstudio, fmtBytes } from './estado';
import { MiniHist, fnum } from './graficos';

type Origen = 'local' | 'hdfs' | 'hive';

const mismo = (a: MlDatos, b: MlDatos) => a.origen === b.origen && (a.ruta ?? a.tabla) === (b.ruta ?? b.tabla);

export function PasoDatos() {
  const { receta } = useEstudio();
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
    const datos: MlDatos = { origen: f.origen, ...(f.origen === 'hive' ? { tabla: f.tabla } : { ruta: f.ruta, formato: f.formato }) };
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

  return (
    <div className="es-paso es-datos">
      <Panel title="Fuentes" sub="CSV y Parquet de /datos y de HDFS, y tablas de Hive" flush
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
                    {f.origen === 'hive' ? <Database size={14} aria-hidden="true" /> : f.partes ? <FolderTree size={14} aria-hidden="true" /> : <FileSpreadsheet size={14} aria-hidden="true" />}
                    <span className="mono es-fn">{f.nombre}</span>
                    <span className="muted es-fm">{f.origen === 'hive' ? (f.filas != null ? `${fnum(f.filas)} filas` : `${f.columnas?.length ?? 0} columnas`) : `${f.formato}${f.partes ? ` · ${f.partes} partes` : ''} · ${fmtBytes(f.bytes)}`}</span>
                  </button>
                </li>
              ))}
              {!lista.length && <li className="es-pad muted">{filtro ? 'Nada coincide con el filtro.' : origen === 'local' ? 'No hay CSV ni Parquet en /datos.' : fuentes.data.avisos.find(a => a.toLowerCase().includes(origen === 'hdfs' ? 'hdfs' : 'hive')) ?? 'No hay nada acá todavía.'}</li>}
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
            {sel.origen !== 'hive' && sel.formato !== 'parquet' && (
              <Campo label="Separador" nombre="sep" ayuda="El carácter que separa las columnas del CSV.">
                <select className="input" value={sel.separador ?? ','} onChange={e => { olvidarPerfiles(); editar(r => ({ ...r, datos: { ...r.datos, separador: e.target.value } })); }}>
                  <option value=",">coma ,</option><option value=";">punto y coma ;</option><option value={'\t'}>tabulación</option><option value="|">barra |</option>
                </select>
              </Campo>
            )}
            <Campo label="Límite de filas" nombre="limite" ayuda="Entrena con una muestra fija (con la semilla) de esta cantidad de filas. Vacío = todas. Sirve para probar rápido con datos grandes."
              nota={sel.limite ? 'muestra fija con la semilla' : 'todas las filas'}>
              <Numero value={sel.limite ?? null} nulo="todas" min={100} label="Límite de filas" ancho={140}
                onChange={v => editar(r => ({ ...r, datos: { ...r.datos, limite: v == null ? null : Math.round(v) } }))} />
            </Campo>
          </div>
        </Panel>
        <Perfil perfil={perfil.data ?? null} cargando={perfil.loading} error={perfil.error} />
      </div>
    </div>
  );
}

function Perfil({ perfil, cargando, error }: { perfil: MlPerfil | null; cargando: boolean; error: string | null }) {
  const [vista, setVista] = useState<'columnas' | 'filas'>('columnas');
  if (error) return <Panel title="Perfil"><EmptyState compact kind="error" title="No se pudo leer">{error}</EmptyState></Panel>;
  if (!perfil) return <Panel title="Perfil">{cargando ? <><p className="muted es-nota">Leyendo y perfilando los datos (pandas)…</p><SkeletonLines n={6} /></> : <EmptyState compact title="Elegí una fuente">Al elegirla se calcula el perfil de cada columna.</EmptyState>}</Panel>;
  const nulos = perfil.columnas.reduce((a, c) => a + c.nulos, 0);
  return (
    <Panel title="Perfil" sub={`${perfil.segundos.toString().replace('.', ',')} s${perfil.recortado ? ' · primeras 200.000 filas' : ''}`} flush
      end={<Seg value={vista} onChange={setVista} label="Vista del perfil" options={[{ value: 'columnas', label: 'columnas' }, { value: 'filas', label: 'primeras filas' }]} />}>
      <div className="es-pad">
        <StatRow label="Resumen de los datos">
          <Stat label="filas" value={fnum(perfil.filas)} />
          <Stat label="columnas" value={perfil.columnas.length} />
          <Stat label="celdas vacías" value={fnum(nulos)} sub={`${((nulos / Math.max(1, perfil.filas * perfil.columnas.length)) * 100).toFixed(1).replace('.', ',')} %`} k={nulos ? 'run' : undefined} />
          <Stat label="filas repetidas" value={perfil.duplicadas == null ? '—' : fnum(perfil.duplicadas)} k={perfil.duplicadas ? 'run' : undefined} />
          <Stat label="en memoria" value={`${perfil.memoria_mb.toString().replace('.', ',')} MB`} sub="pandas" />
        </StatRow>
      </div>
      {vista === 'filas'
        ? <ResultTable columns={perfil.vista.columnas} rows={perfil.vista.filas} total={perfil.filas} label="Primeras filas" fileName="muestra" maxHeight={420} />
        : <TablaColumnas columnas={perfil.columnas} filas={perfil.filas} />}
    </Panel>
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
        <td className="r mono" data-k={c.nulos ? 'run' : undefined}>{c.nulos ? `${(c.nulos_pct * 100).toFixed(1).replace('.', ',')} %` : '—'}</td>
        <td className="r mono">{fnum(c.unicos)}</td>
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
                <dt>desvío</dt><dd className="mono">{fnum(c.num.desvio)}</dd>
                <dt>ceros</dt><dd className="mono">{fnum(c.num.ceros)}</dd>
                <dt>extremos (1,5·IQR)</dt><dd className="mono">{fnum(c.num.extremos)} ({((c.num.extremos / Math.max(1, filas)) * 100).toFixed(1).replace('.', ',')} %)</dd></>}
              {c.largo_medio != null && <><dt>largo medio</dt><dd className="mono">{c.largo_medio.toFixed(0)} caracteres</dd></>}
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
