/* Comparar: la misma tarea con cada herramienta. Arriba, la cuenta de ventas por producto escrita
   cuatro veces con el código real de datos/ejemplos: de dónde lee, qué lenguaje, qué motor y dónde
   deja el resultado; cada columna dice cuántas líneas lleva, qué fases arma el motor y cuánto tardó
   la última vez en YARN, y se lanza desde acá o desde la terminal. Abajo, las preguntas de siempre
   (¿cómo lo pido?, ¿quién hace el trabajo?…) con una tabla cada una. */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Database, FolderOpen, Play, Route } from 'lucide-react';
import { api } from '../../api';
import type { YarnApp } from '../../api/types';
import { Codigo, Copiar } from '../../components/Comando';
import { GatedButton, PageHeader } from '../../components/base';
import { EngineTag } from '../../components/Trace';
import { useSnapshot } from '../../state/store';
import { navigate, setRouteArg, toast, useRouteArg } from '../../state/ui';
import { COMPARAR, RECORRIDOS, activa, type ToolId } from '../../lib/ecosistema';
import { DATOS, MOTOR, VARIANTES, VERIFICAR, duracion, ultimas, type Archivo, type Variante } from '../../lib/comparar';
import { duration, nf } from '../../lib/format';
import type { CapId } from '../../lib/capabilities';
import './comparar.css';

const html = (s: string) => ({ __html: s });
const CAP: Partial<Record<ToolId, CapId>> = { streaming: 'mapreduce', pig: 'pig', hive: 'tez', pyspark: 'spark' };
const ESTADO: Record<YarnApp['state'], string> = { ACCEPTED: 'en la cola', RUNNING: 'corriendo', FINISHED: 'terminó', FAILED: 'falló', KILLED: 'la cortaron' };

/* ---------- Resaltado mínimo: comentarios, palabras clave y textos ---------- */

const palabras = (s: string) => new RegExp(`^(?:${s.trim().split(/\s+/).join('|')})$`);
const CLAVES: Record<'py' | 'sql' | 'pig', RegExp> = {
  py: palabras('import from for in if not is None print and or as return def'),
  sql: palabras('CREATE EXTERNAL TABLE IF NOT EXISTS ROW FORMAT DELIMITED FIELDS TERMINATED BY STORED AS LOCATION TBLPROPERTIES SELECT SUM CAST FROM GROUP ORDER DESC STRING INT BIGINT TEXTFILE'),
  pig: palabras('LOAD USING AS FILTER BY FOREACH GENERATE GROUP SUM ORDER DESC STORE INTO fs'),
};
const lenguaje = (nombre: string) => (nombre.endsWith('.py') ? 'py' : nombre.endsWith('.pig') ? 'pig' : 'sql');

