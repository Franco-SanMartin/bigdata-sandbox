/* Motores: quién hace la cuenta. Una ficha por motor (MapReduce, Tez y Spark) con cómo trabaja, cuándo
   conviene y quién lo usa en el sandbox, y al lado el DAG de su último trabajo en YARN, con lo que movió.
   Sale de los mismos datos que Trabajos y Comparar: la lista de YARN, el detalle y /api/yarn/metrics. */
import { useState } from 'react';
import { ArrowRight, GitCompareArrows, Play } from 'lucide-react';
import { api } from '../../api';
import type { AppType, ExampleJob, YarnApp, YarnAppDetail, YarnMetrics } from '../../api/types';
import { GatedButton, PageHeader } from '../../components/base';
import { EngineTag } from '../../components/Trace';
import { Dot } from '../../components/ui';
import type { CapId } from '../../lib/capabilities';
import { HERRAMIENTAS, activa, type ToolId } from '../../lib/ecosistema';
import { bytesLabel, duracion } from '../../lib/comparar';
import { duration, nf } from '../../lib/format';
import { useSnapshot } from '../../state/store';
import { abrirGlosario, navigate, toast } from '../../state/ui';
import { useApi } from '../../state/useApi';
import { TERMINOS } from '../../help/glosario';
import { Dag, STATE_ES } from '../yarn/AppDetail';
import '../yarn/yarn.css';
import './motores.css';

interface Motor {
  type: AppType; tool: ToolId; eng: 'mr' | 'tez' | 'spark'; nombre: string;
  como: string; brilla: string; usan: string; plantilla: ExampleJob; cap: CapId; glosario: string[];
}

/* Lo de D-05 (tabla de motores), en una línea cada cosa */
const MOTORES: Motor[] = [
  { type: 'MAPREDUCE', tool: 'mapreduce', eng: 'mr', nombre: 'MapReduce', plantilla: 'mr-ventas', cap: 'mapreduce',
    como: 'Dos fases fijas, map y reduce, con un shuffle en el medio. Entre un trabajo y el siguiente escribe todo en HDFS.',
    brilla: 'Lotes enormes y simples. Es el modelo original y el que se aprende primero.',
    usan: 'MapReduce a mano (Hadoop Streaming), Pig y Sqoop', glosario: ['map', 'shuffle', 'reduce', 'combiner', 'spill'] },
  { type: 'TEZ', tool: 'tez', eng: 'tez', nombre: 'Tez', plantilla: 'hive-ventas', cap: 'tez',
    como: 'Arma el trabajo como un grafo de pasos (un DAG) y los encadena sin pasar por HDFS entre uno y otro.',
    brilla: 'Hive: la misma consulta, más rápida que con MapReduce.',
    usan: 'Hive', glosario: ['dag', 'tez', 'hive'] },
  { type: 'SPARK', tool: 'spark', eng: 'spark', nombre: 'Spark', plantilla: 'spark-ventas', cap: 'spark',
    como: 'Un grafo de etapas que corre en memoria cuando entra, repartido entre executors que viven todo el programa.',
    brilla: 'Lo que repite pasos sobre los mismos datos (ML, grafos) y lo interactivo.',
    usan: 'PySpark, Spark SQL y MLlib', glosario: ['spark', 'etapa', 'driver-y-executors', 'acción-y-transformación', 'cache'] },
];

/** El trabajo más nuevo de cada motor en la lista de YARN */
const ultimo = (apps: YarnApp[], t: AppType) => apps.filter(a => a.type === t).sort((a, b) => b.submittedAt - a.submittedAt)[0];

function Movido({ m }: { m: YarnMetrics }) {
  const fila = (k: string, v?: string) => v && <div><dt>{k}</dt><dd className="num">{v}</dd></div>;
  return (
    <dl className="mo-mov">
      {fila('Memoria × tiempo', m.mbSeconds != null ? `${nf(m.mbSeconds / 1024, 1)} GB·s` : undefined)}
      {fila('Leído de HDFS', m.hdfsReadBytes != null ? bytesLabel(m.hdfsReadBytes) : undefined)}
      {fila('Shuffle', m.shuffleBytes != null ? bytesLabel(m.shuffleBytes) : undefined)}
      {fila('Disco local', m.localDiskBytes != null ? bytesLabel(m.localDiskBytes) : undefined)}
      {fila('Tareas', m.tasks != null ? nf(m.tasks) : undefined)}
    </dl>
  );
}

