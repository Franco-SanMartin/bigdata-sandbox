/* Rótulos y ayudas chicas del Pipeline. */
import type { ApiErrorCode, PipelineStageInfo, PipelineState, PipelineTool, StepRun } from '../../api/types';
import { nf } from '../../lib/format';

export type OptVal = string | number | boolean;

export const STATE_LABEL: Record<'pending' | 'running' | 'done' | 'failed', string> = { pending: 'sin hacer', running: 'corriendo', done: 'hecha', failed: 'falló' };
export const RUN_K: Record<StepRun['state'], 'ok' | 'run' | 'bad'> = { done: 'ok', running: 'run', failed: 'bad' };
export const RUN_LABEL: Record<StepRun['state'], string> = { done: 'Terminó', running: 'Corriendo', failed: 'Falló' };

export const ERR_LABEL: Record<ApiErrorCode, string> = {
  cluster_stopped: 'cluster apagado', service_down: 'servicio caído', not_found: 'no existe', forbidden: 'pedido rechazado', invalid: 'falta algo antes',
  busy: 'hay otro paso corriendo', unsupported: 'no disponible', failed: 'el comando falló',
};

export const toolLabel = (info: PipelineStageInfo | undefined, id: string) => info?.tools.find(t => t.id === id)?.label ?? id;

export const defaults = (t: PipelineTool): Record<string, OptVal> => Object.fromEntries(t.options.map(o => [o.id, o.default]));

/** Lo que dejó una corrida, corto: ruta (última parte) y filas */
export function outLabel(r: StepRun) {
  if (r.stage === 'ml' && r.modelId) return `modelo ${r.modelId}`;
  if (!r.output) return null;
  const name = r.output.path.split('/').filter(Boolean).at(-1) ?? r.output.path;
  return r.output.rows != null ? `${name} · ${nf(r.output.rows)}` : name;
}

/** La etapa de la que sale el dato que usa esta: la anterior, salvo el ML, que es una rama aparte */
export function feeder(st: PipelineState, index: number) {
  if (index <= 0 || st.stages[index].stage === 'ml') return null;
  const p = st.stages[index - 1];
  return p.stage === 'ml' && index >= 2 ? st.stages[index - 2] : p;
}

/** La herramienta que se elige de entrada: la sugerida si se puede usar, si no la primera disponible */
export function pickTool(info: PipelineStageInfo): PipelineTool | undefined {
  return info.tools.find(t => t.recommended && t.available) ?? info.tools.find(t => t.available) ?? info.tools.find(t => t.recommended) ?? info.tools[0];
}
