/* La franja de camino de datos: de dónde → qué lo procesa → dónde queda (lib/camino.ts arma los tramos).
   Cada caja lleva el color de su capa del mapa, lleva a su pantalla y su "?" abre el glosario. */
import { ArrowRight } from 'lucide-react';
import type { Camino as CaminoT, Tramo } from '../lib/camino';
import { TERMINOS } from '../help/glosario';
import { abrirGlosario, navigate } from '../state/ui';

function Caja({ t }: { t: Tramo }) {
  const ir = t.ir;
  return (
    <div className="camino-c" data-capa={t.capa}>
      <small>
        {t.k}
        {t.glosario && (
          <button type="button" className="camino-q" onClick={() => abrirGlosario(t.glosario)}
            aria-label={`${TERMINOS.get(t.glosario)?.t ?? t.glosario} en el glosario`} title={`Qué es ${TERMINOS.get(t.glosario)?.t ?? t.glosario}`}>?</button>
        )}
      </small>
      {ir ? <button type="button" className="camino-v mono" onClick={() => navigate(ir.page, ir.arg)}>{t.v}</button> : <b className="camino-v mono">{t.v}</b>}
      {t.sub && <span>{t.sub}</span>}
    </div>
  );
}

export function Camino({ c }: { c: CaminoT }) {
  return (
    <div className="camino" role="group" aria-label="Camino de los datos">
      <Caja t={c.de} />
      <ArrowRight className="camino-f" size={15} aria-hidden="true" />
      <Caja t={c.proc} />
      <ArrowRight className="camino-f" size={15} aria-hidden="true" />
      <Caja t={c.queda} />
    </div>
  );
}
