/* Capacidades del cluster en vivo y la ejecución de su arreglo. */
import { useMemo } from 'react';
import { capabilities, type CapId, type Capabilities, type Capability, type Fix } from '../lib/capabilities';
import { getSnapshot, useStatus } from './store';
import { applyConfig, processAction, resetVolume, startCluster, stopCluster } from './actions';
import { toast } from './ui';

export function useCapabilities(): Capabilities {
  const s = useStatus();
  return useMemo(() => capabilities(s), [s]);
}

export function useCapability(id: CapId): Capability {
  return useCapabilities()[id];
}

/** Ejecuta el arreglo de una capacidad bloqueada. Las acciones ya piden confirmación cuando corresponde */
export async function runFix(fix: Fix | undefined) {
  const s = getSnapshot().status;
  if (!fix || !s) return;
  switch (fix.kind) {
    case 'start': return startCluster();
    case 'stop': return stopCluster();
    case 'restart': return applyConfig(s.config);
    case 'reset-volume': return resetVolume();
    case 'config': return applyConfig({ ...s.config, ...fix.change });
    case 'process-start': {
      const p = s.processes.find(x => x.id === fix.process);
      if (p) return processAction(p, 'start');
      return;
    }
    case 'wait': toast({ title: 'Ya está en camino', description: 'No hace falta hacer nada: se habilita solo.', kind: 'info' }); return;
  }
}
