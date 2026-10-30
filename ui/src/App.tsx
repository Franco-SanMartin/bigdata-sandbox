import { lazy, type ComponentType } from 'react';
import { Tooltip } from 'radix-ui';
import { route } from './state/ui';
import { useHotkeys } from './shell/hotkeys';
import { Sidebar } from './shell/Sidebar';
import { Topbar } from './shell/Topbar';
import { ConsoleDrawer } from './shell/ConsoleDrawer';
import { TerminalDrawer } from './shell/TerminalDrawer';
import { HelpSheet } from './shell/HelpSheet';
import { CommandPalette } from './shell/CommandPalette';
import { ComposeSheet, ConfirmHost, Toaster } from './shell/Overlays';
import type { PageId } from './state/ui';
import { ConnectionBand, PageFrame } from './shell/PageFrame';
import { ReturnBand } from './shell/ReturnBand';

// Cada pantalla en su propio archivo: al abrir la interfaz solo baja la que se ve
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then(m => ({ default: m[name] })));

const PAGE: Record<PageId, ComponentType> = {
  inicio: page(() => import('./pages/InicioPage'), 'InicioPage'),
  practicas: page(() => import('./pages/practicas/PracticasPage'), 'PracticasPage'),
  cluster: page(() => import('./pages/ClusterPage'), 'ClusterPage'),
  hdfs: page(() => import('./pages/hdfs/HdfsPage'), 'HdfsPage'),
  yarn: page(() => import('./pages/yarn/YarnPage'), 'YarnPage'),
  pipeline: page(() => import('./pages/pipeline/PipelinePage'), 'PipelinePage'),
  datos: page(() => import('./pages/datos/DatosPage'), 'DatosPage'),
  comparar: page(() => import('./pages/comparar/CompararPage'), 'CompararPage'),
  ml: page(() => import('./pages/ml/MlPage'), 'MlPage'),
  aula: page(() => import('./pages/aula/AulaPage'), 'AulaPage'),
  consola: page(() => import('./pages/OtherPages'), 'ConsolePage'),
  config: page(() => import('./pages/ConfigPage'), 'ConfigPage'),
};

export function App() {
  useHotkeys();
  const page = route.use();
  const Page = PAGE[page];
  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="shell">
        <Sidebar />
        <Topbar />
        <div className="main">
          <ConnectionBand />
          <ReturnBand />
          <main className="page" id="contenido" key={page}>
            <PageFrame page={page}><Page /></PageFrame>
          </main>
          <ConsoleDrawer />
          <TerminalDrawer />
        </div>
      </div>
      <CommandPalette />
      <HelpSheet />
      <ComposeSheet />
      <ConfirmHost />
      <Toaster />
    </Tooltip.Provider>
  );
}
