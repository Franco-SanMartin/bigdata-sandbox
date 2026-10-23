/* Inicio: en qué estado está el cluster, la única acción que importa ahora y qué se puede hacer
   (y qué no, por qué, y el botón que lo arregla). Es lo primero que ve quien abre la interfaz. */
import { ArrowRight, BookOpen, Boxes, Brain, ChevronRight, Database, HardDrive, Play, Settings, Square, type LucideIcon } from 'lucide-react';
import { useSnapshot } from '../state/store';
import { navigate } from '../state/ui';
import { startCluster, stopCluster } from '../state/actions';
import { runFix, useCapabilities } from '../state/capabilities';
import { useApi } from '../state/useApi';
import { CAP_INFO, capSummary, type Capabilities, type CapId, type Capability } from '../lib/capabilities';
import { clusterHealth } from '../lib/cluster';
import { ago, mbLabel, nf, plural } from '../lib/format';
import { bootLine, EmptyState, GatedButton, PageHeader, Panel } from '../components/base';
import type { ReactNode } from 'react';
import type { Activity, ClusterStatus, DataNode } from '../api/types';
import type { PageId } from '../lib/route';

const CAP_LABEL: Record<Capability['state'], string> = { ready: 'Listo', starting: 'Arrancando', blocked: 'No disponible' };
const CAP_DOT: Record<Capability['state'], string> = { ready: 'up', starting: 'starting', blocked: 'off' };

/* ---------- El estado y la única acción ---------- */

function Hero({ s, dataNodes }: { s: ClusterStatus; dataNodes: DataNode[] }) {
  const h = clusterHealth(s, dataNodes);
  const procs = s.processes.filter(p => p.state !== 'off');
  const up = procs.filter(p => p.state === 'up').length;
  let title: string, sub: string, action = null as ReactNode, extra = null as ReactNode;
  if (s.phase === 'stopped') {
    title = 'El cluster está apagado';
    sub = 'Prendelo para usar HDFS, YARN, Hive y el resto. Los datos de la vez anterior siguen en el volumen.';
    action = <button type="button" className="btn btn-primary btn-lg" onClick={() => startCluster()}><Play size={15} />Iniciar cluster</button>;
    extra = <button type="button" className="hero-link" onClick={() => navigate('config')}><Settings size={13} />¿Querés otros nodos o servicios? Configuralo antes</button>;
  } else if (s.phase === 'starting') {
    const steps = s.boot?.steps.filter(x => x.state !== 'skipped') ?? [];
    const done = steps.filter(x => x.state === 'done').length;
    title = 'El cluster está arrancando';
    sub = bootLine(s.boot, s.now) ?? 'Levantando los procesos en orden.';
    action = <button type="button" className="btn btn-primary btn-lg" onClick={() => navigate('cluster')}>Ver arranque<ArrowRight size={15} /></button>;
    extra = steps.length > 0 && (
      <div className="hero-progress" role="progressbar" aria-label="Avance del arranque" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}>
        {steps.map(x => <i key={x.id} data-s={x.state} />)}
      </div>
    );
  } else if (s.phase === 'stopping') {
    title = 'El cluster se está apagando'; sub = 'Bajando los procesos en orden. Los datos quedan en el volumen.';
  } else {
    title = h.tone === 'ok' ? 'El cluster está andando' : h.tone === 'warn' ? 'El cluster está andando, degradado' : 'El cluster está andando con fallas';
    sub = h.tone === 'ok' ? `${up} de ${procs.length} procesos arriba · todo responde` : h.detail;
    action = h.tone === 'ok'
      ? <button type="button" className="btn btn-lg" onClick={stopCluster}><Square size={13} />Detener</button>
      : <button type="button" className="btn btn-primary btn-lg" onClick={() => navigate('cluster')}>Ver qué falla<ArrowRight size={15} /></button>;
    if (h.issues.length > 1) extra = <ul className="hero-issues">{h.issues.slice(0, 4).map((i, n) => <li key={n} data-k={i.tone}>{i.text}</li>)}</ul>;
  }
  const lamp = h.tone === 'warn' ? 'run' : h.tone;
  return (
    <section className="hero hero-v2" data-k={h.tone} aria-label="Estado del cluster">
      <div className="hero-main">
        <span className="hero-lamp" data-k={lamp} aria-hidden="true" />
        <div className="hero-t"><strong>{title}</strong><span>{sub}</span></div>
        {action && <div className="hero-actions">{action}</div>}
      </div>
      {extra && <div className="hero-extra">{extra}</div>}
      <dl className="hero-stats">
        <div><dt>Procesos</dt><dd className="num">{s.phase === 'stopped' ? '—' : <>{up}<small>/ {procs.length}</small></>}</dd></div>
        <div><dt>DataNodes vivos</dt><dd className="num">{s.phase === 'running' ? <>{s.hdfs.liveDataNodes}<small>/ {s.config.datanodes}</small></> : <>—<small>{s.config.datanodes} configurados</small></>}</dd></div>
        <div><dt>En HDFS</dt><dd className="num">{s.phase === 'running' && s.hdfs.available ? <>{nf(s.hdfs.files)}<small>{s.hdfs.files === 1 ? 'archivo' : 'archivos'} · {mbLabel(s.hdfs.usedMb)}</small></> : '—'}</dd></div>
        <div><dt>Memoria</dt><dd className="num">{mbLabel(s.memory.usedMb)}<small>de {mbLabel(s.memory.limitMb)}</small></dd></div>
      </dl>
    </section>
  );
}

