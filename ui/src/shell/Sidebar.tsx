import { route, navigate } from '../state/ui';
import { useSnapshot } from '../state/store';
import { api } from '../api';
import { SPEED as DEMO_SPEED } from '../api/demo/speed';
import { NAV, NAV_GROUPS } from './nav';
import { Dot, Tip } from '../components/ui';
import { clusterHealth } from '../lib/cluster';

const DOT = { ok: 'up', run: 'starting', warn: 'warn', bad: 'down', off: 'off' } as const;

function Mark() {
  return (
    <svg width="20" height="20" viewBox="0 0 22 22" aria-hidden="true">
      <rect x="2.5" y="2.5" width="17" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2.5" y="8.5" width="17" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2.5" y="14.5" width="17" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="6" cy="5" r="1.1" fill="currentColor" /><circle cx="6" cy="11" r="1.1" fill="currentColor" /><circle cx="6" cy="17" r="1.1" fill="currentColor" />
    </svg>
  );
}

export function Sidebar() {
  const cur = route.use();
  const s = useSnapshot();
  const st = s.status;
  const badge = (id: string) => {
    if (!st || st.phase !== 'running') return null;
    if (id === 'hdfs' && (st.hdfs.missing || st.hdfs.underReplicated || st.hdfs.deadDataNodes || st.hdfs.staleDataNodes))
      return <span className="badge-count" data-k={st.hdfs.missing || !st.hdfs.available ? 'bad' : 'run'}>{st.hdfs.missing + st.hdfs.underReplicated || st.hdfs.deadDataNodes + st.hdfs.staleDataNodes}</span>;
    if (id === 'yarn' && st.yarn.running + st.yarn.pending) return <span className="badge-count" data-k="run">{st.yarn.running + st.yarn.pending}</span>;
    return null;
  };
  const demo = api().mode === 'demo';
  const h = clusterHealth(st, s.dataNodes);
  const versions = st ? <>Imagen {st.image.name}:{st.image.tag}<br />Hadoop {st.image.hadoop} · Hive {st.image.hive} · Spark {st.image.spark}</> : 'Esperando al contenedor';
  return (
    <aside className="side" aria-label="Navegación">
      <div className="side-brand"><span className="side-mark"><Mark /></span><b>BigData Sandbox</b><span className="tag">full</span></div>
      <nav className="side-nav">
        {NAV_GROUPS.map(g => (
          <div className="nav-group" key={g} role="group" aria-label={g}>
            <span className="nav-label">{g}</span>
            {NAV.filter(n => n.group === g).map(n => (
              <Tip key={n.id} content={<>{n.label} <span style={{ opacity: .6 }}>· G {n.key.toUpperCase()}</span></>} side="right">
                <a href={`#${n.id}`} className="nav-item" aria-current={cur === n.id ? 'page' : undefined} onClick={e => { e.preventDefault(); navigate(n.id); }}>
                  <n.icon size={16} strokeWidth={1.75} aria-hidden="true" />
                  <span className="nav-text">{n.label}</span>
                  <span className="nav-end">{badge(n.id)}</span>
                </a>
              </Tip>
            ))}
          </div>
        ))}
      </nav>
      <div className="side-foot">
        <button type="button" className="side-status" data-k={h.tone} onClick={() => navigate('cluster')} aria-label={`Estado del cluster: ${h.label}. Ver el cluster`}>
          <Dot s={DOT[h.tone]} />
          <span className="side-status-t"><b>{h.label}</b><span>{h.detail}</span></span>
        </button>
        <Tip content={versions} side="right">
          <span className="side-meta" tabIndex={0}>
            {demo ? <span className="side-demo">Demo · ×{DEMO_SPEED}</span> : <span className="side-live">Contenedor</span>}
            <span className="mono">{st ? `${st.image.tag}` : '—'}</span>
          </span>
        </Tip>
      </div>
    </aside>
  );
}
