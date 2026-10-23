/* Inicio: en qué estado está el cluster, la única acción que importa ahora y qué se puede hacer
   (y qué no, por qué, y el botón que lo arregla). Es lo primero que ve quien abre la interfaz. */
import { ArrowRight, BookOpen, Play, Settings, Square } from 'lucide-react';
import { useSnapshot } from '../state/store';
import { navigate } from '../state/ui';
import { startCluster, stopCluster } from '../state/actions';
import { runFix, useCapabilities } from '../state/capabilities';
import { CAP_INFO, capSummary, type Capability } from '../lib/capabilities';
import { ago, plural } from '../lib/format';
import { bootLine, Chip, EmptyState, PageHeader, PageSkeleton, Panel, type Tone } from '../components/base';
import type { ClusterStatus } from '../api/types';

const CAP_TONE: Record<Capability['state'], Tone> = { ready: 'ok', starting: 'run', blocked: 'off' };
const CAP_LABEL: Record<Capability['state'], string> = { ready: 'listo', starting: 'arrancando', blocked: 'no disponible' };

function Hero({ s }: { s: ClusterStatus }) {
  const caps = useCapabilities();
  const sum = capSummary(caps);
  const down = s.processes.filter(p => p.state === 'down');
  const up = s.processes.filter(p => p.state === 'up').length;
  const total = s.processes.filter(p => p.state !== 'off').length;
  let lamp: Tone, title: string, sub: string, actions;
  if (s.phase === 'stopped') {
    lamp = 'off'; title = 'El cluster está apagado';
    sub = 'Prendelo para usar HDFS, YARN, Hive y el resto. Si querés cambiar nodos o servicios, configuralo antes.';
    actions = <>
      <button type="button" className="btn btn-primary" onClick={() => startCluster()}><Play size={15} />Iniciar cluster</button>
      <button type="button" className="btn" onClick={() => navigate('config')}><Settings size={15} />Configurar</button>
    </>;
  } else if (s.phase === 'starting') {
    lamp = 'run'; title = 'El cluster está arrancando';
    sub = bootLine(s.boot, s.now) ?? 'Levantando los procesos en orden.';
    actions = <button type="button" className="btn" onClick={() => navigate('cluster')}>Ver el arranque<ArrowRight size={15} /></button>;
  } else if (s.phase === 'stopping') {
    lamp = 'run'; title = 'El cluster se está apagando'; sub = 'Los datos quedan en el volumen.'; actions = null;
  } else {
    lamp = down.length ? 'bad' : 'ok';
    title = down.length ? `${plural(down.length, 'proceso caído', 'procesos caídos')}` : 'El cluster está andando';
    sub = down.length
      ? `${down.map(p => p.name).join(', ')}. Algunas cosas no van a andar hasta que vuelvan.`
      : `${up} de ${total} procesos arriba · ${sum.ready} de ${sum.ready + sum.starting + sum.blocked} cosas listas para usar`;
    actions = <>
      <button type="button" className="btn" onClick={() => navigate('cluster')}>Ver el cluster<ArrowRight size={15} /></button>
      <button type="button" className="btn btn-ghost" onClick={() => stopCluster()}><Square size={14} />Detener</button>
    </>;
  }
  return (
    <section className="hero" aria-label="Estado del cluster">
      <span className="hero-lamp" data-k={lamp} aria-hidden="true" />
      <div className="hero-t"><strong>{title}</strong><span>{sub}</span></div>
      {actions && <div className="hero-actions">{actions}</div>}
    </section>
  );
}

function CapGrid() {
  const caps = useCapabilities();
  return (
    <div className="capgrid">
      {CAP_INFO.map(i => {
        const c = caps[i.id];
        return (
          <article key={i.id} className="capcard" data-k={c.state} aria-label={`${i.label}: ${CAP_LABEL[c.state]}`}>
            <div className="capcard-h"><h3>{i.label}</h3><Chip k={CAP_TONE[c.state]}>{CAP_LABEL[c.state]}</Chip></div>
            <p>{i.what}</p>
            {c.state !== 'ready' && c.reason && <span className="capcard-why">{c.reason}</span>}
            <div className="capcard-f">
              {c.state === 'blocked' && c.fix && c.fix.kind !== 'wait'
                ? <button type="button" className="btn btn-sm" onClick={() => runFix(c.fix)}>{c.fixLabel}</button>
                : <button type="button" className="btn btn-sm" onClick={() => navigate(i.page)} disabled={c.state !== 'ready'}>Abrir<ArrowRight size={13} /></button>}
              {i.guide && <span className="muted mono" style={{ marginLeft: 'auto', fontSize: 11 }} title="Guía de la materia">guía {i.guide}</span>}
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function InicioPage() {
  const { status: s, activity } = useSnapshot();
  if (!s) return <PageSkeleton />;
  const last = activity.slice(0, 6);
  return (
    <div className="page-in">
      <PageHeader title="Inicio" sub="El estado del cluster y qué podés hacer ahora." />
      <Hero s={s} />
      <div className="section-h"><h2>Qué podés hacer ahora</h2><span>cada tarjeta dice si está lista y, si no, qué la arregla</span></div>
      <CapGrid />
      <div className="section-h"><h2>Para empezar</h2></div>
      <Panel title="Prácticas guiadas" end={<button type="button" className="btn btn-sm" onClick={() => navigate('practicas')}><BookOpen size={13} />Ver prácticas</button>}>
        <p className="muted">Recorridos paso a paso por HDFS, MapReduce, Hive, Sqoop, Spark y alta disponibilidad, con el comando equivalente de cada paso.</p>
      </Panel>
      <Panel title="Últimas acciones" end={<button type="button" className="btn btn-sm btn-ghost" onClick={() => navigate('consola')}>Abrir la consola<ArrowRight size={13} /></button>}>
        {last.length
          ? <ul className="es-list" style={{ listStyle: 'none', paddingLeft: 0 }}>{last.map(a => (
              <li key={a.id}><span className="dot" data-s={a.level === 'error' ? 'bad' : a.level === 'warn' ? 'run' : 'ok'} aria-hidden="true" /> <b>{a.source}</b> · {a.title} <span className="muted">· {ago(s.now, a.at)}</span></li>
            ))}</ul>
          : <EmptyState compact title="Todavía no pasó nada">Lo que hagas (y lo que haga el cluster) aparece acá y en la consola, con el comando exacto.</EmptyState>}
      </Panel>
    </div>
  );
}