function Ultimo({ app, now, prendido }: { app: YarnApp; now: number; prendido: boolean }) {
  const vivo = activa(app);
  // El detalle (con el DAG) se vuelve a pedir mientras corre; las métricas, cuando terminó. Apagado no se pide nada (409)
  const det = useApi<YarnAppDetail | undefined>(a => (prendido ? a.app(app.id) : Promise.resolve(undefined)), [app.id, prendido, vivo ? Math.floor(now / 4000) : app.state]);
  const met = useApi<YarnMetrics[]>(a => (prendido && app.state === 'FINISHED' ? a.yarnMetrics([app.id]) : Promise.resolve([])), [app.id, app.state, prendido]);
  const m = met.data?.[0];
  return (
    <div className="mo-ult">
      <div className="mo-ult-h">
        <Dot s={vivo ? 'running' : app.state === 'FINISHED' ? 'up' : 'off'} label={STATE_ES[app.state]} />
        <b className="mono" title={app.name}>{app.name}</b>
        <span className="muted">{STATE_ES[app.state]} · {duration(duracion(app, now) / 1000)}</span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => navigate('yarn', app.id)}>Ver el trabajo<ArrowRight size={13} /></button>
      </div>
      {!prendido ? <p className="muted">El DAG se ve con el cluster prendido.</p> : det.data ? <Dag app={det.data} now={now} /> : det.error ? <p className="muted">{det.error}</p> : <p className="muted">Pidiendo el DAG…</p>}
      {m && !m.error && <Movido m={m} />}
      {m && m.source === 'rm' && m.type === 'TEZ' && <p className="mo-nota">Tez no guarda contadores sin el Timeline Server. Los trabajos que lanza esta interfaz los traen del resumen de beeline; de este (mandado de otro lado) se sabe el tiempo y la memoria.</p>}
    </div>
  );
}

function Ficha({ mo, app, now, prendido }: { mo: Motor; app?: YarnApp; now: number; prendido: boolean }) {
  const h = HERRAMIENTAS[mo.tool];
  const [enviando, setEnviando] = useState(false);
  const lanzar = async () => {
    setEnviando(true);
    try {
      const id = await api().submitJob({ template: mo.plantilla, params: {} });
      toast({ kind: 'run', title: `${mo.nombre}: enviado a YARN`, description: 'La ficha muestra su DAG mientras corre', action: { label: 'Ver el trabajo', run: () => navigate('yarn', id) } });
    } catch (e) {
      toast({ kind: 'bad', title: `${mo.nombre}: no se pudo lanzar`, description: e instanceof Error ? e.message : String(e) });
    } finally { setEnviando(false); }
  };
  return (
    <article className="mo-f" data-motor={mo.eng} aria-label={mo.nombre}>
      <div className="mo-f-info">
        <header>
          <h2>{mo.nombre}</h2>
          <EngineTag engine={mo.eng} />
          <span className="mono muted">en YARN: {mo.type}</span>
        </header>
        <p className="mo-frase">{h.frase}</p>
        <p className="mo-ana">{h.analogia}</p>
        <dl className="mo-dl">
          <div><dt>Cómo trabaja</dt><dd>{mo.como}</dd></div>
          <div><dt>Cuándo conviene</dt><dd>{mo.brilla}</dd></div>
          <div><dt>Quién lo usa acá</dt><dd>{mo.usan}</dd></div>
        </dl>
        <div className="mo-glo">
          {mo.glosario.map(id => <button key={id} type="button" className="help-glo-t" data-capa="motores" onClick={() => abrirGlosario(id)}>{TERMINOS.get(id)?.t ?? id}</button>)}
        </div>
      </div>
      <div className="mo-f-run">
        <div className="mo-f-run-h">
          <h3>El último trabajo de {mo.nombre}</h3>
          <GatedButton cap={mo.cap} className="btn btn-sm btn-primary" busy={enviando} onClick={() => void lanzar()}><Play size={12} />Lanzar ventas por producto</GatedButton>
        </div>
        {app ? <Ultimo key={app.id} app={app} now={now} prendido={prendido} /> : <p className="mo-nada">Todavía no corrió ningún trabajo de {mo.nombre} en este cluster. Lanzá uno y su DAG aparece acá, tarea por tarea.</p>}
      </div>
    </article>
  );
}

export function MotoresPage() {
  const { status: s, apps } = useSnapshot();
  if (!s) return null;
  const vivos = new Set(apps.filter(activa).map(a => a.type));
  return (
    <div className="page-in mo">
      <PageHeader title="Motores"
        sub="Quién hace la cuenta en el cluster: MapReduce, Tez y Spark. Cómo trabaja cada uno y el DAG de su último trabajo en YARN."
        status={vivos.size ? { k: 'run', label: `${[...vivos].map(t => MOTORES.find(m => m.type === t)?.nombre).join(', ')} corriendo` } : undefined}
        help={<>Un motor ejecuta el trabajo; un lenguaje (Hive, Pig, PySpark) es cómo se lo pedís. El mismo lenguaje puede correr en más de un motor, y en YARN cada trabajo dice el suyo en Application Type.</>} />

      <div className="mo-intro" data-capa="motores">
        <p><b>Casi todo parte de MapReduce:</b> repartir (map), agrupar por clave (shuffle) y combinar (reduce). Tez y Spark hacen lo mismo, pero arman el trabajo entero como un grafo y no escriben en HDFS entre un paso y otro; Spark además lo guarda en memoria.</p>
        <button type="button" className="btn btn-sm" onClick={() => navigate('comparar', 'quien-hace-el-trabajo')}><GitCompareArrows size={13} />La misma cuenta en los tres</button>
      </div>

      <div className="mo-fichas">
        {MOTORES.map(mo => <Ficha key={mo.type} mo={mo} app={ultimo(apps, mo.type)} now={s.now} prendido={s.phase === 'running'} />)}
      </div>
    </div>
  );
}