/* ---------- Qué se puede hacer ---------- */

function CapAction({ c, page }: { c: Capability; page: PageId }) {
  if (c.state === 'ready') return <button type="button" className="btn btn-sm" onClick={() => navigate(page)}>Abrir<ArrowRight size={13} /></button>;
  // Con el cluster apagado el arreglo es el mismo para todas: lo ofrece el estado de arriba, no once botones iguales
  if (c.state === 'blocked' && c.fix && c.fix.kind !== 'wait' && c.fix.kind !== 'start') return <button type="button" className="btn btn-sm" onClick={() => runFix(c.fix)}>{c.fixLabel}</button>;
  return <GatedButton cap={c} className="btn btn-sm" onClick={() => navigate(page)}>Abrir<ArrowRight size={13} /></GatedButton>;
}

function CapGrid({ caps }: { caps: Capabilities }) {
  return (
    <div className="capgrid">
      {CAP_INFO.map(i => {
        const c = caps[i.id];
        return (
          <article key={i.id} className="capcard" data-k={c.state} aria-label={`${i.label}: ${CAP_LABEL[c.state].toLowerCase()}`}>
            <div className="capcard-h">
              <span className="dot" data-s={CAP_DOT[c.state]} aria-hidden="true" />
              <h3>{i.label}</h3>
              <span className="capcard-st" data-k={c.state}>{CAP_LABEL[c.state]}</span>
            </div>
            <p>{i.what}</p>
            {c.state !== 'ready' && c.reason && <span className="capcard-why">{c.reason}</span>}
            <div className="capcard-f">
              <CapAction c={c} page={i.page} />
              {i.guide && <span className="capcard-guide" title="Guía de la materia">guía {i.guide}</span>}
            </div>
          </article>
        );
      })}
    </div>
  );
}

/* ---------- Prácticas sugeridas: las que se pueden hacer ya, primero ---------- */

const SUGERIDAS: { cap: CapId; title: string; what: string; page: PageId }[] = [
  { cap: 'hdfs.write', title: 'HDFS básico', what: 'Subí ventas.csv y mirá en qué DataNodes quedan sus bloques', page: 'hdfs' },
  { cap: 'mapreduce', title: 'WordCount en YARN', what: 'Lanzá un MapReduce y seguí sus contenedores', page: 'yarn' },
  { cap: 'hdfs.write', title: 'HDFS ante fallas', what: 'Apagá un DataNode y mirá cómo se vuelven a copiar los bloques', page: 'cluster' },
  { cap: 'hive', title: 'Hive sobre HDFS', what: 'Creá una tabla externa y consultala con Tez', page: 'datos' },
  { cap: 'sqoop', title: 'De MariaDB a HDFS', what: 'Importá la base tienda con Sqoop', page: 'pipeline' },
  { cap: 'spark', title: 'El mismo cálculo en Spark', what: 'Compará el DAG de Spark con el de MapReduce', page: 'yarn' },
  { cap: 'ha', title: 'Failover del NameNode', what: 'Apagá el activo y mirá cómo ZooKeeper elige otro', page: 'cluster' },
];

