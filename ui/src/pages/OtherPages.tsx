import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUpRight, Check, Copy, Search, SquareTerminal, X } from 'lucide-react';
import type { Activity } from '../api/types';
import { useSnapshot } from '../state/store';
import { consoleFilter, navigate, setRouteArg, useRouteParts } from '../state/ui';
import { Dot, Seg } from '../components/ui';
import { EmptyState, PageHeader } from '../components/base';
import { clock } from '../lib/format';

const LEVEL_DOT: Record<Activity['level'], string> = { info: 'off', ok: 'up', warn: 'warn', error: 'down' };
const LEVEL_LABEL: Record<Activity['level'], string> = { info: 'Info', ok: 'Listo', warn: 'Aviso', error: 'Error' };
type Level = 'all' | 'problems' | Activity['level'];

/* La consola: a la izquierda todo lo que pasó, filtrable por quién y por gravedad; a la derecha el
   detalle del evento elegido con el recorrido completo (comando → entra → hace → sale). */
export function ConsolePage() {
  const { activity } = useSnapshot();
  const pin = consoleFilter.use();
  const [selArg] = useRouteParts();
  const [q, setQ] = useState('');
  const [level, setLevel] = useState<Level>('all');
  const [source, setSource] = useState('all');
  const listRef = useRef<HTMLDivElement>(null);

  const sources = useMemo(() => {
    const m = new Map<string, number>();
    activity.forEach(a => m.set(a.source, (m.get(a.source) || 0) + 1));
    return [...m.entries()].sort((a, b) => (a[0] === 'Vos' ? -1 : b[0] === 'Vos' ? 1 : b[1] - a[1]));
  }, [activity]);
  const problems = activity.filter(a => a.level === 'warn' || a.level === 'error').length;

  const items = useMemo(() => activity.filter(a =>
    (level === 'all' || (level === 'problems' ? a.level === 'warn' || a.level === 'error' : a.level === level)) &&
    (source === 'all' || a.source === source) &&
    (!pin?.processId || a.processId === pin.processId) && (!pin?.appId || a.appId === pin.appId) &&
    (!q || `${a.title} ${a.source} ${a.command || ''} ${a.tech || ''}`.toLowerCase().includes(q.toLowerCase()))), [activity, level, source, pin, q]);

  // Si el evento de la ruta quedó afuera del filtro, se muestra el primero de la lista
  const sel = items.find(a => a.id === selArg) ?? items[0];
  const select = (id: string) => setRouteArg(id, { replace: true });
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel?.id]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = items.findIndex(a => a.id === sel?.id);
    const next = items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) select(next.id);
  };
  const filtered = level !== 'all' || source !== 'all' || !!q || !!pin;
  const clear = () => { setLevel('all'); setSource('all'); setQ(''); consoleFilter.set(null); };

  return (
    <div className="page-in console-page">
      <PageHeader title="Consola" sub="Todo lo que pasó en el cluster. Elegí un evento para ver el comando exacto, qué entró, qué hizo y qué salió." />
      <div className="console-grid">
        <section className="panel console-list" aria-label="Eventos">
          <div className="toolbar">
            <label className="input-search"><Search size={13} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar en títulos, comandos y logs" aria-label="Buscar en la actividad" /></label>
            <Seg value={level} onChange={setLevel} label="Gravedad" options={[
              { value: 'all', label: 'Todo' },
              { value: 'problems', label: <>Problemas{problems > 0 && <span className="seg-n">{problems}</span>}</> },
              { value: 'error', label: 'Errores' },
              { value: 'ok', label: 'Listos' },
            ]} />
            <select className="input select-sm" value={source} onChange={e => setSource(e.target.value)} aria-label="Origen">
              <option value="all">Todos los orígenes</option>
              {sources.map(([s, n]) => <option key={s} value={s}>{s === 'Vos' ? 'Vos (tus acciones)' : s} · {n}</option>)}
            </select>
          </div>
          {(pin || filtered) && (
            <div className="console-filters">
              {pin && <span className="chip-f">Sólo {pin.processId ? `el proceso ${pin.processId}` : `el trabajo ${pin.appId}`}<button type="button" aria-label="Quitar el filtro de proceso" onClick={() => consoleFilter.set(null)}><X size={12} /></button></span>}
              <span className="muted">{items.length} de {activity.length} eventos</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>Ver todo</button>
            </div>
          )}
          <div className="console-rows" role="listbox" aria-label="Eventos" tabIndex={0} onKeyDown={onKey} ref={listRef} aria-activedescendant={sel ? `ev-${sel.id}` : undefined}>
            {items.map(a => (
              <div key={a.id} id={`ev-${a.id}`} role="option" aria-selected={a.id === sel?.id} className="console-row" data-l={a.level} onClick={() => select(a.id)}>
                <span className="t">{clock(a.at)}</span>
                <Dot s={LEVEL_DOT[a.level]} />
                <span className="src">{a.source}</span>
                <span className="ttl">{a.title}</span>
                {a.command && <SquareTerminal size={13} className="has-cmd" aria-label="tiene comando" />}
              </div>
            ))}
            {!items.length && <div className="tbl-empty">{activity.length ? 'Nada para mostrar con estos filtros.' : 'Todavía no pasó nada. Lo que hagas (y lo que haga el cluster) aparece acá.'}</div>}
          </div>
        </section>
        <aside className="panel console-detail" aria-label="Detalle del evento">
          {sel ? <Detail a={sel} /> : <EmptyState kind="empty" title="Sin eventos" compact center>Elegí un evento de la lista para ver su detalle.</EmptyState>}
        </aside>
      </div>
    </div>
  );
}

