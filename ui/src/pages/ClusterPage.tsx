import { useMemo, useState, type ReactNode } from 'react';
import { DropdownMenu } from 'radix-ui';
import { Activity as ActivityIcon, ExternalLink, FileCode2, MoreHorizontal, Play, Power, RotateCcw, Search, Settings2, Zap } from 'lucide-react';
import type { ClusterStatus, DataNode, Process } from '../api/types';
import { useSnapshot } from '../state/store';
import { composeOpen, consoleFilter, consoleOpen, navigate } from '../state/ui';
import { applyConfig, processAction, startCluster, stopCluster } from '../state/actions';
import { ArchitectureMap } from '../widgets/ArchitectureMap';
import { ArchitecturePreview } from '../widgets/ArchitecturePreview';
import { BootView } from '../widgets/BootView';
import { ActivityList } from '../shell/ConsoleDrawer';
import { DataTable, type Column } from '../components/DataTable';
import { Dot, Meter, Seg, Sparkline, Tip } from '../components/ui';
import { ago, clock, mbLabel, nf, plural, uptime } from '../lib/format';
import { blockSizeLabel, configSummary, estimateRam } from '../lib/cluster';

const STATE_LABEL: Record<string, string> = { up: 'arriba', starting: 'arrancando', stopping: 'apagando', down: 'abajo', off: 'apagado' };
const LAYER_LABEL = { hdfs: 'HDFS', yarn: 'YARN', servicios: 'Servicios' } as const;

export function ClusterPage() {
  const snap = useSnapshot();
  const s = snap.status;
  if (!s) return null;
  return (
    <div className="page-in">
      <Header s={s} />
      {s.phase === 'stopped' && <Stopped s={s} />}
      {(s.phase === 'starting' || (s.phase === 'stopping' && !s.startedAt)) && s.boot && <Starting s={s} />}
      {(s.phase === 'running' || (s.phase === 'stopping' && s.startedAt)) && <Running s={s} dataNodes={snap.dataNodes} />}
    </div>
  );
}

function Header({ s }: { s: ClusterStatus }) {
  const sub = s.phase === 'running' ? `${configSummary(s.config)} · en marcha desde las ${clock(s.startedAt!)}`
    : s.phase === 'starting' ? `${s.boot?.kind === 'first' ? 'Primer arranque' : 'Arrancando'} · ${configSummary(s.config)}`
    : s.phase === 'stopping' ? 'Apagando los procesos en orden' : `Apagado · la próxima vez arranca con: ${configSummary(s.config)}`;
  return (
    <div className="page-head">
      <div><h1>Cluster</h1><p>{sub}</p></div>
      <div className="page-actions">
        <button className="btn" type="button" onClick={() => composeOpen.set(true)}><FileCode2 size={15} />docker-compose.yml</button>
        {s.phase === 'stopped' && <>
          <button className="btn" type="button" onClick={() => navigate('config')}><Settings2 size={15} />Configurar</button>
          <button className="btn btn-primary" type="button" onClick={() => startCluster()}><Play size={15} />Iniciar cluster</button>
        </>}
        {s.phase === 'running' && <>
          <button className="btn" type="button" onClick={() => applyConfig(s.config)}><RotateCcw size={15} />Reiniciar</button>
          <button className="btn btn-danger" type="button" onClick={stopCluster}><Power size={15} />Detener</button>
        </>}
        {(s.phase === 'starting' || s.phase === 'stopping') && <span className="badge" data-k="run"><Dot s="running" />{s.phase === 'starting' ? 'Arrancando' : 'Apagando'}</span>}
      </div>
    </div>
  );
}

