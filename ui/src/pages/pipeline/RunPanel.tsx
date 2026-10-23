/* Una corrida de un paso: progreso en vivo, lo que dejó y la traza (comando → entra → hace → sale, antes y después). */
import { ArrowRight } from 'lucide-react';
import type { PipelineStageInfo, StepRun } from '../../api/types';
import { EngineTag, TraceView } from '../../components/Trace';
import { Meter } from '../../components/ui';
import { Panel } from '../../components/base';
import { clock, duration, nf, sizeLabel } from '../../lib/format';
import { navigate } from '../../state/ui';
import { RUN_K, RUN_LABEL, toolLabel } from './util';

export function RunPanel({ run, info, now, next, onNext }: {
  run: StepRun; info: PipelineStageInfo | undefined; now: number; next?: { label: string } | null; onNext?: () => void;
}) {
  const k = RUN_K[run.state];
  const secs = ((run.finishedAt ?? now) - run.startedAt) / 1000;
  const o = run.output;
  return (
    <Panel title={<>Corrida <span className="mono">{run.id}</span></>} sub={`${info?.label ?? run.stage} · ${toolLabel(info, run.tool)}`}
      end={<span className="badge" data-k={k}>{RUN_LABEL[run.state]}</span>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="pl-prog">
          <Meter value={run.progress} max={1} kind={k} label="Progreso del paso" />
          <span className="pct">{nf(run.progress * 100)} %</span>
          <span className="msg" aria-live="polite" style={run.state === 'failed' ? { color: 'var(--bad-text)' } : undefined}>{run.state === 'failed' ? run.error || run.message : run.message}</span>
        </div>
        <dl className="pl-meta" style={{ margin: 0 }}>
          <div><dt>Motor</dt><dd><EngineTag engine={run.engine} /></dd></div>
          <div><dt>Empezó</dt><dd>{clock(run.startedAt)}</dd></div>
          <div><dt>{run.finishedAt ? 'Tardó' : 'Lleva'}</dt><dd>{duration(Math.max(0, secs))}</dd></div>
          {run.appIds.length > 0 && <div><dt>YARN</dt><dd><button type="button" className="btn btn-sm btn-ghost mono" onClick={() => navigate('yarn')}>{run.appIds.join(', ')}</button></dd></div>}
          {run.modelId && <div><dt>Modelo</dt><dd><button type="button" className="btn btn-sm btn-ghost mono" onClick={() => navigate('ml')}>{run.modelId}</button></dd></div>}
          {o && run.stage !== 'ml' && <div><dt>Dejó</dt><dd><span className="mono">{o.path}</span>{o.rows != null && <span className="muted"> · {nf(o.rows)} filas</span>}{o.sizeMb != null && <span className="muted"> · {sizeLabel(o.sizeMb)}</span>}</dd></div>}
        </dl>
        {o?.summary && o.summary.length > 0 && (
          <dl className="pl-sum" aria-label="Qué cambió">
            {o.summary.map(([a, b]) => <div key={a}><dt>{a}</dt><dd>{b}</dd></div>)}
          </dl>
        )}
        {run.trace && <TraceView trace={run.trace} />}
        {run.state === 'done' && next && onNext && (
          <div><button className="btn" type="button" onClick={onNext}>Seguir con {next.label}<ArrowRight size={14} /></button></div>
        )}
      </div>
    </Panel>
  );
}
