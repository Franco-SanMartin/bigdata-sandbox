/* Paleta de comandos (Ctrl+K): ir a cualquier pantalla o ejecutar una acción. */
import { Command } from 'cmdk';
import { Dialog } from 'radix-ui';
import { Brain, ExternalLink, FileCode2, Play, Plus, Power, RotateCcw, Rows3, SquareTerminal, Upload, CircleHelp, Zap } from 'lucide-react';
import { composeOpen, consoleOpen, helpOpen, navigate, paletteOpen } from '../state/ui';
import { useStatus } from '../state/store';
import { addDataNode, applyConfig, pipelineReset, processAction, putExample, startCluster, stopCluster, submitExample, trainModel } from '../state/actions';
import { navVisible } from './nav';

export function CommandPalette() {
  const open = paletteOpen.use();
  const s = useStatus();
  const run = (f: () => unknown) => () => { paletteOpen.set(false); setTimeout(f, 60); };
  const running = s?.phase === 'running';
  const yarn = running && s!.config.services !== 'hdfs';
  const todo = running && s!.config.services === 'todo';
  const webs = s?.processes.filter(p => p.webUrl && p.state === 'up') || [];
  return (
    <Dialog.Root open={open} onOpenChange={paletteOpen.set}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="cmdk" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">Buscar o ejecutar</Dialog.Title>
          <Command label="Buscar o ejecutar" loop>
            <Command.Input placeholder="Buscá una pantalla, un proceso o una acción…" autoFocus />
            <Command.List>
              <Command.Empty>No hay nada con ese nombre.</Command.Empty>
              <Command.Group heading="Ir a">
                {navVisible(!!s?.aula).map(n => <Command.Item key={n.id} value={`ir a ${n.label}`} onSelect={run(() => navigate(n.id))}><n.icon size={15} />{n.label}<span className="end"><kbd>G</kbd><kbd>{n.key.toUpperCase()}</kbd></span></Command.Item>)}
              </Command.Group>
              <Command.Group heading="Cluster">
                {s?.phase === 'stopped' && <Command.Item value="iniciar el cluster arrancar" onSelect={run(() => startCluster())}><Play size={15} />Iniciar el cluster</Command.Item>}
                {running && <Command.Item value="detener el cluster apagar" onSelect={run(stopCluster)}><Power size={15} />Detener el cluster</Command.Item>}
                {running && <Command.Item value="reiniciar el cluster" onSelect={run(() => applyConfig(s!.config))}><RotateCcw size={15} />Reiniciar el cluster</Command.Item>}
                <Command.Item value="ver docker-compose.yml compose" onSelect={run(() => composeOpen.set(true))}><FileCode2 size={15} />Ver el docker-compose.yml</Command.Item>
              </Command.Group>
              {running && <Command.Group heading="Procesos">
                {s!.processes.filter(p => p.controllable).map(p => p.state === 'up'
                  ? <Command.Item key={p.id} value={`apagar ${p.name} ${p.id}`} onSelect={run(() => processAction(p, 'stop'))}><Power size={15} />Apagar {p.name}<span className="end">{p.id}</span></Command.Item>
                  : (p.state === 'down' || p.state === 'off') ? <Command.Item key={p.id} value={`prender ${p.name} ${p.id}`} onSelect={run(() => processAction(p, 'start'))}><Zap size={15} />Prender {p.name}<span className="end">{p.id}</span></Command.Item> : null)}
                <Command.Item value="sumar datanode en caliente" onSelect={run(addDataNode)}><Plus size={15} />Sumar un DataNode en caliente</Command.Item>
              </Command.Group>}
              {running && <Command.Group heading="Datos y trabajos">
                <Command.Item value="subir ventas_grandes.csv hdfs put" onSelect={run(() => putExample('ventas'))}><Upload size={15} />Subir ventas_grandes.csv a HDFS</Command.Item>
                <Command.Item value="subir numeros.txt hdfs put" onSelect={run(() => putExample('numeros'))}><Upload size={15} />Subir numeros.txt a HDFS</Command.Item>
                <Command.Item value="subir ventas_sucias.csv hdfs put pipeline" onSelect={run(() => putExample('sucias'))}><Upload size={15} />Subir ventas_sucias.csv a HDFS</Command.Item>
                {yarn && <Command.Item value="lanzar mapreduce ventas" onSelect={run(() => submitExample('mr-ventas'))}><Rows3 size={15} />Lanzar MapReduce: ventas por producto</Command.Item>}
                {todo && <Command.Item value="lanzar hive tez consulta" onSelect={run(() => submitExample('hive-ventas'))}><Rows3 size={15} />Lanzar consulta de Hive (Tez)</Command.Item>}
                {todo && <Command.Item value="lanzar spark ventas.py" onSelect={run(() => submitExample('spark-ventas'))}><Rows3 size={15} />Lanzar ventas.py en Spark</Command.Item>}
                <Command.Item value="revisar hdfs fsck bloques" onSelect={run(() => navigate('hdfs'))}><Rows3 size={15} />Revisar HDFS con fsck</Command.Item>
                <Command.Item value="pipeline reiniciar volver a la primera etapa" onSelect={run(pipelineReset)}><RotateCcw size={15} />Reiniciar el pipeline</Command.Item>
                {todo && <Command.Item value="entrenar regresion lineal scikit-learn ml" onSelect={run(() => trainModel({ task: 'regresion', model: 'lineal', engine: 'sklearn', trainPct: 80 }))}><Brain size={15} />Entrenar regresión lineal (scikit-learn)</Command.Item>}
                {todo && <Command.Item value="entrenar arbol de decision clasificacion scikit-learn ml" onSelect={run(() => trainModel({ task: 'clasificacion', model: 'arbol', engine: 'sklearn', trainPct: 80 }))}><Brain size={15} />Entrenar árbol de decisión (scikit-learn)</Command.Item>}
                {todo && <Command.Item value="entrenar kmeans clustering grupos scikit-learn ml" onSelect={run(() => trainModel({ task: 'clustering', model: 'kmeans', engine: 'sklearn', trainPct: 80 }))}><Brain size={15} />Agrupar clientes con KMeans (scikit-learn)</Command.Item>}
              </Command.Group>}
              {webs.length > 0 && <Command.Group heading="Páginas del cluster">
                {webs.map(p => <Command.Item key={p.id} value={`abrir pagina ${p.name} ${p.webUrl}`} onSelect={run(() => window.open(p.webUrl, '_blank', 'noopener'))}><ExternalLink size={15} />{p.name}<span className="end">{p.webUrl!.replace('http://', '')}</span></Command.Item>)}
              </Command.Group>}
              <Command.Group heading="Interfaz">
                <Command.Item value="consola actividad" onSelect={run(() => consoleOpen.set(v => !v))}><SquareTerminal size={15} />Mostrar u ocultar la consola<span className="end"><kbd>Ctrl</kbd><kbd>J</kbd></span></Command.Item>
                <Command.Item value="ayuda" onSelect={run(() => helpOpen.set(true))}><CircleHelp size={15} />Ayuda de esta pantalla<span className="end"><kbd>?</kbd></span></Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
          <div className="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> elegir</span><span><kbd>Enter</kbd> ejecutar</span><span><kbd>Esc</kbd> cerrar</span></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