/* ---------- Apagado ---------- */
function Stopped({ s }: { s: ClusterStatus }) {
  const est = estimateRam(s.config);
  const k = est.totalMb > est.limitMb ? 'bad' : est.totalMb > est.limitMb * .85 ? 'run' : 'ok';
  const rows: [string, string][] = [['DataNodes', String(s.config.datanodes)], ['Réplicas por bloque', String(s.config.replication)], ['Tamaño de bloque', blockSizeLabel(s.config.blockSize)], ['NameNodes', s.config.namenodes > 1 ? `${s.config.namenodes} (alta disponibilidad)` : '1 + Secondary'], ['Servicios', s.config.services], ['MongoDB', s.config.mongodb ? 'sí' : 'no'], ['JupyterLab', s.config.jupyter ? 'sí' : 'no']];
  return (
    <div className="grid cols-12">
      <section className="panel span-7" aria-labelledby="h-arch">
        <div className="panel-h"><h2 id="h-arch">Arquitectura</h2><span className="sub">lo que va a levantar esta configuración</span></div>
        <div className="panel-b"><ArchitecturePreview config={s.config} /></div>
      </section>
      <div className="span-5" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <section className="panel" aria-labelledby="h-cfg">
          <div className="panel-h"><h2 id="h-cfg">Configuración</h2><span className="end"><button className="btn btn-sm btn-ghost" type="button" onClick={() => navigate('config')}>Editar</button></span></div>
          <div className="panel-b"><dl className="kv">{rows.map(([a, b]) => <div key={a} style={{ display: 'contents' }}><dt>{a}</dt><dd>{b}</dd></div>)}</dl></div>
        </section>
        <section className="panel" aria-labelledby="h-ram">
          <div className="panel-h"><h2 id="h-ram">Memoria</h2><span className="sub">estimada para Docker</span></div>
          <div className="panel-b" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="ram-big">{nf(est.totalMb / 1024, 1)}<small>GB de {nf(est.limitMb / 1024, 1)}</small></div>
            <Meter value={est.totalMb} max={est.limitMb * 1.25} mark={est.limitMb} kind={k} label="RAM estimada" />
            <p className="muted" style={{ fontSize: 12 }}>{k === 'ok' ? 'Entra con margen.' : k === 'run' ? 'Entra justo: cerrá programas pesados antes de arrancar.' : 'No entra: bajá DataNodes o servicios, o dale más memoria a Docker.'}</p>
          </div>
        </section>
        {s.volumeNameNodes == null && <div className="callout"><Play size={14} /><span><b>Primer arranque:</b> formatea HDFS y carga las bases de ejemplo. Tarda unos 2 minutos; después, menos de uno.</span></div>}
      </div>
    </div>
  );
}

/* ---------- Arrancando ---------- */
function Starting({ s }: { s: ClusterStatus }) {
  return (
    <div className="grid cols-12">
      <section className="panel span-7" aria-labelledby="h-boot">
        <div className="panel-h"><h2 id="h-boot">Arranque</h2><span className="sub">paso por paso, con el comando y el log de cada uno</span></div>
        <div className="panel-b"><BootView boot={s.boot!} now={s.now} /></div>
      </section>
      <section className="panel span-5" aria-labelledby="h-arch2">
        <div className="panel-h"><h2 id="h-arch2">Arquitectura</h2><span className="sub">se prende cada proceso cuando responde</span></div>
        <div className="panel-b"><ArchitectureMap processes={s.processes} /></div>
      </section>
    </div>
  );
}

