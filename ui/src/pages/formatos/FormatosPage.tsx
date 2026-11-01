/* Formatos: la misma tabla de ventas en texto (CSV), Parquet y ORC. Arriba, por qué un formato por columnas
   lee menos; en el medio, las tres copias con lo que ocupan en HDFS y en cuántos bloques quedan; abajo, la
   misma consulta corrida en las tres. Todo lo que se mide sale de HDFS y de Hive, no de una tabla fija. */
import { useMemo, useState } from 'react';
import { ArrowRight, FolderOpen, Play, Plus } from 'lucide-react';
import { api } from '../../api';
import type { CatalogEntry, HdfsListing } from '../../api/types';
import { Codigo } from '../../components/Comando';
import { EmptyState, GatedButton, PageHeader } from '../../components/base';
import { Dot } from '../../components/ui';
import { COLUMNAS_USADAS, FORMATOS, MUESTRA, consulta, crearCopia, existentes, medir, type FormatoId, type Medida } from '../../lib/formatos';
import { duration, nf, sizeLabel } from '../../lib/format';
import { bytesLabel } from '../../lib/comparar';
import { runFix, useCapabilities } from '../../state/capabilities';
import { useStatus } from '../../state/store';
import { navigate, toast } from '../../state/ui';
import { useApi } from '../../state/useApi';
import './formatos.css';

interface Corrida { ms: number; appId?: string; scanned?: number; bytesRead?: number; error?: string }
/* Lo último que se corrió queda mientras la interfaz esté abierta, aunque se cambie de pantalla */
let guardadas: Partial<Record<FormatoId, Corrida>> = {};

/* ---------- Fila contra columna ---------- */

function Dibujo() {
  return (
    <section className="fm-dibujo" data-capa="datos" aria-label="Fila contra columna">
      <div className="fm-d-lado">
        <h3>En texto (CSV): por filas</h3>
        <div className="fm-filas mono" aria-hidden="true">
          {MUESTRA.filas.map(f => <span key={f.join()}>{f.join(',')}</span>)}
          <span className="fm-mas">… 200.000 líneas</span>
        </div>
        <p>Para sumar la cantidad hay que leer cada línea entera y cortarla por las comas: también la fecha y la sucursal, que la cuenta no usa.</p>
      </div>
      <div className="fm-d-lado">
        <h3>En Parquet y ORC: por columnas</h3>
        <div className="fm-cols mono" aria-hidden="true">
          {MUESTRA.columnas.map((c, i) => (
            <div key={c} className="fm-col" data-usada={COLUMNAS_USADAS.includes(c) || undefined}>
              <b>{c}</b>
              {MUESTRA.filas.map((f, k) => <span key={k}>{f[i]}</span>)}
              <small>{COLUMNAS_USADAS.includes(c) ? 'se lee' : 'no se toca'}</small>
            </div>
          ))}
        </div>
        <p>La consulta usa producto, cantidad y precio: las otras columnas ni se leen. Y cada columna se comprime sola: sucursal tiene 4 valores distintos y se guarda como un diccionario.</p>
      </div>
    </section>
  );
}

/* ---------- Una copia ---------- */

function Copia({ f, tabla, m, maxMb, csv }: { f: typeof FORMATOS[number]; tabla?: CatalogEntry; m?: Medida; maxMb: number; csv?: Medida }) {
  const veces = m && csv && f.id !== 'csv' && m.mb > 0 ? csv.mb / m.mb : undefined;
  return (
    <article className="fm-copia" data-f={f.id} aria-label={f.nombre}>
      <header>
        <h3>{f.nombre}</h3>
        <span className="mono">{f.tabla}</span>
      </header>
      <p className="fm-como">{f.como}</p>
      {!tabla ? <p className="fm-nada">Todavía no existe.</p>
        : !m ? <p className="fm-nada"><Dot s="running" label="midiendo" />Midiendo la carpeta…</p>
          : (
            <>
              <div className="fm-tam">
                <b className="num">{sizeLabel(m.mb)}</b>
                <span>{veces ? `${nf(veces, 1)} veces menos que el CSV` : 'en HDFS'}</span>
              </div>
              <span className="fm-bar" aria-hidden="true"><i style={{ width: `${maxMb ? Math.max(3, (m.mb / maxMb) * 100) : 0}%` }} /></span>
              <div className="fm-bloques" aria-label={`${m.bloques} bloques`}>
                {Array.from({ length: Math.min(m.bloques, 48) }, (_, i) => <i key={i} />)}
                {m.bloques > 48 && <small>+{m.bloques - 48}</small>}
              </div>
              <p className="fm-n">{m.archivos} {m.archivos === 1 ? 'archivo' : 'archivos'} · {m.bloques} {m.bloques === 1 ? 'bloque' : 'bloques'}{m.bloques ? ': una tarea de map por bloque' : ''}</p>
            </>
          )}
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => navigate('hdfs', f.carpeta.slice(1))} disabled={!tabla}><FolderOpen size={13} />{f.carpeta}</button>
    </article>
  );
}

