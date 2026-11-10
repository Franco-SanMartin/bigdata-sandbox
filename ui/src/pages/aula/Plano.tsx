/* El editor del plano del aula: las filas del laboratorio (que son los racks de HDFS) con sus lugares, y cada PC
   arrastrada a donde está. Se guarda en el maestro (PUT /api/aula/plano, que escribe los racks), se exporta a
   plano-aula.json para la próxima clase (el reset borra todo cada día) y el borrador queda en el navegador. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Minus, Plus, RotateCcw, Save, Upload, X } from 'lucide-react';
import { api } from '../../api';
import type { AulaStatus } from '../../api/types';
import { cambiarForma, leerPlano, moverEnPlano, planoInicial, racksDelPlano, sacarDelPlano, sinUbicar, type Plano } from '../../lib/aula';
import { toast } from '../../state/ui';

const BORRADOR = 'aula-plano-borrador';

function leerBorrador(): Plano | null {
  try { const t = localStorage.getItem(BORRADOR); return t ? leerPlano(t) : null; } catch { return null; }
}

export function EditorPlano({ a, onCerrar, onGuardado }: { a: AulaStatus; onCerrar: () => void; onGuardado: () => void }) {
  const nodos = useMemo(() => a.pcs.map(p => p.nodo), [a.pcs]);
  const porFila = Math.max(1, a.pcs.filter(p => p.fila === '/fila1').length || 5);
  const [p, setP] = useState<Plano>(() => leerBorrador() ?? (a.plano ? { filas: a.plano.filas } : planoInicial(nodos, porFila)));
  const [elegida, setElegida] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const archivo = useRef<HTMLInputElement>(null);
  useEffect(() => { try { localStorage.setItem(BORRADOR, JSON.stringify(p)); } catch { /* sin almacenamiento: queda en memoria */ } }, [p]);

  const bandeja = sinUbicar(p, nodos);
  const racks = racksDelPlano(p);
  const cambian = a.pcs.filter(pc => racks[pc.nodo] && pc.fila && racks[pc.nodo] !== pc.fila);
  const lugares = Math.max(...p.filas.map(f => f.length));
  const poner = (nodo: string, fila: number, lugar: number) => { setP(x => moverEnPlano(x, nodo, fila, lugar)); setElegida(null); };

  function exportar() {
    const blob = new Blob([JSON.stringify({ filas: p.filas }, null, 1)], { type: 'application/json' });
    const u = URL.createObjectURL(blob);
    const el = document.createElement('a'); el.href = u; el.download = 'plano-aula.json'; document.body.appendChild(el); el.click(); el.remove();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  }
  async function importar(f: File | undefined) {
    if (!f) return;
    try { setP(leerPlano(await f.text())); toast({ kind: 'ok', title: `Plano leído de ${f.name}` }); }
    catch (e) { toast({ kind: 'bad', title: 'No se pudo leer el plano', description: e instanceof Error ? e.message : String(e) }); }
  }
  async function guardar() {
    setGuardando(true);
    try {
      const r = await api().aulaGuardarPlano(p);
      toast({ kind: 'ok', title: 'Plano guardado en el maestro', description: r.cambianDeRack?.length
        ? `${r.cambianDeRack.join(', ')} ${r.cambianDeRack.length === 1 ? 'cambia' : 'cambian'} de rack: se aplica cuando ${r.cambianDeRack.length === 1 ? 'vuelva' : 'cada una vuelva'} a arrancar.` : 'Las filas son los racks de HDFS.' });
      onGuardado();
    } catch (e) { toast({ kind: 'bad', title: 'No se pudo guardar el plano', description: e instanceof Error ? e.message : String(e) }); }
    finally { setGuardando(false); }
  }

  const chip = (nodo: string, enLugar?: boolean) => (
    <span className="au-chip" draggable data-sel={elegida === nodo || undefined}
      onDragStart={e => { e.dataTransfer.setData('text/plain', nodo); e.dataTransfer.effectAllowed = 'move'; }}>
      <button type="button" className="mono" onClick={e => { e.stopPropagation(); setElegida(s => (s === nodo ? null : nodo)); }}
        aria-pressed={elegida === nodo} aria-label={`Elegir ${nodo} para moverla`}>{nodo}</button>
      {enLugar && <button type="button" className="au-chip-x" onClick={e => { e.stopPropagation(); setP(x => sacarDelPlano(x, nodo)); }} aria-label={`Sacar ${nodo} del plano`}><X size={11} /></button>}
    </span>
  );

  return (
    <section className="au-card au-editor" aria-label="Editor del plano del aula">
      <header className="au-editor-h">
        <h3>El plano del aula</h3>
        <span className="au-nota">Arrastrá cada PC a su lugar (o tocala y después tocá el lugar). Cada fila es un rack de HDFS: las copias de un bloque quedan en filas distintas.</span>
      </header>
      <div className="au-editor-bar">
        <span className="au-forma">Filas
          <button type="button" className="btn btn-sm btn-icon" onClick={() => setP(x => cambiarForma(x, x.filas.length - 1, lugares))} aria-label="Una fila menos"><Minus size={12} /></button>
          <b className="num">{p.filas.length}</b>
          <button type="button" className="btn btn-sm btn-icon" onClick={() => setP(x => cambiarForma(x, x.filas.length + 1, lugares))} aria-label="Una fila más"><Plus size={12} /></button>
        </span>
        <span className="au-forma">Lugares por fila
          <button type="button" className="btn btn-sm btn-icon" onClick={() => setP(x => cambiarForma(x, x.filas.length, lugares - 1))} aria-label="Un lugar menos"><Minus size={12} /></button>
          <b className="num">{lugares}</b>
          <button type="button" className="btn btn-sm btn-icon" onClick={() => setP(x => cambiarForma(x, x.filas.length, lugares + 1))} aria-label="Un lugar más"><Plus size={12} /></button>
        </span>
        <button type="button" className="btn btn-sm" onClick={() => setP(planoInicial(nodos, porFila))}><RotateCcw size={13} />Desde los números</button>
        <button type="button" className="btn btn-sm" onClick={exportar}><Download size={13} />plano-aula.json</button>
        <button type="button" className="btn btn-sm" onClick={() => archivo.current?.click()}><Upload size={13} />Importar</button>
        <input ref={archivo} type="file" accept="application/json,.json" hidden onChange={e => { void importar(e.target.files?.[0]); e.target.value = ''; }} />
        <span className="au-editor-acc">
          <button type="button" className="btn btn-sm btn-primary" disabled={guardando} onClick={guardar}><Save size={13} />{guardando ? 'Guardando…' : 'Guardar en el maestro'}</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onCerrar}>Cerrar</button>
        </span>
      </div>
      <div className="au-frente-ed"><span>Frente del aula · PC del profe (maestro, rack /profe)</span></div>
      <div className="au-grilla">
        {p.filas.map((f, i) => (
          <div key={i} className="au-grilla-f">
            <span className="au-grilla-n">Fila {i + 1}<small className="mono">/fila{i + 1}</small></span>
            <ol className="au-lugares" style={{ gridTemplateColumns: `repeat(${lugares}, minmax(64px, 1fr))` }}>
              {f.map((x, j) => (
                <li key={j}>
                  <div className="au-lugar" data-ocupado={x ? true : undefined} role="button" tabIndex={0}
                    aria-label={x ? `Fila ${i + 1}, lugar ${j + 1}: ${x}` : `Fila ${i + 1}, lugar ${j + 1}: libre`}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); const n = e.dataTransfer.getData('text/plain'); if (n) poner(n, i, j); }}
                    onClick={() => elegida && poner(elegida, i, j)}
                    onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && elegida) { e.preventDefault(); poner(elegida, i, j); } }}>
                    {x ? chip(x, true) : <span className="au-libre">{elegida ? 'acá' : 'libre'}</span>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
      <div className="au-bandeja" onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const n = e.dataTransfer.getData('text/plain'); if (n) setP(x => sacarDelPlano(x, n)); }}>
        <b>Sin ubicar</b>
        {bandeja.length ? bandeja.map(n => <span key={n}>{chip(n)}</span>) : <span className="au-nota">Todas las PCs del aula están en el plano.</span>}
      </div>
      {cambian.length > 0 && (
        <p className="au-aviso" role="status">
          {cambian.map(pc => `${pc.nodo} pasa de ${pc.fila} a ${racks[pc.nodo]}`).join(' · ')}: el rack se lee cuando el DataNode se registra, así que cambia al próximo arranque de esa PC (no en caliente).
        </p>
      )}
      <p className="au-nota">El reset borra todo cada día: exportá <code>plano-aula.json</code> y dejalo al lado de <code>empresa-profe.cmd</code>, que lo pasa al maestro al arrancar. El borrador también queda en este navegador.</p>
    </section>
  );
}
