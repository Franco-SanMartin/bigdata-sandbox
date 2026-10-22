/* Pipeline: las 6 etapas, la herramienta de cada una y el riel con lo que viaja. Esqueleto. */
import { useState } from 'react';
import { Play, RotateCcw, Workflow } from 'lucide-react';
import type { PipelineStage, PipelineTool, StepRun } from '../../api/types';
import { EngineTag, Slot, TraceView } from '../../components/Trace';
import { Dot, Empty } from '../../components/ui';
import { HELP } from '../../help/content';
import { pipelineReset, runStep } from '../../state/actions';
import { useStatus } from '../../state/store';
import { useApi } from '../../state/useApi';
import { nf, sizeLabel } from '../../lib/format';

const defaults = (t: PipelineTool) => Object.fromEntries(t.options.map(o => [o.id, o.default]));

export function PipelinePage() {
  const status = useStatus();
  const up = status?.phase === 'running';
  const onStep = (e: { type: string }) => e.type === 'step' || e.type === 'hdfs';
  const catalog = useApi(a => a.pipelineCatalog(), [up], onStep);
  const state = useApi(a => a.pipelineState(), [up], onStep);
  const steps = useApi(a => a.steps(), [], onStep);
  const [picked, setPicked] = useState<PipelineStage | null>(null);
  const st = state.data;
  const stage = picked ?? st?.current ?? 'ingesta';
  const info = catalog.data?.find(s => s.stage === stage);
  const last: StepRun | undefined = steps.data?.filter(s => s.stage === stage).at(-1);

  return (
    <div className="page-in">
      <div className="page-head">
        <div><h1>Pipeline</h1><p>{HELP.pipeline.intro}</p></div>
        <div className="page-actions">
          <button className="btn" type="button" disabled={!st || !!st.working} onClick={() => { setPicked(null); pipelineReset(); }}><RotateCcw size={14} />Empezar de nuevo</button>
        </div>
      </div>
      {!up && <div className="callout" data-k="run" style={{ marginBottom: 16 }}><span><b>El cluster está apagado.</b> Podés recorrer las etapas, pero para correr un paso hay que prenderlo.</span></div>}
      <div className="grid cols-12">
        <section className="panel span-8">
          <div className="panel-h"><h2>{info?.label ?? 'Etapa'}</h2>{info && <span className="sub">{info.description}</span>}</div>
          <div className="panel-b" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {info ? <>
              <p className="muted" style={{ fontSize: 12 }}>Necesita: {info.needs}</p>
              {info.tools.map(t => (
                <div key={t.id} className="callout" style={{ justifyContent: 'space-between' }}>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}><b>{t.label}</b><EngineTag engine={t.engine} />{t.recommended && <span className="badge" data-k="ok">Sugerida</span>}</span>
                    <span>{t.whenToUse}</span>
                    {!t.available && <span className="muted">{t.unavailableReason}</span>}
                  </span>
                  <button className="btn btn-sm" type="button" disabled={!up || !t.available || !!st?.working} onClick={() => runStep({ stage, tool: t.id, options: defaults(t) })}><Play size={12} />Correr</button>
                </div>
              ))}
              <Slot title="Acá van las opciones de cada herramienta:">formulario armado con PipelineTool.options, el comando que corre (command) y cuándo no conviene (whenNot).</Slot>
            </> : <Empty icon={<Workflow size={20} />} title="Cargando etapas" />}
          </div>
        </section>
        <aside className="panel span-4" aria-label="Riel del pipeline">
          <div className="panel-h"><h2>Riel</h2>{st?.working && <span className="end"><EngineTag engine={st.working.engine} /></span>}</div>
          <div className="panel-b" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {st?.stages.map((s, i) => (
              <button key={s.stage} type="button" className="btn btn-ghost" aria-current={s.stage === stage ? 'step' : undefined}
                style={{ justifyContent: 'flex-start', background: s.stage === stage ? 'var(--surface-3)' : undefined }} onClick={() => setPicked(s.stage)}>
                <Dot s={s.state} /><span className="muted">{i + 1}</span>{s.label}{s.tool && <span className="muted" style={{ marginLeft: 'auto' }}>{s.tool}</span>}
              </button>
            ))}
            {st?.working && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>{st.working.message}</p>}
            {st?.next && <p style={{ fontSize: 12, marginTop: 8 }}>Sigue: {st.next.hint}</p>}
            {st?.dataset && (
              <dl className="kv" style={{ marginTop: 12 }}>
                <dt>Dato</dt><dd className="mono">{st.dataset.path}</dd>
                <dt>Formato</dt><dd>{st.dataset.format}</dd>
                {st.dataset.rows != null && <><dt>Filas</dt><dd>{nf(st.dataset.rows)}</dd></>}
                {st.dataset.sizeMb != null && <><dt>Tamaño</dt><dd>{sizeLabel(st.dataset.sizeMb)}</dd></>}
              </dl>
            )}
          </div>
        </aside>
        <section className="panel span-12">
          <div className="panel-h"><h2>Último paso de esta etapa</h2>{last && <span className="sub">{last.message} · {nf(last.progress * 100)} %</span>}</div>
          <div className="panel-b">
            {last?.trace ? <TraceView trace={last.trace} /> : last?.error ? <div className="callout" data-k="bad"><span>{last.error}</span></div> : <span className="muted">Todavía no corriste esta etapa.</span>}
          </div>
        </section>
      </div>
    </div>
  );
}
