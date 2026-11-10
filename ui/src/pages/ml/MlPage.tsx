/* Machine Learning: el estudio (#ml), los experimentos guardados (#ml/experimentos, #ml/experimentos/<id>,
   #ml/experimentos/comparar/<id>,<id>), la biblioteca de modelos (#ml/biblioteca, #ml/biblioteca/<nombre>) y el
   recorrido guiado de clase (#ml/guiado). */
import { Brain } from 'lucide-react';
import { EmptyState, PageHeader, SkeletonLines, type Tab } from '../../components/base';
import { HELP } from '../../help/content';
import { runFix, useCapabilities } from '../../state/capabilities';
import { useStatus } from '../../state/store';
import { navigate, useRouteParts } from '../../state/ui';
import { useApi } from '../../state/useApi';
import { Biblioteca } from './estudio/Biblioteca';
import { useCatalogo } from './estudio/comun';
import { Estudio } from './estudio/Estudio';
import { Experimentos } from './estudio/Experimentos';
import { Guiado } from './Guiado';
import './ml.css';
import './estudio.css';

type Vista = 'estudio' | 'experimentos' | 'biblioteca' | 'guiado';

export function MlPage() {
  const partes = useRouteParts();
  const vista: Vista = partes[0] === 'experimentos' || partes[0] === 'biblioteca' || partes[0] === 'guiado' ? partes[0] : 'estudio';
  const cat = useCatalogo();
  const status = useStatus();
  const caps = useCapabilities();
  const exps = useApi(a => a.mlExperiments(), [], e => e.type === 'mlrun' && e.run.estado !== 'corriendo');
  const modelos = useApi(a => a.mlLibrary(), [vista], e => e.type === 'mlrun' && e.run.estado !== 'corriendo');
  const cap = caps['ml.sklearn'];
  const tabs: Tab<Vista>[] = [
    { id: 'estudio', label: 'Estudio' },
    { id: 'experimentos', label: 'Experimentos', count: exps.data?.length },
    { id: 'biblioteca', label: 'Biblioteca', count: modelos.data?.length },
    { id: 'guiado', label: 'Guiado' },
  ];
  return (
    <div className="page-in ml-page">
      <PageHeader title="Machine Learning" help={HELP.ml.intro}
        sub="Datos, objetivo, preprocesamiento, modelo con todos sus hiperparámetros, validación y búsqueda: cada corrida es un script que podés ver, editar y correr."
        tabs={tabs} tab={vista} onTab={t => navigate('ml', t === 'estudio' ? '' : t)} />
      {status && vista !== 'guiado' && cap.state !== 'ready' && (
        <div className="capnote" data-k={cap.state} role="status">
          <span className="dot" data-s={cap.state === 'starting' ? 'starting' : 'off'} aria-hidden="true" />
          <span><b>Entrenar:</b> {cap.reason}. Los datos de /datos, el catálogo, el código y los experimentos guardados se ven igual.</span>
          {cap.fix && cap.fix.kind !== 'wait' && <button type="button" className="btn btn-sm" onClick={() => runFix(cap.fix)}>{cap.fixLabel}</button>}
        </div>
      )}
      {vista === 'guiado' ? <Guiado />
        : cat.error ? <EmptyState kind="error" icon={<Brain size={20} aria-hidden="true" />} title="No se pudo cargar el catálogo de modelos">{cat.error}</EmptyState>
        : !cat.data ? <SkeletonLines n={8} />
        : vista === 'experimentos' ? <Experimentos cat={cat.data} arg={partes.slice(1)} />
        : vista === 'biblioteca' ? <Biblioteca cat={cat.data} arg={partes.slice(1)} />
        : <Estudio cat={cat.data} />}
    </div>
  );
}