/* ---------- En marcha ---------- */
function Running({ s, dataNodes }: { s: ClusterStatus; dataNodes: DataNode[] }) {
  const [sel, setSel] = useState<string | null>('nn1');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'problems' | 'hdfs' | 'yarn' | 'servicios'>('all');
  const snap = useSnapshot();
  const procs = s.processes;
  const up = procs.filter(p => p.state === 'up').length;
  const problems = procs.filter(p => p.state === 'down').length + s.hdfs.staleDataNodes;
  const rows = useMemo(() => procs.filter(p =>
    (filter === 'all' || (filter === 'problems' ? p.state !== 'up' || dataNodes.find(d => `dn${d.id}` === p.id && d.state !== 'live') : p.layer === filter)) &&
    (!q || `${p.name} ${p.id} ${p.ports.join(' ')}`.toLowerCase().includes(q.toLowerCase()))), [procs, filter, q, dataNodes]);
  const selected = procs.find(p => p.id === sel) || procs[0];
  const memK = s.memory.usedMb / s.memory.limitMb > .9 ? 'bad' : s.memory.usedMb / s.memory.limitMb > .75 ? 'run' : undefined;
  const columns: Column<Process>[] = [
    { id: 'name', header: 'Proceso', sort: p => p.name, cell: p => <span className="cell-name"><Dot s={dnState(p, dataNodes)} /><b>{p.name}</b><span className="muted mono">{p.id}</span></span> },
    { id: 'layer', header: 'Capa', sort: p => p.layer, cell: p => <span className="dim">{LAYER_LABEL[p.layer]}</span> },
    { id: 'state', header: 'Estado', sort: p => p.state, cell: p => <StateText p={p} dataNodes={dataNodes} now={s.now} /> },
    { id: 'ports', header: 'Puertos', cell: p => <span className="mono dim">{p.webUrl ? <a className="link" href={p.webUrl} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}>{p.ports[0]}</a> : p.ports[0]}{p.ports.slice(1).map(x => ` · ${x}`)}</span> },
    { id: 'pid', header: 'PID', align: 'right', sort: p => p.pid || 0, cell: p => <span className="mono dim">{p.pid ?? '—'}</span> },
    { id: 'mem', header: 'Memoria', align: 'right', sort: p => p.memMb || 0, cell: p => p.memMb ? mbLabel(p.memMb) : <span className="muted">—</span> },
    { id: 'up', header: 'Arriba', align: 'right', sort: p => -(p.upSince || 0), cell: p => p.upSince && p.state === 'up' ? <span className="dim">{uptime((s.now - p.upSince) / 1000)}</span> : <span className="muted">—</span> },
    { id: 'act', header: '', align: 'right', width: 48, cell: p => <RowMenu p={p} /> },
  ];
  return (
    <>
      <div className="stats">
        <Stat label="Procesos" value={<>{up}<small>/ {procs.length}</small></>} sub={problems ? `${problems} con problemas` : 'todos responden'} k={problems ? 'bad' : undefined} />
        <Stat label="DataNodes vivos" value={<>{s.hdfs.liveDataNodes}<small>/ {dataNodes.length}</small></>} sub={s.hdfs.staleDataNodes ? `${s.hdfs.staleDataNodes} sin latidos` : s.hdfs.deadDataNodes ? `${s.hdfs.deadDataNodes} muerto${s.hdfs.deadDataNodes > 1 ? 's' : ''}` : `bloque ${blockSizeLabel(s.config.blockSize)} · réplica ${s.config.replication}`} k={s.hdfs.deadDataNodes ? 'bad' : s.hdfs.staleDataNodes ? 'run' : undefined} />
        <Stat label="Bloques" value={nf(s.hdfs.blocks)} sub={s.hdfs.missing ? `${s.hdfs.missing} perdidos` : s.hdfs.underReplicated ? `${s.hdfs.underReplicated} con copias de menos` : `${nf(s.hdfs.replicas)} copias · ${plural(s.hdfs.files, 'archivo')}`} k={s.hdfs.missing ? 'bad' : s.hdfs.underReplicated ? 'run' : undefined} />
        <Stat label="YARN" value={s.yarn.totalMb ? <>{nf(s.yarn.usedMb)}<small>/ {nf(s.yarn.totalMb)} MB</small></> : '—'} sub={s.yarn.totalMb ? `${s.yarn.running} corriendo · ${s.yarn.pending} en cola` : 'apagado (SERVICIOS=hdfs)'} />
        <Stat label="Memoria" value={<>{nf(s.memory.usedMb / 1024, 1)}<small>/ {nf(s.memory.limitMb / 1024, 1)} GB</small></>} sub={memK === 'bad' ? 'casi sin memoria' : `estimado ${nf(s.memory.estimateMb / 1024, 1)} GB`} k={memK} spark={s.memory.history.map(h => ({ t: h.t, v: h.usedMb }))} max={s.memory.limitMb} />
        <Stat label="En marcha" value={uptime((s.now - (s.startedAt || s.now)) / 1000)} sub={`desde las ${clock(s.startedAt || s.now)}`} />
      </div>
      {(s.hdfs.missing > 0 || !s.hdfs.available || s.hdfs.staleDataNodes > 0) && <Alerts s={s} dataNodes={dataNodes} />}
      <div className="grid cols-12">
        <section className="panel span-8" aria-labelledby="h-arch3">
          <div className="panel-h"><h2 id="h-arch3">Arquitectura</h2><span className="sub">elegí un proceso para ver su detalle</span></div>
          <div className="panel-b"><ArchitectureMap processes={procs} dataNodes={dataNodes} selected={selected?.id} onSelect={setSel} now={s.now} /></div>
        </section>
        <section className="panel span-4" aria-labelledby="h-det">
          <div className="panel-h"><h2 id="h-det">Detalle</h2></div>
          <div className="panel-b">{selected && <ProcessDetail p={selected} s={s} dataNodes={dataNodes} />}</div>
        </section>
      </div>
      <section className="panel" aria-labelledby="h-procs">
        <div className="panel-h"><h2 id="h-procs">Procesos</h2><span className="sub">{rows.length} de {procs.length}</span></div>
        <div className="toolbar">
          <label className="input-search"><Search size={13} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nombre o puerto" aria-label="Buscar procesos" /></label>
          <Seg value={filter} onChange={setFilter} label="Filtrar procesos" options={[{ value: 'all', label: 'Todos' }, { value: 'problems', label: <>Con problemas{problems ? <span className="badge-count" data-k="bad">{problems}</span> : null}</> }, { value: 'hdfs', label: 'HDFS' }, { value: 'yarn', label: 'YARN' }, { value: 'servicios', label: 'Servicios' }]} />
        </div>
        <DataTable label="Procesos del cluster" columns={columns} rows={rows} rowKey={p => p.id} onRowClick={p => setSel(p.id)} selected={selected?.id} empty="Ningún proceso coincide con el filtro." />
      </section>
      <section className="panel" aria-labelledby="h-act">
        <div className="panel-h"><h2 id="h-act">Actividad reciente</h2><span className="end"><button className="btn btn-sm btn-ghost" type="button" onClick={() => { consoleFilter.set(null); consoleOpen.set(true); }}><ActivityIcon size={14} />Abrir la consola</button></span></div>
        <div className="panel-b flush"><ActivityList items={snap.activity.slice(0, 8)} /></div>
      </section>
    </>
  );
}

