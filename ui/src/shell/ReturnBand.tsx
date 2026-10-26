/* Banda para volver a la práctica: si saliste de un paso con un enlace ("Ver en HDFS", "Ver el
   trabajo"), queda arriba de la pantalla con un botón que te deja en el mismo paso. */
import { useEffect } from 'react';
import { ArrowLeft, BookOpen, X } from 'lucide-react';
import { navigate, practiceReturn, route } from '../state/ui';

export function ReturnBand() {
  const ret = practiceReturn.use();
  const page = route.use();
  // de vuelta en Prácticas (con el botón o con "atrás") ya no hace falta
  useEffect(() => { if (page === 'practicas' && ret) practiceReturn.set(null); }, [page, ret]);
  if (!ret || page === 'practicas') return null;
  return (
    <div className="ret-band" role="region" aria-label="Volver a la práctica">
      <BookOpen size={15} aria-hidden="true" />
      <span className="ret-t">Viniste desde <b>{ret.title}</b>, paso {ret.n}. Mirá lo que necesites y volvé.</span>
      <button type="button" className="btn btn-sm btn-primary" onClick={() => navigate('practicas', `${ret.practice}/${ret.step}`)}>
        <ArrowLeft size={13} aria-hidden="true" /> Volver al paso {ret.n}
      </button>
      <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label="Cerrar" onClick={() => practiceReturn.set(null)}><X size={14} aria-hidden="true" /></button>
    </div>
  );
}