export function FormatosPage() {
  const status = useStatus();
  const caps = useCapabilities();
  const up = status?.phase === 'running';
  const listo = up && caps.hive.state === 'ready';

  // Apagado no se pide nada (contestaría 409); solo se listan las carpetas de las tablas que existen (sin 404)
  const refresh = (e: { type: string }) => e.type === 'hdfs' || e.type === 'step' || e.type === 'status';
  const catalog = useApi(a => (listo ? a.catalog() : Promise.resolve([] as CatalogEntry[])), [listo], refresh);
  const hay = useMemo(() => existentes(catalog.data ?? []), [catalog.data]);
  const carpetas = FORMATOS.filter(f => hay[f.id]?.location).map(f => [f.id, hay[f.id]!.location!] as const);
  const clave = carpetas.map(([id, c]) => `${id}:${c}`).join(',');
  const listados = useApi(a => Promise.all(carpetas.map(([id, c]) => a.hdfsList(c).then((l): [FormatoId, HdfsListing | null] => [id, l], (): [FormatoId, HdfsListing | null] => [id, null]))), [clave], e => e.type === 'hdfs');
  const medidas: Partial<Record<FormatoId, Medida>> = {};
  for (const [id, l] of listados.data ?? []) if (l) medidas[id] = medir(l.entries);
  const maxMb = Math.max(0, ...Object.values(medidas).map(m => m!.mb));

  const [paso, setPaso] = useState<string | null>(null);
  const [corridas, setCorridas] = useState(guardadas);
  const [corriendo, setCorriendo] = useState<FormatoId | null>(null);

  async function crear() {
    const ventas = hay.csv;
    if (!ventas) return;
    try {
      for (const f of FORMATOS.filter(x => x.stored)) {
        const [tabla, llenar] = crearCopia(f, ventas.columns);
        setPaso(`${f.nombre}: CREATE EXTERNAL TABLE`);
        await api().query('hive', tabla);
        setPaso(`${f.nombre}: INSERT OVERWRITE, un trabajo de Tez que lee el CSV y escribe ${f.nombre}`);
        await api().query('hive', llenar);
      }
      toast({ kind: 'ok', title: 'Copias listas', description: 'ventas_parquet y ventas_orc, en /user/root/formatos' });
    } catch (e) {
      toast({ kind: 'bad', title: 'No se pudieron crear las copias', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setPaso(null);
      catalog.reload();
    }
  }

  async function correr() {
    // Una por vez: en paralelo se pelearían la memoria de YARN y los tiempos no dirían nada
    for (const f of FORMATOS.filter(x => hay[x.id])) {
      setCorriendo(f.id);
      let c: Corrida;
      try {
        const r = await api().query('hive', consulta(f.tabla));
        c = { ms: r.ms, appId: r.appId, scanned: r.scanned, bytesRead: r.bytesRead };
      } catch (e) {
        c = { ms: 0, error: e instanceof Error ? e.message : String(e) };
      }
      guardadas = { ...guardadas, [f.id]: c };
      setCorridas(guardadas);
    }
    setCorriendo(null);
  }

  const n = Object.keys(hay).length;
  const maxMs = Math.max(0, ...Object.values(corridas).map(c => c!.ms));
  const maxLeido = Math.max(0, ...Object.values(corridas).map(c => c!.bytesRead ?? 0));
  const csv = medidas.csv, pq = medidas.parquet, orc = medidas.orc;
  const cuentas: string[] = [];
  if (csv && pq && pq.mb > 0) cuentas.push(`Parquet ocupa ${nf(csv.mb / pq.mb, 1)} veces menos que el CSV (${sizeLabel(pq.mb)} contra ${sizeLabel(csv.mb)}) y queda en ${pq.bloques} ${pq.bloques === 1 ? 'bloque' : 'bloques'} en vez de ${csv.bloques}: menos bloques son menos tareas de map.`);
  if (csv && orc && orc.mb > 0) cuentas.push(`ORC, ${nf(csv.mb / orc.mb, 1)} veces menos (${sizeLabel(orc.mb)}).`);
  const tc = corridas.csv, tp = corridas.parquet;
  if (tc?.bytesRead && tp?.bytesRead) cuentas.push(`Para la misma consulta, Parquet leyó ${bytesLabel(tp.bytesRead)} de HDFS y el CSV ${bytesLabel(tc.bytesRead)}: ${nf(tc.bytesRead / tp.bytesRead, 1)} veces menos, porque lee solo las 3 columnas que usa, y comprimidas.`);
  if (tc && tp && !tc.error && !tp.error) cuentas.push(`La misma consulta tardó ${duration(tc.ms / 1000)} sobre el CSV y ${duration(tp.ms / 1000)} sobre Parquet. Con 6 MB casi todo el tiempo es arrancar el trabajo en YARN; con cientos de GB, la diferencia sale de leer menos.`);

  return (
    <div className="page-in fm">
      <PageHeader title="Formatos"
        sub="La misma tabla de ventas guardada en texto (CSV), Parquet y ORC: cuánto ocupa en HDFS, en cuántos bloques queda y cuánto tarda la misma consulta."
        status={!status ? undefined : status.phase === 'starting' ? { k: 'run', label: 'Arrancando' } : !up ? { k: 'off', label: 'Cluster apagado' } : caps.hive.state !== 'ready' ? { k: 'bad', label: 'Hive no está' } : catalog.data ? { k: n === 3 ? 'ok' : 'run', label: `${n} de 3 copias` } : undefined}
        help={<>El formato es cómo están escritos los archivos adentro de HDFS. El CSV se lee por filas y entero; Parquet y ORC guardan cada columna junta, comprimida y con su tipo, y una consulta lee solo las columnas que usa. Las copias son tablas externas que arma Hive en /user/root/formatos.</>} />

      <Dibujo />

      <section className="fm-sec" aria-label="Las tres copias">
        <div className="fm-sec-h">
          <div>
            <h2>Las tres copias</h2>
            <p>El CSV es la tabla ventas de siempre. Parquet y ORC son copias que escribe Hive leyendo ese CSV: los mismos datos, otro formato. Lo que ocupan sale del listado de HDFS.</p>
          </div>
          {listo && n < 3 && (
            <GatedButton cap="hive" className="btn btn-primary" busy={!!paso} blockedBy={!hay.csv && 'Primero tiene que existir la tabla ventas (en Lenguajes, Hive)'} onClick={() => void crear()}>
              <Plus size={14} />Crear las copias en Parquet y ORC
            </GatedButton>
          )}
        </div>
        {paso && <p className="fm-paso" role="status"><Dot s="running" label="corriendo" />{paso}</p>}
        {!status ? null : !up ? (
          <EmptyState kind="blocked" title={status.phase === 'starting' ? 'El cluster está arrancando' : 'Las copias se miden con el cluster prendido'}
            actions={status.phase === 'stopped' ? <button type="button" className="btn btn-primary" onClick={() => runFix({ kind: 'start' })}><Play size={14} />Iniciar cluster</button> : undefined}>
            Arriba está la idea; los números salen de HDFS y de Hive.
          </EmptyState>
        ) : caps.hive.state !== 'ready' ? (
          <EmptyState kind="blocked" title="Hive no está disponible"
            actions={caps.hive.fix && caps.hive.fix.kind !== 'wait' ? <button type="button" className="btn btn-primary" onClick={() => runFix(caps.hive.fix)}>{caps.hive.fixLabel}</button> : undefined}>
            {caps.hive.reason}
          </EmptyState>
        ) : (
          <>
            {catalog.data && !hay.csv && (
              <div className="fm-aviso">
                <span>Falta la tabla <b>ventas</b>, la del CSV: es de donde salen las otras dos.</span>
                <button type="button" className="btn btn-sm" onClick={() => navigate('lenguajes', 'hive')}>Crearla en Lenguajes<ArrowRight size={13} /></button>
              </div>
            )}
            <div className="fm-copias">
              {FORMATOS.map(f => <Copia key={f.id} f={f} tabla={hay[f.id]} m={medidas[f.id]} maxMb={maxMb} csv={csv} />)}
            </div>
          </>
        )}
      </section>

      <section className="fm-sec" aria-label="La misma consulta en las tres">
        <div className="fm-sec-h">
          <div>
            <h2>La misma consulta en las tres</h2>
            <p>Ventas por producto: usa 3 de las 5 columnas. Corre una por vez, para que no se peleen la memoria de YARN.</p>
          </div>
          {listo && (
            <GatedButton cap="hive" className="btn btn-primary" busy={!!corriendo} blockedBy={n < 2 && 'Creá primero las copias'} onClick={() => void correr()}>
              <Play size={14} />Correr en las {n > 1 ? n : 'tres'}
            </GatedButton>
          )}
        </div>
        <div className="fm-q">
          <Codigo cmd={consulta('ventas_parquet')} bash={false} donde="en Lenguajes, Hive (cambiando la tabla)" />
          <div className="fm-res">
            {FORMATOS.map(f => {
              const c = corridas[f.id];
              return (
                <div key={f.id} className="fm-r" data-f={f.id}>
                  <b>{f.nombre}</b>
                  {corriendo === f.id ? <span className="fm-r-v"><Dot s="running" label="corriendo" />corriendo en Tez…</span>
                    : !c ? <span className="fm-r-v muted">sin correr</span>
                      : c.error ? <span className="fm-r-v fm-err">{c.error.split('\n')[0]}</span>
                        : (
                          <span className="fm-r-v">
                            <span className="fm-bar" aria-hidden="true"><i style={{ width: `${maxMs ? Math.max(3, (c.ms / maxMs) * 100) : 0}%` }} /></span>
                            <span><b className="num">{duration(c.ms / 1000)}</b>{c.scanned ? ` · ${nf(c.scanned)} filas` : ''}</span>
                            {c.bytesRead != null && (
                              <span className="fm-leido"><span className="fm-bar" aria-hidden="true"><i style={{ width: `${maxLeido ? Math.max(3, (c.bytesRead / maxLeido) * 100) : 0}%` }} /></span><span>leyó <b className="num">{bytesLabel(c.bytesRead)}</b> de HDFS</span></span>
                            )}
                            {c.appId && <button type="button" className="btn btn-sm btn-ghost" onClick={() => navigate('yarn', c.appId)}>Ver el trabajo<ArrowRight size={13} /></button>}
                          </span>
                        )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="fm-sec fm-que" aria-label="Qué muestra esto">
        <h2>Qué muestra esto</h2>
        {cuentas.length ? <ul>{cuentas.map(x => <li key={x}>{x}</li>)}</ul>
          : <p>Con las copias creadas, acá aparecen las cuentas: cuánto menos ocupa cada formato y cuánto tardó la consulta en cada uno.</p>}
        <p>Lo leído sale de los contadores del DAG de Tez, que beeline imprime al final de cada consulta (<code>--hiveconf hive.tez.exec.print.summary=true</code>). En la terminal, lo mismo que mide esta pantalla:</p>
        <Codigo cmd={'hdfs dfs -du -s -h /user/root/ventas /user/root/formatos/parquet /user/root/formatos/orc\nhdfs dfs -count /user/root/ventas /user/root/formatos/parquet /user/root/formatos/orc'} bash donde="en la terminal del contenedor" />
      </section>
    </div>
  );
}
