/* Pipeline: las 6 etapas, la herramienta de cada una, la corrida en vivo y el riel con lo que viaja. */
import { useState } from 'react';
import { History, RotateCcw, Workflow } from 'lucide-react';
import { api } from '../../api';
import { ApiFailure } from '../../api/errors';
import type { PipelineStage, StepRun } from '../../api/types';
import { DataTable, type Column } from '../../components/DataTable';
import { EngineTag } from '../../components/Trace';
import { Dot } from '../../components/ui';
import { CapabilityNotice, EmptyState, GatedButton, PageHeader, Panel } from '../../components/base';
import { HELP } from '../../help/content';
import { duration, nf } from '../../lib/format';
import { useStatus } from '../../state/store';
import { confirm, navigate, toast } from '../../state/ui';
import { useApi } from '../../state/useApi';
import { Rail } from './Rail';
import { RunPanel } from './RunPanel';
import { StagePanel, type StepError } from './StagePanel';
import { RUN_LABEL, defaults, feeder, outLabel, pickTool, toolLabel, type OptVal } from './util';
import './pipeline.css';

export function PipelinePage() {
  const status = useStatus();
  const onStep = (e: { type: string }) => e.type === 'step' || e.type === 'hdfs';
  // Qué herramientas se pueden usar depende de los procesos que están arriba (HiveServer2, MySQL, YARN…)
  const procs = status?.processes.filter(p => p.state === 'up').map(p => p.id).join() ?? '';
  const catalog = useApi(a => a.pipelineCatalog(), [status?.phase, procs], onStep);
  const state = useApi(a => a.pipelineState(), [status?.phase], onStep);
  const steps = useApi(a => a.steps(), [], e => e.type === 'step');

  const [picked, setPicked] = useState<PipelineStage | null>(null);
  const [toolSel, setToolSel] = useState<Partial<Record<PipelineStage, string>>>({});
  const [opts, setOpts] = useState<Record<string, Record<string, OptVal>>>({});
  const [runSel, setRunSel] = useState<string | null>(null);
  const [error, setError] = useState<(StepError & { stage: PipelineStage }) | null>(null);

  const st = state.data;
  const cat = catalog.data;
  const runs = steps.data ?? [];
  const stage: PipelineStage = picked ?? st?.current ?? 'ingesta';
  const index = st ? st.stages.findIndex(s => s.stage === stage) : 0;
  const info = cat?.find(s => s.stage === stage);
  const chosen = info && (info.tools.find(t => t.id === toolSel[stage] && t.available) ?? pickTool(info));
  const key = `${stage}:${chosen?.id}`;
  const values = chosen ? { ...defaults(chosen), ...opts[key] } : {};
  // La corrida que se muestra: la elegida en el historial si es de esta etapa, si no la última de la etapa
  const selRun = runs.find(r => r.id === runSel && r.stage === stage) ?? runs.find(r => r.stage === stage);
  const nextOf = (s: PipelineStage) => { const i = st?.stages.findIndex(x => x.stage === s) ?? -1; return i >= 0 ? st?.stages[i + 1] : undefined; };

  const go = (s: PipelineStage) => { setPicked(s); setRunSel(null); if (error?.stage !== s) setError(null); };

  // Cluster apagado o sin servicios lo resuelve la capacidad (GatedButton); acá lo propio de la pantalla
  const runBlock = !status ? 'Conectando…'
    : st?.working ? `Esperá: está corriendo ${st.stages.find(s => s.stage === runs.find(r => r.id === st.working!.stepId)?.stage)?.label ?? 'otro paso'}`
    : chosen && !chosen.available ? chosen.unavailableReason || 'No disponible'
    : null;

  async function run() {
    if (!chosen) return;
    setError(null);
    try {
      const id = await api().runStep({ stage, tool: chosen.id, options: values });
      setRunSel(id);
      steps.reload(); state.reload();
    } catch (e) {
      const f = e instanceof ApiFailure ? e : null;
      setError({ stage, message: e instanceof Error ? e.message : String(e), code: f?.code, status: f?.status });
      toast({ kind: 'bad', title: `No se pudo correr ${chosen.label}`, description: f?.code ? `${f.code} · ${e instanceof Error ? e.message : ''}` : undefined });
    }
  }

  async function reset() {
    if (!st) return;
    const done = st.stages.filter(s => s.state === 'done').length;
    const ok = await confirm({
      title: 'Empezar el pipeline de nuevo', confirmLabel: 'Empezar de nuevo',
      description: 'El riel vuelve a la primera etapa y se vacía el historial de corridas. Lo que ya está en HDFS, Hive y MySQL queda como estaba.',
      facts: [['Etapas hechas', `${done} de ${st.stages.length}`], ['Corridas', nf(runs.length)], ['Equivale a', 'POST /api/pipeline/reset']],
    });
    if (!ok) return;
    try {
      await api().pipelineReset();
      setPicked(null); setRunSel(null); setError(null); setOpts({}); setToolSel({});
      toast({ kind: 'ok', title: 'Pipeline reiniciado' });
    } catch (e) {
      toast({ kind: 'bad', title: 'No se pudo reiniciar', description: e instanceof Error ? e.message : String(e) });
    }
  }

  const prevSt = st ? feeder(st, index) : null;
  const errorAction = error?.stage === stage && (
    error.code === 'cluster_stopped' ? <button className="btn btn-sm" type="button" onClick={() => navigate('cluster')}>Ir a Cluster</button>
      : error.code === 'invalid' && prevSt ? <button className="btn btn-sm" type="button" onClick={() => go(prevSt.stage)}>Ir a {prevSt.label}</button>
      : null
  );

  const doneCount = st?.stages.filter(s => s.state === 'done').length ?? 0;
  const loadError = catalog.error || state.error;

  const cols: Column<StepRun>[] = [
    { id: 'id', header: 'Corrida', cell: r => <span className="mono">{r.id}</span>, width: 80 },
    { id: 'stage', header: 'Etapa', cell: r => cat?.find(c => c.stage === r.stage)?.label ?? r.stage, sort: r => st?.stages.findIndex(s => s.stage === r.stage) ?? 0 },
    { id: 'tool', header: 'Herramienta', cell: r => <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}><span className="mono">{toolLabel(cat?.find(c => c.stage === r.stage), r.tool)}</span><EngineTag engine={r.engine} /></span> },
    { id: 'state', header: 'Estado', cell: r => <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><Dot s={r.state} />{r.state === 'running' ? `${nf(r.progress * 100)} %` : RUN_LABEL[r.state]}</span>, sort: r => r.state },
    { id: 'dur', header: 'Tardó', align: 'right', cell: r => (r.finishedAt ? duration((r.finishedAt - r.startedAt) / 1000) : '—'), sort: r => (r.finishedAt ?? Infinity) - r.startedAt },
    { id: 'out', header: 'Salida', cell: r => (r.state === 'failed' ? <span style={{ color: 'var(--bad-text)' }}>{r.error ?? r.message}</span>
      : r.output ? <span className="mono pl-out" title={r.output.path}>{outLabel(r)}{r.output.rows != null && r.stage !== 'ml' ? ' filas' : ''}</span>
      : <span className="muted">{r.message}</span>) },
  ];

  return (
    <div className="page-in pl-page">
      <PageHeader title="Pipeline" sub="De ventas_sucias.csv al resumen y al modelo en 6 etapas: elegís la herramienta de cada una y la corrés."
        help={HELP.pipeline.intro}
        status={st ? { k: doneCount === st.stages.length ? 'ok' : doneCount > 0 ? 'run' : 'off', label: `${doneCount} de ${st.stages.length} etapas` } : undefined}
        actions={
          <GatedButton blockedBy={!st ? 'Cargando…' : st.working ? 'Esperá a que termine la corrida' : !runs.length && doneCount === 0 ? 'Todavía no corriste nada' : null} onClick={reset}>
            <RotateCcw size={14} aria-hidden="true" />Empezar de nuevo
          </GatedButton>
        } />

      {status && <CapabilityNotice cap="pipeline" what="Correr etapas" />}
      {loadError && (
        <EmptyState kind="error" compact title="No se pudo leer el pipeline"
          actions={<button className="btn btn-sm" type="button" onClick={() => { catalog.reload(); state.reload(); steps.reload(); }}>Reintentar</button>}>
          {loadError}
        </EmptyState>
      )}

      <div className="pl-layout">
        <div className="pl-main">
          {info && st ? (
            <StagePanel info={info} index={index} st={st} tool={chosen} values={values}
              onTool={id => { setToolSel(s => ({ ...s, [stage]: id })); if (error?.stage === stage) setError(null); }}
              onValue={(id, v) => setOpts(o => ({ ...o, [key]: { ...o[key], [id]: v } }))}
              onRun={run} runBlock={runBlock} error={error?.stage === stage ? error : null} errorAction={errorAction || undefined} />
          ) : (
            <Panel><EmptyState compact kind={loadError ? 'error' : 'loading'} icon={loadError ? <Workflow size={20} aria-hidden="true" /> : undefined} title={loadError ? 'Sin etapas' : 'Cargando etapas'} /></Panel>
          )}

          {selRun ? (
            <RunPanel run={selRun} info={info} now={status?.now ?? Date.now()}
              next={nextOf(stage) ? { label: nextOf(stage)!.label } : null} onNext={() => { const n = nextOf(stage); if (n) go(n.stage); }} />
          ) : info && (
            <Panel title="Corrida" sub={info.label}><span className="muted">Sin corridas en esta etapa: elegí la herramienta y corréla.</span></Panel>
          )}

          <Panel title="Historial" sub="todas las corridas, la última arriba" flush end={runs.length > 0 ? <span className="badge-count">{runs.length}</span> : undefined}>
            <div style={{ overflowX: 'auto' }}>
              {runs.length ? (
                <DataTable label="Corridas del pipeline" columns={cols} rows={runs} rowKey={r => r.id} selected={selRun?.id ?? null}
                  onRowClick={r => { setPicked(r.stage); setRunSel(r.id); }} />
              ) : (
                <EmptyState compact kind={steps.loading ? 'loading' : 'empty'} icon={steps.loading ? undefined : <History size={20} aria-hidden="true" />}
                  title={steps.loading ? 'Cargando corridas' : 'Todavía no corriste ningún paso'}>
                  {!steps.loading && 'Cada corrida queda acá con su herramienta, el motor, cuánto tardó y qué dejó.'}
                </EmptyState>
              )}
            </div>
          </Panel>
        </div>

        <aside className="pl-side" aria-label="Riel del pipeline">
          <Panel title="Riel" sub="de ventas_sucias.csv al resumen">
            {st ? <Rail st={st} catalog={cat} runs={runs} stage={stage} onPick={go} /> : <span className="muted">{state.error ? 'Sin datos' : 'Cargando…'}</span>}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
