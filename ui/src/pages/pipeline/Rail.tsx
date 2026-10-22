/* Riel fijo: las 6 etapas como módulos con lámpara; en cada tramo del cable, el dato que pasó a la siguiente. */
import type { PipelineStage, PipelineStageInfo, PipelineState, StepRun } from '../../api/types';
import { EngineTag } from '../../components/Trace';
import { Dot } from '../../components/ui';
import { nf, sizeLabel } from '../../lib/format';
import { STATE_LABEL, outLabel, toolLabel } from './util';

export function Rail({ st, catalog, runs, stage, onPick }: {
  st: PipelineState; catalog: PipelineStageInfo[] | undefined; runs: StepRun[]; stage: PipelineStage; onPick: (s: PipelineStage) => void;
}) {
  const info = (s: PipelineStage) => catalog?.find(c => c.stage === s);
  const run = (id?: string) => (id ? runs.find(r => r.id === id) : undefined);
  const now = st.stages.find(s => s.stage === st.current);
  return (
    <>
      <ol className="pl-rail" aria-label="Etapas del pipeline" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {st.stages.map((s, i) => {
          const r = run(s.stepId);
          const ci = info(s.stage);
          const out = r?.state === 'done' ? outLabel(r) : null;
          const nextS = st.stages[i + 1];
          // El ML trabaja sobre otro archivo: el cable que entra y el que sale de esa etapa van punteados
          const gap = s.stage === 'ml' || nextS?.stage === 'ml';
          return (
            <li key={s.stage}>
              <button type="button" className="pl-mod" data-s={s.state} aria-current={s.stage === stage ? 'step' : undefined} onClick={() => onPick(s.stage)}
                aria-label={`${i + 1}. ${s.label}: ${STATE_LABEL[s.state]}`}>
                <Dot s={s.state} />
                <span className="n">{i + 1}</span>
                <span className="name">{s.label}</span>
                {s.tool && <span className="use">{s.engine && <EngineTag engine={s.engine} />}<span className="tool">{toolLabel(ci, s.tool)}</span></span>}
                <span className="io" title={ci ? `${ci.input ?? ''} → ${ci.output ?? ''}` : undefined}>
                  {out ? <>sale <b>{out}</b></> : ci?.output ? <>deja {ci.output}</> : null}
                </span>
              </button>
              {nextS && (
                <div className="pl-wire" data-on={!!out && !gap} data-gap={gap}>
                  {gap ? (s.stage === 'ml' ? 'el resumen sigue desde análisis' : 'clientes_senal.csv') : out ? (r?.output?.rows != null ? `${out} filas` : out) : ''}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="pl-next">
        {st.working ? (
          <div className="row"><span>Trabaja</span><span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><EngineTag engine={st.working.engine} /><span className="need">{st.working.message}</span></span></div>
        ) : now && now.state !== 'done' && (
          <div className="row"><span>Ahora</span><span><b style={{ fontWeight: 500 }}>{now.label}</b>{info(now.stage) && st.stages[0].stage !== now.stage && <span className="need"> — necesita {info(now.stage)!.needs}</span>}</span></div>
        )}
        {st.next ? (
          <div className="row"><span>Siguiente</span><span><b style={{ fontWeight: 500 }}>{info(st.next.stage)?.label ?? st.next.stage}</b><span className="need"> — necesita {info(st.next.stage)?.needs ?? st.next.hint}</span></span></div>
        ) : st.stages.every(s => s.state === 'done') && (
          <div className="row"><span>Estado</span><span><span className="badge" data-k="ok">Pipeline completo</span></span></div>
        )}
        {st.dataset && (
          <div className="row"><span>Viaja</span><span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="mono" style={{ overflowWrap: 'anywhere' }}>{st.dataset.path}</span>
            <span className="need">{[st.dataset.format, st.dataset.rows != null && `${nf(st.dataset.rows)} filas`, st.dataset.sizeMb != null && sizeLabel(st.dataset.sizeMb)].filter(Boolean).join(' · ')}</span>
          </span></div>
        )}
      </div>
    </>
  );
}

