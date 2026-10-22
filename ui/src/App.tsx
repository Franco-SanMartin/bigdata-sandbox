import type { ComponentType } from 'react';
import { Tooltip } from 'radix-ui';
import { route } from './state/ui';
import { useHotkeys } from './shell/hotkeys';
import { Sidebar } from './shell/Sidebar';
import { Topbar } from './shell/Topbar';
import { ConsoleDrawer } from './shell/ConsoleDrawer';
import { HelpSheet } from './shell/HelpSheet';
import { CommandPalette } from './shell/CommandPalette';
import { ComposeSheet, ConfirmHost, Toaster } from './shell/Overlays';
import { ClusterPage } from './pages/ClusterPage';
import { ConfigPage } from './pages/ConfigPage';
import { ConsolePage } from './pages/OtherPages';
import { HdfsPage } from './pages/hdfs/HdfsPage';
import { YarnPage } from './pages/yarn/YarnPage';
import { PipelinePage } from './pages/pipeline/PipelinePage';
import { DatosPage } from './pages/datos/DatosPage';
import { MlPage } from './pages/ml/MlPage';
import type { PageId } from './state/ui';
import { useSnapshot } from './state/store';

const PAGE: Record<PageId, ComponentType> = {
  cluster: ClusterPage, hdfs: HdfsPage, yarn: YarnPage, pipeline: PipelinePage, datos: DatosPage, ml: MlPage, consola: ConsolePage, config: ConfigPage,
};

export function App() {
  useHotkeys();
  const page = route.use();
  const { error } = useSnapshot();
  const Page = PAGE[page];
  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="shell">
        <Sidebar />
        <Topbar />
        <div className="main">
          <main className="page" id="contenido" key={page}>
            {error && <div className="page-in" style={{ paddingBottom: 0 }}><div className="callout" data-k="bad"><span><b>Sin conexión con el cluster.</b> {error}. Reintentando…</span></div></div>}
            <Page />
          </main>
          <ConsoleDrawer />
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
