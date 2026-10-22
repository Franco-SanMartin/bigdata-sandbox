/* Consola: registra cada acción con su comando, lo que entra, lo que hace y cómo sale. */
import { useMemo, useRef, useState, type PointerEvent as RPE } from 'react';
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import { useSnapshot } from '../state/store';
import { consoleFilter, consoleOpen } from '../state/ui';
import type { Activity } from '../api/types';
import { Dot, Seg } from '../components/ui';
import { clock } from '../lib/format';

const LEVEL_DOT: Record<Activity['level'], string> = { info: 'off', ok: 'up', warn: 'warn', error: 'down' };

export function ActivityList({ items, dense }: { items: Activity[]; dense?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div role="list">
      {items.map(a => {
        const isOpen = open === a.id;
        const has = a.command || a.input || a.action || a.output || a.tech;
        return (
          <div className="act" role="listitem" key={a.id}>
            <button className="act-row" type="button" aria-expanded={has ? isOpen : undefined} onClick={() => has && setOpen(isOpen ? null : a.id)} style={dense ? { height: 30 } : undefined}>
              <span className="t">{clock(a.at)}</span>
              <Dot s={LEVEL_DOT[a.level]} />
              <span className="src">{a.source}</span>
              <span className="ttl">{a.title}</span>
              <span className="cmd">{a.command ? `$ ${a.command}` : ''}{has ? (isOpen ? <ChevronDown size={12} style={{ marginLeft: 6, verticalAlign: -2 }} /> : <ChevronRight size={12} style={{ marginLeft: 6, verticalAlign: -2 }} />) : null}</span>
            </button>
            {isOpen && (
              <div className="act-d">
                <div><h4>Comando</h4><p className="mono">{a.command ? `$ ${a.command}` : '—'}</p></div>
                <div><h4>Entra</h4><p>{a.input || '—'}</p></div>
                <div><h4>Hace</h4><p>{a.action || '—'}</p></div>
                <div><h4>Sale</h4><p>{a.output || '—'}</p></div>
                {a.tech && <div className="act-tech"><h4>Log</h4><p className="mono" style={{ color: 'var(--text-3)' }}>{a.tech}</p></div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function useFilteredActivity(q: string, level: string) {
  const { activity } = useSnapshot();
  const f = consoleFilter.use();
  return useMemo(() => activity.filter(a =>
    (level === 'all' || (level === 'problems' ? a.level === 'warn' || a.level === 'error' : a.source === 'Vos')) &&
    (!f?.processId || a.processId === f.processId) && (!f?.appId || a.appId === f.appId) &&
    (!q || `${a.title} ${a.source} ${a.command || ''}`.toLowerCase().includes(q.toLowerCase()))), [activity, q, level, f]);
}

export function ConsoleDrawer() {
  const open = consoleOpen.use();
  const f = consoleFilter.use();
  const [q, setQ] = useState('');
  const [level, setLevel] = useState('all');
  const [h, setH] = useState(300);
  const drag = useRef<{ y: number; h: number } | null>(null);
  const items = useFilteredActivity(q, level);
  if (!open) return null;
  const down = (e: RPE) => { drag.current = { y: e.clientY, h }; (e.target as Element).setPointerCapture(e.pointerId); };
  const move = (e: RPE) => { if (drag.current) setH(Math.max(160, Math.min(innerHeight * .75, drag.current.h + drag.current.y - e.clientY))); };
  return (
    <section className="console" style={{ height: h }} aria-label="Consola de actividad">
      <div role="separator" aria-orientation="horizontal" aria-label="Cambiar el alto de la consola" tabIndex={0} onPointerDown={down} onPointerMove={move} onPointerUp={() => (drag.current = null)}
        onKeyDown={e => { if (e.key === 'ArrowUp') setH(x => Math.min(innerHeight * .75, x + 24)); if (e.key === 'ArrowDown') setH(x => Math.max(160, x - 24)); }}
        style={{ height: 5, marginTop: -3, cursor: 'row-resize', flex: 'none' }} />
      <div className="console-bar">
        <h2>Consola</h2>
        <span className="muted" style={{ fontSize: 12 }}>cada acción con su comando, lo que entra, lo que hace y lo que sale</span>
        {f && <button className="badge" type="button" onClick={() => consoleFilter.set(null)} style={{ border: 0, cursor: 'pointer' }}>{f.processId || f.appId}<X size={12} /></button>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <Seg value={level} onChange={setLevel} label="Filtrar" options={[{ value: 'all', label: 'Todo' }, { value: 'mine', label: 'Mis acciones' }, { value: 'problems', label: 'Problemas' }]} />
          <label className="input-search"><Search size={13} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Filtrar…" aria-label="Filtrar la actividad" /></label>
          <button className="btn btn-sm btn-icon btn-ghost" type="button" onClick={() => consoleOpen.set(false)} aria-label="Cerrar la consola"><X size={15} /></button>
        </span>
      </div>
      <div className="console-list">{items.length ? <ActivityList items={items} /> : <div className="tbl-empty">Nada para mostrar con este filtro.</div>}</div>
    </section>
  );
}
