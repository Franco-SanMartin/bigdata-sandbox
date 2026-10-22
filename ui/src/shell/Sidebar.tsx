import { route, navigate } from '../state/ui';
import { useSnapshot } from '../state/store';
import { api } from '../api';
import { DEMO_SPEED } from '../api/demo';
import { NAV } from './nav';
import { Dot, Tip } from '../components/ui';

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
      return <span className="badge-count" data-k={st.hdfs.missing || st.hdfs.deadDataNodes ? 'bad' : 'run'}>{st.hdfs.missing + st.hdfs.underReplicated || st.hdfs.deadDataNodes + st.hdfs.staleDataNodes}</span>;
    if (id === 'yarn' && st.yarn.running + st.yarn.pending) return <span className="badge-count" data-k="run">{st.yarn.running + st.yarn.pending}</span>;
    return null;
  };
  const groups = ['Operación', 'Datos', 'Sistema'] as const;
  const demo = api().mode === 'demo';
  return (
    <aside className="side" aria-label="Navegación">
      <div className="side-brand"><Mark /><b>BigData Sandbox</b><span className="tag">full</span></div>
      <nav className="side-nav">
        {groups.map(g => (
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
        <span className="mode"><Dot s={demo ? 'warn' : 'up'} />{demo ? `Modo demo · tiempos ×${DEMO_SPEED}` : 'Conectado al contenedor'}</span>
        <span>{st ? `${st.image.name}:${st.image.tag}` : ''}</span>
        <span>Hadoop {st?.image.hadoop} · Hive {st?.image.hive} · Spark {st?.image.spark}</span>
      </div>
    </aside>
  );
}
