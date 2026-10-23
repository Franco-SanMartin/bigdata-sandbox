/* La etapa elegida: qué entra y qué sale, las herramientas posibles, las opciones de la elegida y Correr. */
import type { ReactNode } from 'react';
import { ArrowRight, Lock, Play } from 'lucide-react';
import type { ApiErrorCode, PipelineStageInfo, PipelineState, PipelineTool, ToolOption } from '../../api/types';
import { EngineTag } from '../../components/Trace';
import { GatedButton } from '../../components/base';
import { CodeBlock, Dot, Seg, Stepper, Switch } from '../../components/ui';
import { STATE_LABEL, feeder, type OptVal } from './util';

export interface StepError { message: string; code?: ApiErrorCode; status?: number }

export function StagePanel({ info, index, st, tool, values, onTool, onValue, onRun, runBlock, error, errorAction }: {
  info: PipelineStageInfo; index: number; st: PipelineState; tool: PipelineTool | undefined; values: Record<string, OptVal>;
  onTool: (id: string) => void; onValue: (id: string, v: OptVal) => void; onRun: () => void;
  /** Por qué no se puede correr ahora (null: se puede) */
  runBlock: string | null; error: StepError | null; errorAction?: ReactNode;
}) {
  const me = st.stages.find(s => s.stage === info.stage);
  const prev = feeder(st, index);
  const needOk = !prev || prev.state === 'done';
  return (
    <section className="panel" aria-label={`Etapa ${info.label}`}>
      <div className="panel-h">
        <h2><span className="muted mono" style={{ marginRight: 8 }}>{index + 1}</span>{info.label}</h2>
        <span className="sub">{info.description}</span>
        {me && <span className="end"><Dot s={me.state} /><span className="muted" style={{ fontSize: 12 }}>{STATE_LABEL[me.state]}</span></span>}
      </div>
      <div className="panel-b" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {(info.input || info.output) && (
          <div className="pl-io-strip">
            <div><small>entra</small><span className="mono">{info.input ?? '—'}</span></div>
            <ArrowRight size={14} aria-hidden="true" />
            <div><small>sale</small><span className="mono">{info.output ?? '—'}</span></div>
          </div>
        )}
        {index > 0 && (
          <div className="pl-need">
            <Dot s={needOk ? 'done' : 'pending'} />
            <span>Necesita <b>{info.needs}</b>{!needOk && <> · {prev.label} está {STATE_LABEL[prev.state]}</>}</span>
          </div>
        )}

        <div>
          <div className="pl-label">herramienta</div>
          <div className="pl-tools" role="radiogroup" aria-label="Herramienta">
            {info.tools.map(t => {
              const on = tool?.id === t.id;
              return (
                <button key={t.id} type="button" role="radio" aria-checked={on} className="pl-tool" data-state={on ? 'on' : 'off'}
                  aria-disabled={!t.available || undefined} onClick={() => t.available && onTool(t.id)}>
                  <span className="h"><span className="t">{t.label}</span>{t.recommended && <span className="badge">sugerida</span>}</span>
                  <EngineTag engine={t.engine} />
                  {t.available ? <span className="why">{t.whenToUse}</span> : <span className="off"><Lock size={12} aria-hidden="true" />{t.unavailableReason || 'No disponible'}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {tool && <>
          <dl className="pl-when">
            <dt>Conviene</dt><dd>{tool.whenToUse}</dd>
            <dt>No conviene</dt><dd>{tool.whenNot}</dd>
            {tool.script && <><dt>Script</dt><dd className="mono">{tool.script}</dd></>}
          </dl>
          {tool.options.length > 0 && (
            <div className="pl-opts">
              {tool.options.map(o => <OptionField key={o.id} o={o} value={values[o.id] ?? o.default} onChange={v => onValue(o.id, v)} />)}
            </div>
          )}
          <CodeBlock lines={[...(tool.options.length ? ['# con las opciones por defecto; el comando exacto queda en la corrida'] : []), ...tool.command.split('\n')]} label="Comando" />
          <div className="pl-run">
            <GatedButton cap="pipeline" blockedBy={runBlock} className="btn btn-primary" onClick={onRun} inline><Play size={14} aria-hidden="true" />Correr {tool.label}</GatedButton>
          </div>
        </>}

        {error && (
          <div className="callout" data-k="bad" role="alert">
            <div className="pl-err">
              <span><b>No se pudo correr.</b> {error.message}</span>
              {error.code && <span className="pl-code">{error.code}{error.status ? ` · ${error.status}` : ''}</span>}
            </div>
            {errorAction}
          </div>
        )}
      </div>
    </section>
  );
}

function OptionField({ o, value, onChange }: { o: ToolOption; value: OptVal; onChange: (v: OptVal) => void }) {
  const id = `opt-${o.id}`;
  let ctl: ReactNode;
  if (o.kind === 'select' && o.choices) {
    ctl = o.choices.length <= 4
      ? <Seg value={String(value)} onChange={onChange} label={o.label} options={o.choices.map(c => ({ value: c.value, label: c.label }))} />
      : <select id={id} className="input" value={String(value)} onChange={e => onChange(e.target.value)}>{o.choices.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select>;
  } else if (o.kind === 'number') {
    ctl = <Stepper id={id} value={Number(value)} min={o.min ?? 0} max={o.max ?? 9999} onChange={onChange} label={o.label} />;
  } else if (o.kind === 'boolean') {
    ctl = <Switch checked={!!value} onChange={onChange} label={o.label} />;
  } else {
    ctl = <input id={id} className="input mono" value={String(value)} onChange={e => onChange(e.target.value)} aria-invalid={!String(value).trim() || undefined} />;
  }
  return (
    <div className="field">
      <div className="field-l">
        <label htmlFor={o.kind === 'select' && (o.choices?.length ?? 0) <= 4 ? undefined : id}>{o.label}</label>
        {o.help && <span className="hint">{o.help}</span>}
      </div>
      <div className="field-c">{ctl}</div>
    </div>
  );
}
