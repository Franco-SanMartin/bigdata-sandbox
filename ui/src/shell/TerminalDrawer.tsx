/* La terminal del contenedor en un panel abajo, como la consola: bash de verdad (lo mismo que
   `docker exec -it bigdata-full bash`). Una vez abierta queda montada aunque se cierre el panel, así
   no se pierde lo que estaba corriendo. */
import { Suspense, lazy, useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as RPE } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { terminalOpen } from '../state/ui';
import { terminal } from '../lib/terminal';
import { api } from '../api';

const XTerm = lazy(() => import('./XTerm'));

const STATE: Record<string, string> = { off: 'sin conectar', connecting: 'conectando…', open: 'conectada', closed: 'cerrada' };

export function useTermState() {
  return useSyncExternalStore(f => terminal.onState(f), () => terminal.state);
}

export function TerminalDrawer() {
  const open = terminalOpen.use();
  const [mounted, setMounted] = useState(false);
  const [h, setH] = useState(320);
  const drag = useRef<{ y: number; h: number } | null>(null);
  const st = useTermState();
  useEffect(() => { if (open) setMounted(true); }, [open]);
  if (!mounted) return null;
  const demo = api().mode === 'demo';
  const down = (e: RPE) => { drag.current = { y: e.clientY, h }; (e.target as Element).setPointerCapture(e.pointerId); };
  const move = (e: RPE) => { if (drag.current) setH(Math.max(160, Math.min(innerHeight * .8, drag.current.h + drag.current.y - e.clientY))); };
  return (
    <section className="console term" style={{ height: h, display: open ? undefined : 'none' }} aria-label="Terminal del contenedor">
      <div role="separator" aria-orientation="horizontal" aria-label="Cambiar el alto de la terminal" tabIndex={0} onPointerDown={down} onPointerMove={move} onPointerUp={() => (drag.current = null)}
        onKeyDown={e => { if (e.key === 'ArrowUp') setH(x => Math.min(innerHeight * .8, x + 24)); if (e.key === 'ArrowDown') setH(x => Math.max(160, x - 24)); }}
        style={{ height: 5, marginTop: -3, cursor: 'row-resize', flex: 'none' }} />
      <div className="console-bar">
        <h2>Terminal</h2>
        <span className="muted" style={{ fontSize: 12 }}>bash adentro del contenedor, como <code>docker exec -it … bash</code> · Ctrl+Shift+C / V copia y pega</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {!demo && <span className="term-st" data-s={st}><span className="dot" data-s={st === 'open' ? 'ok' : st === 'connecting' ? 'starting' : 'off'} aria-hidden="true" />{STATE[st]}</span>}
          {!demo && st === 'closed' && <button className="btn btn-sm" type="button" onClick={() => terminal.connect()}><RotateCcw size={13} />Abrir otra</button>}
          <button className="btn btn-sm btn-icon btn-ghost" type="button" onClick={() => terminalOpen.set(false)} aria-label="Esconder la terminal"><X size={15} /></button>
        </span>
      </div>
      {demo
        ? <div className="tbl-empty">En el modo demo no hay contenedor: la terminal anda con la imagen <code>full</code> corriendo en tu compu (http://localhost:8080).</div>
        : <Suspense fallback={<div className="tbl-empty">Cargando la terminal…</div>}><XTerm visible={open} /></Suspense>}
    </section>
  );
}
