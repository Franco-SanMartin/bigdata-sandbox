import { useState } from 'react';
import { Search } from 'lucide-react';
import { ActivityList, useFilteredActivity } from '../shell/ConsoleDrawer';
import { Seg } from '../components/ui';

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