function Linea({ l, lang }: { l: string; lang: 'py' | 'sql' | 'pig' }) {
  const com = lang === 'py' ? '#' : '--';
  const i = l.indexOf(com);
  const codigo = i < 0 ? l : l.slice(0, i), resto = i < 0 ? '' : l.slice(i);
  // Palabra por palabra: las claves en negrita, los textos entre comillas aparte
  const partes = codigo.split(/("[^"]*"|'[^']*'|\b\w+\b)/);
  return (
    <>
      {partes.map((p, k) => (/^["']/.test(p) ? <span key={k} className="cp-tx">{p}</span>
        : CLAVES[lang].test(p) ? <span key={k} className="cp-kw">{p}</span>
          : <Fragment key={k}>{p}</Fragment>))}
      {resto && <span className="cp-com">{resto}</span>}
      {'\n'}
    </>
  );
}

function Fuente({ archivos }: { archivos: Archivo[] }) {
  const [i, setI] = useState(0);
  const [entero, setEntero] = useState(false);
  const a = archivos[i];
  const texto = entero ? a.texto : a.nucleo;
  return (
    <div className="cp-src">
      <div className="cp-src-h">
        <div role="tablist" aria-label="Archivos">
          {archivos.map((x, n) => <button key={x.nombre} type="button" role="tab" aria-selected={n === i} onClick={() => setI(n)} className="mono">{x.nombre}</button>)}
        </div>
        <button type="button" className="cp-src-t" aria-pressed={entero} onClick={() => setEntero(v => !v)}>{entero ? 'Solo la cuenta' : 'Archivo entero'}</button>
      </div>
      <pre className="cp-pre mono" tabIndex={0} aria-label={`${a.nombre}${entero ? '' : ', lo que hace la cuenta'}`}>
        {texto.split('\n').map((l, n) => <Linea key={n} l={l} lang={lenguaje(a.nombre)} />)}
      </pre>
      <div className="cp-src-f"><span>datos/ejemplos/{a.nombre}</span><Copiar texto={texto} /></div>
    </div>
  );
}

/* ---------- El flujo: un dato, cuatro lenguajes, tres motores, cuatro resultados ---------- */

function Flujo({ vivos, ult }: { vivos: Set<string>; ult: Partial<Record<ToolId, YarnApp>> }) {
  // Fila 1: los rótulos de cada columna; filas 2 a 5: una por versión
  const motores: { m: 'MAPREDUCE' | 'TEZ' | 'SPARK'; filas: string }[] = [
    { m: 'MAPREDUCE', filas: '2 / span 2' }, { m: 'TEZ', filas: '4' }, { m: 'SPARK', filas: '5' },
  ];
  const cap = (col: number, t: string) => <span className="cp-fl-cap" style={{ gridColumn: col, gridRow: 1 }}>{t}</span>;
  return (
    <section className="cp-flujo" aria-label="El recorrido de los datos en las cuatro versiones">
      {cap(1, 'Almacenamiento')}{cap(3, 'Lenguaje · cómo lo pedís')}{cap(5, 'Motor · quién hace la cuenta')}{cap(7, 'Resultado, otra vez en HDFS')}
      <div className="cp-fl-dato" data-capa="datos" style={{ gridRow: '2 / span 4' }}>
        <span className="cp-fl-k">El dato, una sola vez</span>
        <b className="mono">{DATOS.carpeta}</b>
        <small>HDFS guarda ventas.csv en bloques. Ninguna versión lo copia: las cuatro leen de acá.</small>
        <button type="button" className="btn btn-sm" onClick={() => navigate('hdfs', DATOS.carpeta.slice(1))}><FolderOpen size={13} />Ver en HDFS</button>
      </div>
      {VARIANTES.map((v, i) => {
        // Cada fila sigue a su propio trabajo: Pig y MapReduce a mano comparten motor, no el cable
        const app = ult[v.id];
        const run = (app && activa(app)) || undefined;
        return (
          <Fragment key={v.id}>
            <i className="cp-fl-w" style={{ gridRow: i + 2, gridColumn: 2 }} data-run={run} aria-hidden="true" />
            <a className="cp-fl-l" data-capa="lenguajes" href={`#comparar`} onClick={e => { e.preventDefault(); document.getElementById(`cp-${v.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
              style={{ gridRow: i + 2 }}><b>{v.nombre}</b><small className="mono">{v.archivos.map(a => a.nombre).join(' + ')}</small></a>
            <i className="cp-fl-w" style={{ gridRow: i + 2, gridColumn: 4 }} data-run={run} aria-hidden="true" />
            <i className="cp-fl-w" style={{ gridRow: i + 2, gridColumn: 6 }} data-run={run} aria-hidden="true" />
            <span className="cp-fl-out mono" data-capa="datos" style={{ gridRow: i + 2 }}>{v.salida.replace('/user/root/', '')}</span>
          </Fragment>
        );
      })}
      {motores.map(({ m, filas }) => (
        <div key={m} className="cp-fl-m" data-motor={MOTOR[m].eng} data-run={vivos.has(m) || undefined} style={{ gridRow: filas }}>
          <b>{MOTOR[m].nombre}</b>
          <small>{vivos.has(m) ? 'corriendo ahora' : <>en YARN: <span className="mono">{m}</span></>}</small>
        </div>
      ))}
    </section>
  );
}
/* ---------- Una columna por herramienta ---------- */

function Barra({ valor, max, children }: { valor: number; max: number; children: ReactNode }) {
  return (
    <div className="cp-bar">
      <span className="cp-bar-t">{children}</span>
      <span className="cp-bar-0" aria-hidden="true"><i style={{ width: `${max ? Math.max(4, (valor / max) * 100) : 0}%` }} /></span>
    </div>
  );
}

function Fases({ v, app }: { v: Variante; app?: YarnApp }) {
  // Las de la última corrida si YARN las trae; si no, las que arma ese motor
  const reales = app?.stages.length ? app.stages.map(s => ({ t: s.name, n: s.tasks.length, st: s.state, disco: false })) : null;
  const fases = reales ?? v.fases.map(f => ({ t: f.t, n: 0, st: undefined, disco: !!f.disco }));
  return (
    <div className="cp-fases" aria-label={`Fases de ${MOTOR[v.motor].nombre}`}>
      <ol>
        {fases.map((f, i) => (
          <li key={i} data-disco={f.disco || undefined} data-st={f.st}>
            {f.t}{f.n > 0 && <small className="num">×{f.n}</small>}
          </li>
        ))}
      </ol>
      <p>{reales ? 'Las fases de la última corrida, como las contó YARN. ' : ''}{v.faseNota}</p>
    </div>
  );
}

function Columna({ v, app, now, maxLineas, maxT }: { v: Variante; app?: YarnApp; now: number; maxLineas: number; maxT: number }) {
  const [enviando, setEnviando] = useState(false);
  const lineas = v.archivos.reduce((n, a) => n + a.lineas, 0);
  const vivo = app && activa(app);
  const lanzar = async () => {
    if (!v.plantilla) return;
    setEnviando(true);
    try {
      const id = await api().submitJob({ template: v.plantilla, params: {} });
      toast({ kind: 'run', title: `${v.nombre}: enviado a YARN`, description: 'La columna muestra el tiempo cuando termina', action: { label: 'Ver el trabajo', run: () => navigate('yarn', id) } });
    } catch (e) {
      toast({ kind: 'bad', title: `${v.nombre}: no se pudo lanzar`, description: e instanceof Error ? e.message : String(e) });
    } finally { setEnviando(false); }
  };
  return (
    <article className="cp-col" id={`cp-${v.id}`} data-motor={MOTOR[v.motor].eng} data-run={vivo || undefined} aria-label={v.nombre}>
      <header className="cp-col-h" data-capa="lenguajes">
        <h3>{v.nombre}</h3>
        <EngineTag engine={MOTOR[v.motor].eng} />
        <p>{v.estilo}</p>
      </header>

      <div className="cp-med">
        <Barra valor={lineas} max={maxLineas}><b className="num">{nf(lineas)}</b> líneas hacen la cuenta</Barra>
        {app
          ? <Barra valor={duracion(app, now)} max={maxT}>
              <b className="num">{duration(duracion(app, now) / 1000)}</b> la última vez · <span data-st={app.state}>{ESTADO[app.state]}{vivo ? ` ${nf(app.progress)} %` : ''}</span>
            </Barra>
          : <div className="cp-bar cp-bar-nada">Todavía no corrió en este cluster</div>}
      </div>

      <Fases v={v} app={app} />
      <Fuente archivos={v.archivos} />
      <p className="cp-nota">{v.nota}</p>

      <div className="cp-acc">
        {v.plantilla
          ? <GatedButton cap={CAP[v.id]} className="btn btn-sm btn-primary" busy={enviando} onClick={lanzar}><Play size={12} />Lanzar en YARN</GatedButton>
          : <button type="button" className="btn btn-sm btn-primary" onClick={() => navigate('datos')}><Database size={13} />Probarlo en Consultas</button>}
        {app && <button type="button" className="btn btn-sm btn-ghost" onClick={() => navigate('yarn', app.id)}>Ver el trabajo<ArrowRight size={13} /></button>}
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => navigate('hdfs', v.salida.slice(1))}>Ver el resultado</button>
      </div>
      <Codigo cmd={v.cmd} bash donde="o en la terminal, parado en /datos" />
    </article>
  );
}

/* ---------- ¿Cuál uso? Las tablas ---------- */

function Preguntas({ sel }: { sel: string }) {
  const ref = useRef<HTMLElement>(null);
  const i = Math.max(0, COMPARAR.findIndex(c => c.id === sel));
  const c = COMPARAR[i];
  // Si se llegó con #comparar/<pregunta> (desde Inicio), se baja hasta acá
  const llegada = useRef(sel);
  useEffect(() => { if (COMPARAR.some(x => x.id === llegada.current)) ref.current?.scrollIntoView({ block: 'start' }); }, []);
  return (
    <section className="cp-preg" ref={ref} aria-label="Las preguntas de siempre">
      <div className="cp-preg-tabs" role="tablist" aria-label="Qué comparar">
        {COMPARAR.map((x, n) => (
          <button key={x.id} type="button" role="tab" aria-selected={n === i} onClick={() => setRouteArg(x.id)}>
            <b>{x.pregunta}</b><small>{x.cuales}</small>
          </button>
        ))}
      </div>
      <div className="cp-preg-body" role="tabpanel" aria-label={c.t}>
        <h3>{c.t}</h3>
        <p>{c.q}</p>
        <div className="cp-preg-wrap">
          <table className="cp-tabla">
            <thead><tr><th />{c.cols.map(([n, capa]) => <th key={n} data-capa={capa}>{n}</th>)}</tr></thead>
            <tbody>{c.rows.map(r => <tr key={r[0]}><th scope="row">{r[0]}</th>{r.slice(1).map((x, k) => <td key={k} dangerouslySetInnerHTML={html(x)} />)}</tr>)}</tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export function CompararPage() {
  const { status: s, apps } = useSnapshot();
  const arg = useRouteArg();
  const ult = useMemo(() => ultimas(apps), [apps]);
  if (!s) return null;
  const vivos = new Set<string>(apps.filter(activa).map(a => a.type));
  const maxLineas = Math.max(...VARIANTES.map(v => v.archivos.reduce((n, a) => n + a.lineas, 0)));
  const maxT = Math.max(0, ...Object.values(ult).map(a => duracion(a!, s.now)));
  const cierre = RECORRIDOS.tres.steps[RECORRIDOS.tres.steps.length - 1];
  return (
    <div className="page-in cp">
      <PageHeader title="Comparar" sub="La misma tarea hecha con cada herramienta: el código real, el motor que la ejecuta y en qué se diferencian." />

      <div className="cp-intro">
        <div>
          <h2>Ventas por producto, cuatro veces</h2>
          <p>Cuántas unidades se vendieron de cada producto y cuánto se facturó. El repo trae la cuenta escrita cuatro veces y las cuatro tienen que dar igual: los datos y quien reparte (YARN) son los mismos; cambia cómo la escribís y qué motor la hace.</p>
        </div>
        <div className="cp-intro-a">
          <button type="button" className="btn btn-sm" onClick={() => navigate('inicio', 'recorrido/tres')}><Route size={13} />Verlo en el mapa</button>
        </div>
      </div>

      <Flujo vivos={vivos} ult={ult} />

      <div className="cp-cols">
        {VARIANTES.map(v => <Columna key={v.id} v={v} app={ult[v.id]} now={s.now} maxLineas={maxLineas} maxT={maxT} />)}
      </div>

      <section className="cp-cierre" aria-label={cierre.t}>
        <div>
          <h3>{cierre.t}</h3>
          <div className="cp-cierre-x" dangerouslySetInnerHTML={html(cierre.x)} />
          {cierre.tip && <p className="cp-cierre-tip" dangerouslySetInnerHTML={html(cierre.tip)} />}
        </div>
        <div>
          <h3>¿Dieron lo mismo?</h3>
          <p className="cp-cierre-p">Cada una separa las columnas con otra cosa y ordena distinto: así se ven las cuatro una abajo de la otra, con el mismo formato.</p>
          <Codigo cmd={VERIFICAR} bash donde="en la terminal del contenedor" />
        </div>
      </section>

      <div className="section-h cp-sec">
        <h2>¿Cuál uso?</h2>
        <span className="muted">Las preguntas de siempre, con una tabla cada una</span>
      </div>
      <Preguntas sel={arg} />
    </div>
  );
}