function Sugeridas({ caps }: { caps: Capabilities }) {
  const rank = { ready: 0, starting: 1, blocked: 2 } as const;
  const list = [...SUGERIDAS].sort((a, b) => rank[caps[a.cap].state] - rank[caps[b.cap].state]).slice(0, 4);
  return (
    <ul className="sug">
      {list.map(x => {
        const c = caps[x.cap];
        return (
          <li key={x.title}>
            <button type="button" className="sug-row" onClick={() => navigate(x.page)} aria-label={`${x.title}: ${c.state === 'ready' ? 'se puede hacer ya' : c.reason}`}>
              <span className="dot" data-s={CAP_DOT[c.state]} aria-hidden="true" />
              <span className="sug-t"><b>{x.title}</b><span>{c.state === 'ready' ? x.what : c.reason}</span></span>
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- Lo que hay en el cluster ---------- */

function Inventory({ s, caps }: { s: ClusterStatus; caps: Capabilities }) {
  const { files, apps } = useSnapshot();
  const running = s.phase === 'running';
  // Solo se pide lo que el cluster puede contestar: con un servicio apagado, el pedido daría error
  const hiveOk = running && caps.hive.state === 'ready';
  const mlOk = running && caps['ml.sklearn'].state === 'ready';
  const cat = useApi(a => (hiveOk ? a.catalog() : Promise.resolve(null)), [hiveOk], e => e.type === 'step' || (e.type === 'activity' && /tabla|table/i.test(e.entry.title)));
  const models = useApi(a => (mlOk ? a.models() : Promise.resolve(null)), [mlOk], e => e.type === 'activity' && /model|entren/i.test(e.entry.title));
  const tables = cat.data?.filter(t => t.source === 'hive') ?? null;
  const done = models.data?.filter(m => m.state === 'done') ?? null;
  const lastApp = [...apps].sort((a, b) => b.submittedAt - a.submittedAt)[0];
  const sizeMb = files.reduce((n, f) => n + f.sizeMb, 0);
  const off = running ? 'Sin datos todavía' : 'Prendé el cluster para verlo';
  const rows: { icon: LucideIcon; label: string; value: string; detail: string; page: PageId; arg?: string }[] = [
    { icon: HardDrive, label: 'Archivos en HDFS', value: running && s.hdfs.available ? nf(files.length || s.hdfs.files) : '—', detail: running && files.length ? `${mbLabel(sizeMb)} · último ${files.slice().sort((a, b) => b.modifiedAt - a.modifiedAt)[0].path}` : off, page: 'hdfs' },
    { icon: Database, label: 'Tablas de Hive', value: tables ? nf(tables.length) : '—', detail: tables ? (tables.length ? tables.slice(0, 3).map(t => t.name.replace(/^default\./, '')).join(', ') : 'Ninguna: el pipeline las crea') : running ? caps.hive.reason ?? off : off, page: 'datos' },
    { icon: Boxes, label: 'Trabajos en YARN', value: running ? nf(apps.length) : '—', detail: lastApp ? `último: ${lastApp.name} · ${ago(s.now, lastApp.submittedAt)}` : running ? 'Ninguno todavía' : off, page: 'yarn', arg: lastApp?.id },
    { icon: Brain, label: 'Modelos entrenados', value: done ? nf(done.length) : '—', detail: done ? (done.length ? `último: ${done[0].model} (${done[0].engine})` : 'Ninguno todavía') : off, page: 'ml' },
  ];
  return (
    <ul className="inv">
      {rows.map(r => (
        <li key={r.label}>
          <button type="button" className="inv-row" onClick={() => navigate(r.page, r.arg)}>
            <span className="inv-ico"><r.icon size={15} aria-hidden="true" /></span>
            <span className="inv-l"><span>{r.label}</span><small>{r.detail}</small></span>
            <b className="num">{r.value}</b>
            <ChevronRight size={15} aria-hidden="true" className="inv-go" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ---------- Últimas acciones ---------- */

const LEVEL_DOT: Record<Activity['level'], string> = { info: 'off', ok: 'up', warn: 'warn', error: 'down' };

function Recent({ items, now }: { items: Activity[]; now: number }) {
  if (!items.length) return <EmptyState compact title="Todavía no pasó nada">Lo que hagas, y lo que haga el cluster, aparece acá y en la consola con el comando exacto.</EmptyState>;
  return (
    <ul className="recent">
      {items.map(a => (
        <li key={a.id}>
          <button type="button" className="recent-row" onClick={() => navigate('consola', a.id)}>
            <span className="dot" data-s={LEVEL_DOT[a.level]} aria-hidden="true" />
            <span className="recent-t"><b>{a.title}</b>{a.command && <code>{a.command}</code>}</span>
            <span className="recent-m">{a.source} · {ago(now, a.at)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function InicioPage() {
  const { status: s, dataNodes, activity } = useSnapshot();
  const caps = useCapabilities();
  if (!s) return null;
  const sum = capSummary(caps);
  return (
    <div className="page-in inicio">
      <PageHeader title="Inicio" sub="Cómo está el cluster y qué podés hacer ahora." />
      <Hero s={s} dataNodes={dataNodes} />
      <div className="section-h">
        <h2>Qué podés hacer ahora</h2>
        <span className="sum-chips">
          <span><i className="dot" data-s="up" aria-hidden="true" />{plural(sum.ready, 'lista', 'listas')}</span>
          {sum.starting > 0 && <span><i className="dot" data-s="starting" aria-hidden="true" />{nf(sum.starting)} arrancando</span>}
          {sum.blocked > 0 && <span><i className="dot" data-s="off" aria-hidden="true" />{plural(sum.blocked, 'no disponible', 'no disponibles')}</span>}
        </span>
      </div>
      <CapGrid caps={caps} />
      <div className="grid cols-12 inicio-bottom">
        <Panel className="span-7" title="Lo que tenés en el cluster" sub="lo que quedó guardado en el volumen">
          <Inventory s={s} caps={caps} />
        </Panel>
        <div className="span-5 inicio-side">
          <Panel title="Prácticas sugeridas" end={<button type="button" className="btn btn-sm btn-ghost" onClick={() => navigate('practicas')}><BookOpen size={13} />Todas</button>} flush>
            <Sugeridas caps={caps} />
          </Panel>
          <Panel title="Últimas acciones" end={<button type="button" className="btn btn-sm btn-ghost" onClick={() => navigate('consola')}>Consola<ArrowRight size={13} /></button>} flush>
            <Recent items={activity.slice(0, 5)} now={s.now} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
