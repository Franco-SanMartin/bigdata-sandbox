import { useState } from 'react';
import { Search } from 'lucide-react';
import { navigate, type PageId } from '../state/ui';
import { ActivityList, useFilteredActivity } from '../shell/ConsoleDrawer';
import { navById } from '../shell/nav';
import { HELP } from '../help/content';
import { Empty, Seg } from '../components/ui';

export function ConsolePage() {
  const [q, setQ] = useState('');
  const [level, setLevel] = useState('all');
  const items = useFilteredActivity(q, level);
  return (
    <div className="page-in">
      <div className="page-head"><div><h1>Consola</h1><p>Todo lo que pasó en el cluster: el comando exacto, lo que entró, lo que hizo y lo que salió. Tocá una fila para ver el detalle.</p></div></div>
      <section className="panel">
        <div className="toolbar">
          <label className="input-search"><Search size={13} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar en la actividad" aria-label="Buscar en la actividad" /></label>
          <Seg value={level} onChange={setLevel} label="Filtrar" options={[{ value: 'all', label: 'Todo' }, { value: 'mine', label: 'Mis acciones' }, { value: 'problems', label: 'Problemas' }]} />
          <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>{items.length} eventos</span>
        </div>
        <div className="panel-b flush">{items.length ? <ActivityList items={items} /> : <div className="tbl-empty">Nada para mostrar con este filtro.</div>}</div>
      </section>
    </div>
  );
}

/** Módulos que llegan en la próxima entrega */
export function PendingPage({ id }: { id: PageId }) {
  const n = navById(id);
  return (
    <div className="page-in">
      <div className="page-head"><div><h1>{n.title}</h1><p>{HELP[id].intro}</p></div></div>
      <section className="panel">
        <Empty icon={<n.icon size={20} />} title="Este módulo llega en la próxima entrega" action={<button className="btn" type="button" onClick={() => navigate('cluster')}>Volver a Cluster</button>}>
          Primero se aprueba el armazón de la app y la pantalla de Cluster; después se suman HDFS, YARN, el pipeline, los datos y ML con el mismo sistema.
        </Empty>
      </section>
    </div>
  );
}