function dnState(p: Process, dns: DataNode[]) {
  const d = p.kind === 'datanode' ? dns.find(x => `dn${x.id}` === p.id) : null;
  if (d?.state === 'stale') return 'warn';
  return p.state;
}
function StateText({ p, dataNodes, now }: { p: Process; dataNodes: DataNode[]; now: number }) {
  const d = p.kind === 'datanode' ? dataNodes.find(x => `dn${x.id}` === p.id) : null;
  if (d?.state === 'stale') return <span style={{ color: 'var(--run)' }}>sin latidos · muerto en {Math.max(0, Math.ceil(((d.deadAt || 0) - now) / 1000))} s</span>;
  if (d?.state === 'dead') return <span style={{ color: '#F2867F' }}>muerto</span>;
  return <span className={p.state === 'up' ? 'dim' : undefined} style={p.state === 'down' ? { color: '#F2867F' } : p.state === 'starting' || p.state === 'stopping' ? { color: 'var(--run)' } : undefined}>{STATE_LABEL[p.state]}{p.role ? ` · ${p.role === 'active' ? 'activo' : 'en espera'}` : ''}</span>;
}

function RowMenu({ p }: { p: Process }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild><button className="btn btn-sm btn-icon btn-ghost" type="button" aria-label={`Acciones de ${p.name}`} onClick={e => e.stopPropagation()}><MoreHorizontal size={16} /></button></DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" align="end" sideOffset={4} onClick={e => e.stopPropagation()}>
          <DropdownMenu.Item className="menu-item" disabled={!p.webUrl || p.state !== 'up'} onSelect={() => window.open(p.webUrl, '_blank', 'noopener')}><ExternalLink size={14} />Abrir su página<span className="end">{p.webUrl?.replace('http://localhost', '')}</span></DropdownMenu.Item>
          <DropdownMenu.Item className="menu-item" onSelect={() => { consoleFilter.set({ processId: p.id }); consoleOpen.set(true); }}><ActivityIcon size={14} />Ver su actividad</DropdownMenu.Item>
          {p.controllable && <DropdownMenu.Separator className="menu-sep" />}
          {p.controllable && (p.state === 'up'
            ? <DropdownMenu.Item className="menu-item danger" onSelect={() => processAction(p, 'stop')}><Power size={14} />Apagar</DropdownMenu.Item>
            : <DropdownMenu.Item className="menu-item" disabled={p.state === 'starting' || p.state === 'stopping'} onSelect={() => processAction(p, 'start')}><Zap size={14} />Prender</DropdownMenu.Item>)}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ProcessDetail({ p, s, dataNodes }: { p: Process; s: ClusterStatus; dataNodes: DataNode[] }) {
  const d = p.kind === 'datanode' ? dataNodes.find(x => `dn${x.id}` === p.id) : null;
  const facts: [string, ReactNode][] = [
    ['Estado', <StateText p={p} dataNodes={dataNodes} now={s.now} />],
    ['Capa', LAYER_LABEL[p.layer]],
    ['Puertos', <span className="mono">{p.ports.join(' · ')}</span>],
  ];
  if (p.webUrl) facts.push(['Página', <a href={p.webUrl} target="_blank" rel="noopener" className="mono">{p.webUrl.replace('http://', '')}</a>]);
  if (p.pid) facts.push(['PID', <span className="mono">{p.pid}</span>]);
  if (p.memMb) facts.push(['Memoria', mbLabel(p.memMb)]);
  if (p.upSince && p.state === 'up') facts.push(['Arriba desde', `${clock(p.upSince)} (${ago(s.now, p.upSince)})`]);
  if (d) {
    facts.push(['Bloques', `${nf(d.blocks)} · ${mbLabel(d.usedMb)}`]);
    facts.push(['Último latido', d.lastHeartbeat ? ago(s.now, d.lastHeartbeat) : '—']);
    facts.push(['Carpeta', <span className="mono">/hadoop/dfs/{p.id}</span>]);
  }
  return (
    <div className="pdetail">
      <div className="pdetail-h"><Dot s={dnState(p, dataNodes)} /><h3>{p.name}</h3><span className="muted mono">{p.id}</span></div>
      <dl className="kv">{facts.map(([a, b]) => <div key={a} style={{ display: 'contents' }}><dt>{a}</dt><dd>{b}</dd></div>)}</dl>
      <div className="pdetail-actions">
        {p.webUrl && <a className="btn btn-sm" href={p.webUrl} target="_blank" rel="noopener" aria-disabled={p.state !== 'up'}><ExternalLink size={14} />Abrir</a>}
        <button className="btn btn-sm" type="button" onClick={() => { consoleFilter.set({ processId: p.id }); consoleOpen.set(true); }}><ActivityIcon size={14} />Actividad</button>
        {p.controllable ? (p.state === 'up'
          ? <button className="btn btn-sm btn-danger" type="button" onClick={() => processAction(p, 'stop')}><Power size={14} />Apagar</button>
          : <button className="btn btn-sm" type="button" disabled={p.state === 'starting' || p.state === 'stopping'} onClick={() => processAction(p, 'start')}><Zap size={14} />Prender</button>)
          : <Tip content="Este proceso se maneja junto con el cluster: se prende y se apaga con él."><span className="muted" style={{ fontSize: 12, alignSelf: 'center' }} tabIndex={0}>Se maneja con el cluster</span></Tip>}
      </div>
    </div>
  );
}

function Alerts({ s, dataNodes }: { s: ClusterStatus; dataNodes: DataNode[] }) {
  const stale = dataNodes.filter(d => d.state === 'stale');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {!s.hdfs.available && <div className="callout" data-k="bad"><Power size={14} /><span><b>HDFS no responde.</b> {s.config.namenodes > 1 ? 'No hay NameNode activo: ZooKeeper está eligiendo uno nuevo.' : 'El NameNode está apagado. Los datos siguen en los DataNodes; prendelo para volver.'}</span></div>}
      {stale.map(d => <div key={d.id} className="callout" data-k="run"><Power size={14} /><span><b>DataNode {d.id} no manda latidos.</b> El NameNode lo da por muerto en {Math.max(0, Math.ceil(((d.deadAt || 0) - s.now) / 1000))} s; ahí copia sus bloques a otros nodos.</span></div>)}
      {s.hdfs.missing > 0 && <div className="callout" data-k="bad"><Power size={14} /><span><b>{plural(s.hdfs.missing, 'bloque perdido', 'bloques perdidos')}.</b> Su única copia estaba en un DataNode muerto. Vuelven si lo prendés de nuevo.</span></div>}
    </div>
  );
}

function Stat({ label, value, sub, k, spark, max }: { label: string; value: ReactNode; sub: string; k?: 'bad' | 'run'; spark?: { t: number; v: number }[]; max?: number }) {
  return (
    <div className="stat" data-k={k}>
      <span className="stat-l">{label}</span>
      <span className="stat-v">{value}</span>
      <span className="stat-s">{sub}</span>
      {spark && spark.length > 1 && <Sparkline data={spark} max={max} width={72} height={24} />}
    </div>
  );
}
