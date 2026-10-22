import { CircleHelp, Search, SquareTerminal } from 'lucide-react';
import { useStatus } from '../state/store';
import { consoleOpen, helpOpen, paletteOpen, route } from '../state/ui';
import { navById } from './nav';
import { Dot, Kbd, Meter, Tip } from '../components/ui';
import { mbLabel, nf, uptime } from '../lib/format';

const PHASE = { stopped: ['off', 'Apagado'], starting: ['starting', 'Arrancando'], running: ['up', 'En marcha'], stopping: ['stopping', 'Apagando'] } as const;

export function Topbar() {
  const s = useStatus();
  const page = route.use();
  const cons = consoleOpen.use(), help = helpOpen.use();
  const [dot, label] = s ? PHASE[s.phase] : ['off', 'Conectando'];
  const problems = s && s.phase === 'running' ? s.hdfs.missing + s.hdfs.deadDataNodes + s.processes.filter(p => p.state === 'down').length : 0;
  const warn = s && s.phase === 'running' && (s.hdfs.underReplicated || s.hdfs.staleDataNodes || !s.hdfs.available);
  const memK = s ? (s.memory.usedMb / s.memory.limitMb > .9 ? 'bad' : s.memory.usedMb / s.memory.limitMb > .75 ? 'run' : undefined) : undefined;
  return (
    <header className="top">
      <div className="top-crumb">{navById(page).title}</div>
      <span className="top-sep" />
      <Tip content={s?.phase === 'running' ? (problems ? `${problems} problema${problems > 1 ? 's' : ''}: mirá Cluster y HDFS` : warn ? 'Hay bloques con menos copias de las pedidas' : 'Todo responde') : undefined}>
        <span className="top-stat" tabIndex={0}>
          <Dot s={problems ? 'down' : warn ? 'warn' : dot} />
          <b>{problems ? 'Con fallas' : label}</b>
          {s?.startedAt && s.phase === 'running' && <span className="num">{uptime((s.now - s.startedAt) / 1000)}</span>}
        </span>
      </Tip>
      {s && <>
        <span className="top-sep opt" />
        <Tip content={`Memoria del contenedor: ${nf(s.memory.usedMb)} MB de ${nf(s.memory.limitMb)} MB que le da Docker`}>
          <span className="top-stat opt" tabIndex={0} style={{ gap: 10 }}>RAM <span style={{ width: 72 }}><Meter value={s.memory.usedMb} max={s.memory.limitMb} kind={memK} label="Memoria del contenedor" /></span><b className="num">{mbLabel(s.memory.usedMb)}</b></span>
        </Tip>
        {s.phase === 'running' && s.yarn.totalMb > 0 && <Tip content={`YARN: ${nf(s.yarn.usedMb)} de ${nf(s.yarn.totalMb)} MB repartidos en contenedores`}>
          <span className="top-stat opt" tabIndex={0}>YARN <b className="num">{nf(s.yarn.usedMb)} / {nf(s.yarn.totalMb)} MB</b></span>
        </Tip>}
      </>}
      <span className="top-grow" />
      <button className="search-btn" type="button" onClick={() => paletteOpen.set(true)} aria-label="Buscar o ejecutar un comando">
        <Search size={14} /><span className="txt">Buscar o ejecutar…</span><Kbd k="Ctrl+K" />
      </button>
      <Tip content={<>Consola de actividad · Ctrl+J</>}><button className="btn btn-icon btn-ghost" type="button" aria-pressed={cons} onClick={() => consoleOpen.set(v => !v)} aria-label="Consola de actividad"><SquareTerminal size={17} /></button></Tip>
      <Tip content={<>Ayuda de esta pantalla · ?</>}><button className="btn btn-icon btn-ghost" type="button" aria-pressed={help} onClick={() => helpOpen.set(v => !v)} aria-label="Ayuda"><CircleHelp size={17} /></button></Tip>
    </header>
  );
}