function Detail({ a }: { a: Activity }) {
  const steps: { k: string; label: string; text?: string }[] = [
    { k: 'in', label: 'Entra', text: a.input },
    { k: 'do', label: 'Hace', text: a.action },
    { k: 'out', label: 'Sale', text: a.output },
  ];
  const hasFlow = steps.some(s => s.text);
  return (
    <div className="ev">
      <div className="ev-h">
        <span className="badge" data-k={a.level === 'error' ? 'bad' : a.level === 'warn' ? 'run' : a.level === 'ok' ? 'ok' : undefined}>{LEVEL_LABEL[a.level]}</span>
        <span className="ev-meta">{a.source} · {new Date(a.at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
      </div>
      <h2 className="ev-t">{a.title}</h2>
      <div className="ev-sec">
        <h3>Comando</h3>
        {a.command ? <div className="ev-cmd"><code><span aria-hidden="true">$ </span>{a.command}</code><CopyButton text={a.command} /></div>
          : <p className="muted">Este evento no corrió un comando: lo informó {a.source === 'Vos' ? 'la interfaz' : a.source}.</p>}
      </div>
      {hasFlow && (
        <ol className="ev-flow">
          {steps.map((s, i) => <li key={s.k} data-empty={!s.text || undefined}><span className="ev-n">{i + 1}</span><div><h3>{s.label}</h3><p>{s.text || '—'}</p></div></li>)}
        </ol>
      )}
      {a.tech && <div className="ev-sec"><h3>Log</h3><div className="ev-cmd ev-log"><code>{a.tech}</code><CopyButton text={a.tech} label="Copiar el log" /></div></div>}
      {(a.processId || a.appId) && (
        <div className="ev-links">
          {a.processId && <button type="button" className="btn btn-sm" onClick={() => navigate('cluster', a.processId)}>Ver el proceso en Cluster<ArrowUpRight size={13} /></button>}
          {a.processId && <button type="button" className="btn btn-sm btn-ghost" onClick={() => consoleFilter.set({ processId: a.processId })}>Sólo eventos de este proceso</button>}
          {a.appId && <button type="button" className="btn btn-sm" onClick={() => navigate('yarn', a.appId)}>Ver el trabajo<ArrowUpRight size={13} /></button>}
        </div>
      )}
    </div>
  );
}

function CopyButton({ text, label = 'Copiar el comando' }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  useEffect(() => { if (!ok) return; const t = setTimeout(() => setOk(false), 1400); return () => clearTimeout(t); }, [ok]);
  return (
    <button type="button" className="btn btn-sm btn-ghost ev-copy" aria-label={label} onClick={() => { navigator.clipboard?.writeText(text).then(() => setOk(true), () => setOk(false)); }}>
      {ok ? <><Check size={13} />Copiado</> : <><Copy size={13} />Copiar</>}
    </button>
  );
}
