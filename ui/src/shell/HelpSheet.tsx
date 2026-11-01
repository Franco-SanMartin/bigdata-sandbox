/* La ayuda ("?"): qué es esta pantalla, sus conceptos y atajos, y el glosario único de las guías
   (guias/glosario.md), ordenado por capa y con búsqueda. */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { ArrowRight, BookOpen, Search, X } from 'lucide-react';
import { glosarioEn, helpOpen, navigate, route } from '../state/ui';
import { GLOSARIO_DE, HELP, SHORTCUTS } from '../help/content';
import { GLOSARIO, TERMINOS, piezas } from '../help/glosario';
import { navById } from './nav';
import { Kbd } from '../components/ui';

function Texto({ s }: { s: string }) {
  return <>{piezas(s).map((p, i) => p.k === 'b' ? <b key={i}>{p.s}</b> : p.k === 'i' ? <i key={i}>{p.s}</i> : p.k === 'code' ? <code key={i}>{p.s}</code> : <Fragment key={i}>{p.s}</Fragment>)}</>;
}

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function Glosario({ foco }: { foco: string }) {
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  // Al abrir en un término: se baja hasta él (el resaltado lo hace el CSS con data-foco)
  useEffect(() => {
    if (!foco) return;
    setQ('');
    requestAnimationFrame(() => ref.current?.querySelector(`[data-id="${CSS.escape(foco)}"]`)?.scrollIntoView({ block: 'center' }));
  }, [foco]);
  const t = sinTildes(q.trim());
  const secciones = useMemo(() => GLOSARIO.map(s => ({
    ...s, terminos: t ? s.terminos.filter(x => sinTildes(x.t).includes(t) || x.parrafos.some(p => sinTildes(p).includes(t))) : s.terminos,
  })).filter(s => !t || s.terminos.length), [t]);
  return (
    <div className="glo" ref={ref}>
      <label className="glo-q">
        <Search size={13} aria-hidden="true" />
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar: shuffle, réplica, Metastore…" aria-label="Buscar en el glosario" />
      </label>
      {!secciones.length && <p className="glo-nada">No hay nada con “{q}”.</p>}
      {secciones.map(s => (
        <section key={s.id} className="glo-s" data-capa={s.capa} aria-label={s.titulo}>
          <h3>{s.titulo}</h3>
          {!t && s.intro.map((p, i) => <p key={i} className="glo-intro"><Texto s={p} /></p>)}
          {s.terminos.length > 0 && (
            <dl>
              {s.terminos.map(x => (
                <div key={x.id} data-id={x.id} data-foco={x.id === foco || undefined}>
                  <dt>{x.t}</dt>
                  {x.parrafos.map((p, i) => <dd key={i}><Texto s={p} /></dd>)}
                </div>
              ))}
            </dl>
          )}
          {!t && s.tabla && (
            <div className="glo-tabla">
              <table>
                <thead><tr>{s.tabla[0].map(c => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>{s.tabla.slice(1).map(r => <tr key={r[0]}>{r.map((c, i) => i ? <td key={i}><Texto s={c} /></td> : <th key={i} scope="row">{c}</th>)}</tr>)}</tbody>
              </table>
            </div>
          )}
          {!t && s.tabla && <button type="button" className="btn btn-sm glo-ir" onClick={() => navigate('comparar')}>Verlo corriendo en Comparar<ArrowRight size={13} /></button>}
        </section>
      ))}
      <p className="glo-fuente">El mismo texto está en <code>guias/glosario.md</code>.</p>
    </div>
  );
}

export function HelpSheet() {
  const open = helpOpen.use();
  const page = route.use();
  const en = glosarioEn.use();
  const h = HELP[page];
  const suyos = GLOSARIO_DE[page].map(id => TERMINOS.get(id)!).filter(Boolean);
  const vista = en === null ? 'pantalla' : 'glosario';
  return (
    <Dialog.Root open={open} onOpenChange={o => { helpOpen.set(o); if (!o) glosarioEn.set(null); }} modal={false}>
      <Dialog.Portal>
        <Dialog.Content className="sheet narrow help" data-vista={vista} aria-describedby={undefined} onInteractOutside={e => e.preventDefault()}>
          <div className="sheet-h"><Dialog.Title asChild><h2>Ayuda · {navById(page).title}</h2></Dialog.Title>
            <Dialog.Close asChild><button className="btn btn-sm btn-icon btn-ghost" style={{ marginLeft: 'auto' }} type="button" aria-label="Cerrar la ayuda"><X size={16} /></button></Dialog.Close></div>
          <div className="help-tabs" role="tablist" aria-label="Ayuda">
            <button type="button" role="tab" aria-selected={vista === 'pantalla'} onClick={() => glosarioEn.set(null)}>Esta pantalla</button>
            <button type="button" role="tab" aria-selected={vista === 'glosario'} onClick={() => glosarioEn.set('')}><BookOpen size={13} aria-hidden="true" />Glosario</button>
          </div>
          <div className="sheet-b">
            {vista === 'glosario' ? <Glosario foco={en ?? ''} /> : (
              <>
                <p>{h.intro}</p>
                {h.terms.length > 0 && <div><h3>Conceptos</h3><dl>{h.terms.map(([t, d]) => <div key={t}><dt>{t}</dt><dd>{d}</dd></div>)}</dl></div>}
                {suyos.length > 0 && (
                  <div>
                    <h3>En el glosario</h3>
                    <div className="help-glo">
                      {suyos.map(x => <button key={x.id} type="button" className="help-glo-t" data-capa={x.seccion.capa} onClick={() => glosarioEn.set(x.id)}>{x.t}</button>)}
                    </div>
                  </div>
                )}
                <div><h3>Atajos</h3><div className="keys">{SHORTCUTS.map(([a, k]) => <div key={a} style={{ display: 'contents' }}><span>{a}</span><span>{k.includes(' ') ? k.split(' ').map(x => <kbd key={x}>{x}</kbd>) : <Kbd k={k} />}</span></div>)}</div></div>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
