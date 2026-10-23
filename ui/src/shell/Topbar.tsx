import { ArrowRight, CircleHelp, Play, Search, Square, SquareTerminal } from 'lucide-react';
import { useSnapshot } from '../state/store';
import { consoleOpen, helpOpen, navigate, paletteOpen, route } from '../state/ui';
import { startCluster, stopCluster } from '../state/actions';
import { clusterHealth } from '../lib/cluster';
import { navById } from './nav';
import { Dot, Kbd, Meter, Tip } from '../components/ui';
import { mbLabel, nf, uptime } from '../lib/format';

const DOT = { ok: 'up', run: 'starting', warn: 'warn', bad: 'down', off: 'off' } as const;

/** La única acción que tiene sentido según cómo está el cluster */
function TopAction() {
  const { status: s, dataNodes } = useSnapshot();
  if (!s) return null;
  const h = clusterHealth(s, dataNodes);
  if (s.phase === 'stopped') return <button type="button" className="btn btn-sm" onClick={() => startCluster()}><Play size={13} />Iniciar cluster</button>;
  if (s.phase === 'starting') return <button type="button" className="btn btn-sm" onClick={() => navigate('cluster')}>Ver arranque<ArrowRight size={13} /></button>;
  if (s.phase === 'stopping') return null;
  if (h.tone !== 'ok') return <button type="button" className="btn btn-sm" data-k={h.tone} onClick={() => navigate('cluster')}>Ver qué falla<ArrowRight size={13} /></button>;
  return <button type="button" className="btn btn-sm btn-ghost" onClick={stopCluster}><Square size={12} />Detener</button>;
}

export function Topbar() {
  const { status: s, dataNodes } = useSnapshot();
  const page = route.use();
  const cons = consoleOpen.use(), help = helpOpen.use();
  const h = clusterHealth(s, dataNodes);
  const ram = s ? s.memory.usedMb / s.memory.limitMb : 0;
  const memK = ram > .9 ? 'bad' : ram > .75 ? 'run' : undefined;
  const tip = h.issues.length ? <span className="tip-list">{h.issues.map((i, n) => <span key={n}>{i.text}</span>)}</span> : h.detail;
  return (
    <header className="top">
      <div className="top-crumb">{navById(page).title}</div>
      <Tip content={tip}>
        <span className="top-health" data-k={h.tone} tabIndex={0} role="status">
          <Dot s={DOT[h.tone]} />
          <b>{h.label}</b>
          {s?.startedAt && s.phase === 'running' && <span className="num">{uptime((s.now - s.startedAt) / 1000)}</span>}
        </span>
      </Tip>
      {s && <Tip content={<>Memoria del contenedor: {nf(s.memory.usedMb)} de {nf(s.memory.limitMb)} MB que le da Docker{s.phase === 'running' && s.yarn.totalMb > 0 ? <><br />YARN reparte {nf(s.yarn.usedMb)} de {nf(s.yarn.totalMb)} MB en contenedores</> : null}</>}>
        <span className="top-stat opt" tabIndex={0}>
          <span className="top-ram"><Meter value={s.memory.usedMb} max={s.memory.limitMb} kind={memK} label="Memoria del contenedor" /></span>
          <b className="num">{mbLabel(s.memory.usedMb)}</b>
        </span>
      </Tip>}
      <span className="top-grow" />
      <TopAction />
      <button className="search-btn" type="button" onClick={() => paletteOpen.set(true)} aria-label="Buscar o ejecutar un comando">
        <Search size={14} /><span className="txt">Buscar o ejecutar…</span><Kbd k="Ctrl+K" />
      </button>
      <Tip content={<>Consola de actividad · Ctrl+J</>}><button className="btn btn-icon btn-ghost" type="button" aria-pressed={cons} onClick={() => consoleOpen.set(v => !v)} aria-label="Consola de actividad"><SquareTerminal size={17} /></button></Tip>
      <Tip content={<>Ayuda de esta pantalla · ?</>}><button className="btn btn-icon btn-ghost" type="button" aria-pressed={help} onClick={() => helpOpen.set(v => !v)} aria-label="Ayuda"><CircleHelp size={17} /></button></Tip>
    </header>
  );
}
