/* El aula (versión empresa, en el maestro): cada PC del laboratorio es una lámpara. Ámbar
   mientras se suma, verde cuando ya es parte del cluster, ámbar con aviso si dejó de contestar y
   roja caída. Arriba, lo que hace falta para sumar PCs (IP, código y la línea para Veyon); abajo,
   cuándo se puede apagar el aula sin perder nada. Pensada para proyectarla con la Demostración
   de Veyon: lámparas grandes y pantalla completa. */
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Maximize2, Minimize2, MonitorSmartphone, Power } from 'lucide-react';
import { useSnapshot } from '../../state/store';
import { useApi } from '../../state/useApi';
import { EmptyState, PageHeader, Panel, Stat, StatRow, type Tone } from '../../components/base';
import { Meter } from '../../components/ui';
import { mbLabel, nf, plural } from '../../lib/format';
import { filasDelAula, LAMPARA } from '../../lib/aula';
import type { AulaPc, AulaStatus } from '../../api/types';
import './aula.css';

function Copiar({ texto, label }: { texto: string; label: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="btn btn-sm" aria-label={label}
      onClick={() => { void navigator.clipboard?.writeText(texto).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }); }}>
      {ok ? <Check size={13} /> : <Copy size={13} />}{ok ? 'Copiado' : 'Copiar'}
    </button>
  );
}

/** IP, código y la línea para Veyon: lo que el profe dicta o proyecta para sumar PCs */
function Sumar({ a }: { a: AulaStatus }) {
  if (a.red !== 'wireguard') {
    return (
      <Panel title="Aula simulada" sub="RED=docker">
        <p className="au-nota">Las PCs son contenedores en la misma compu. Para sumar otra, copiá el bloque de <code>pc02</code> en <code>aula-simulada.yml</code>.</p>
      </Panel>
    );
  }
  return (
    <section className="au-sumar" aria-label="Para sumar PCs">
      <div className="au-dato"><span>IP de la PC del profe</span><b className="mono">{a.ipAula ?? '—'}</b></div>
      <div className="au-dato"><span>Código de la clase</span><b className="mono au-codigo">{a.codigo ?? '—'}</b></div>
      <div className="au-veyon">
        <span>En Veyon, con las PCs elegidas: <b>Transferencia de archivos</b> (la imagen y el .cmd) y después <b>Ejecutar programa</b> con</span>
        {a.lineaVeyon
          ? <div className="au-linea"><code className="mono">{a.lineaVeyon}</code><Copiar texto={a.lineaVeyon} label="Copiar la línea para Veyon" /></div>
          : <code className="mono">empresa-alumno.cmd {a.ipAula ?? 'IP'} {a.codigo ?? 'CODIGO'}</code>}
        <small>Túnel WireGuard ({a.tunel === 'go' ? 'wireguard-go' : 'módulo del kernel'}, MTU {a.mtu ?? '—'}) · réplica {a.replicacion ?? '—'} · las PCs no abren puertos</small>
      </div>
    </section>
  );
}

function Lampara({ pc }: { pc: AulaPc }) {
  const l = LAMPARA[pc.estado];
  const nm = pc.nodemanager;
  const mb = nm?.mb ?? pc.prestaMb ?? null;
  const vc = nm?.vcores ?? pc.prestaVcores ?? null;
  return (
    <li className="au-pc" data-k={l.k} aria-label={`${pc.nodo}${pc.nombre ? ` (${pc.nombre})` : ''}: ${l.label}${pc.motivo ? `, ${pc.motivo}` : ''}`}>
      <div className="au-pc-h">
        <span className="au-lamp" data-k={l.k} aria-hidden="true" />
        <b className="mono">{pc.nodo}</b>
        {pc.nombre && <span className="au-win">{pc.nombre}</span>}
      </div>
      <div className="au-pc-estado">{l.label}{pc.motivo && <small>{pc.motivo}</small>}</div>
      <dl className="au-pc-d">
        <div><dt>Presta</dt><dd className="num">{mb != null ? mbLabel(mb) : '—'}{vc != null && <small> · {vc} cores</small>}</dd></div>
        <div><dt>Bloques</dt><dd className="num">{pc.datanode ? nf(pc.datanode.bloques) : '—'}</dd></div>
        {pc.dockerRamMb != null && <div><dt>Docker</dt><dd className="num">{mbLabel(pc.dockerRamMb)}{pc.ramPcGb ? <small> · PC de {pc.ramPcGb} GB</small> : null}</dd></div>}
        {pc.ipTunel && <div><dt>Túnel</dt><dd className="mono">{pc.ipTunel}</dd></div>}
      </dl>
      {nm && nm.mb > 0 && <Meter value={nm.mbUsados} max={nm.mb} kind="run" label={`Memoria de YARN en uso en ${pc.nodo}`} />}
      {nm && nm.contenedores > 0 && <small className="au-pc-c">{plural(nm.contenedores, 'contenedor', 'contenedores')} corriendo</small>}
    </li>
  );
}

function Apagar({ a }: { a: AulaStatus }) {
  const { listo, bloquesEnMaestro: en, bloques, porque } = a.apagar;
  return (
    <section className="au-apagar" data-k={listo ? 'ok' : 'run'} role="status" aria-live="polite">
      <Power size={20} aria-hidden="true" />
      <div className="au-apagar-t">
        <b>{listo ? 'Ya pueden apagar' : 'Todavía no apaguen las PCs'}</b>
        <span>{porque}</span>
      </div>
      {bloques > 0 && <div className="au-apagar-m"><Meter value={en} max={bloques} kind={listo ? 'ok' : 'run'} label="Bloques con copia en el maestro" /><small className="num">{nf(en)} / {nf(bloques)} bloques en el maestro</small></div>}
    </section>
  );
}

export function AulaPage() {
  const { status } = useSnapshot();
  const enAula = !!status?.aula;
  const demo = !status?.aula && status != null;
  const { data: a, error, reload } = useApi(x => x.aula(), []);
  // Sin evento propio: se vuelve a pedir cada 2 s (los latidos y el túnel cambian solos)
  useEffect(() => { const t = setInterval(reload, 2000); return () => clearInterval(t); }, [reload]);
  const caja = useRef<HTMLDivElement>(null);
  const [completa, setCompleta] = useState(false);
  useEffect(() => { const f = () => setCompleta(!!document.fullscreenElement); document.addEventListener('fullscreenchange', f); return () => document.removeEventListener('fullscreenchange', f); }, []);

  if (!a) {
    return (
      <div className="page-in">
        <PageHeader title="El aula" sub="Las PCs del laboratorio armando un solo cluster" />
        {error
          ? <EmptyState kind="error" title={enAula ? 'No se pudo leer el aula' : 'Esta interfaz no es la del maestro del aula'}>
              {enAula ? error : 'La vista Aula es de la versión empresa con ROL=maestro (la PC del profe): ahí se ven las PCs que se suman por la red del aula.'}
            </EmptyState>
          : <EmptyState kind="loading" title="Leyendo el aula…" />}
      </div>
    );
  }
  const total = a.pcs.length;
  const tono: Tone = a.resumen.caida ? 'bad' : a.resumen.sumandose || a.resumen['sin-respuesta'] ? 'run' : total ? 'ok' : 'off';
  const filas = filasDelAula(a.pcs);
  return (
    <div className="page-in au" ref={caja}>
      <PageHeader title="El aula"
        sub={<>Cada PC es una lámpara: ámbar mientras se suma, verde cuando ya es parte del cluster{demo && ' · demo: así se ve con las 11 PCs del 27/10'}</>}
        status={{ k: tono, label: total ? `${a.resumen.arriba} de ${plural(total, 'PC')} arriba` : 'Ninguna PC todavía' }}
        actions={<button type="button" className="btn btn-sm" onClick={() => completa ? document.exitFullscreen() : caja.current?.requestFullscreen()}>
          {completa ? <Minimize2 size={13} /> : <Maximize2 size={13} />}{completa ? 'Salir' : 'Pantalla completa'}</button>} />
      <Sumar a={a} />
      <StatRow label="El aula en números">
        <Stat label="PCs arriba" value={<>{a.resumen.arriba}<small>/ {total}</small></>} k={a.resumen.caida ? 'bad' : undefined}
          sub={[a.resumen.sumandose && `${a.resumen.sumandose} sumándose`, a.resumen['sin-respuesta'] && `${a.resumen['sin-respuesta']} sin respuesta`, a.resumen.caida && `${a.resumen.caida} caída${a.resumen.caida > 1 ? 's' : ''}`].filter(Boolean).join(' · ') || 'todas andando'} />
        <Stat label="Memoria para trabajos" value={mbLabel(a.yarn.mb)} sub={`${mbLabel(a.yarn.mbUsados)} en uso · lo que suma cada NodeManager`} />
        <Stat label="Cores para trabajos" value={nf(a.yarn.vcores)} sub={`${a.yarn.vcoresUsados} en uso · ${plural(a.yarn.contenedores, 'contenedor', 'contenedores')}`} />
        <Stat label="Bloques en HDFS" value={nf(a.hdfs.bloques)} k={a.hdfs.perdidos ? 'bad' : a.hdfs.subReplicados ? 'run' : undefined}
          sub={a.hdfs.perdidos ? `${a.hdfs.perdidos} perdidos` : a.hdfs.subReplicados ? `${a.hdfs.subReplicados} con copias de menos` : `réplica ${a.replicacion ?? '—'}, una en el maestro`} />
      </StatRow>
      <Apagar a={a} />
      <section className="au-sala" aria-label="Las PCs del laboratorio">
        <div className="au-fila">
          <h3>/profe</h3>
          <ul>
            <li className="au-pc au-maestro" data-k={a.maestro.estado === 'vivo' ? 'ok' : a.maestro.estado === 'no' ? 'off' : 'bad'}>
              <div className="au-pc-h"><span className="au-lamp" data-k={a.maestro.estado === 'vivo' ? 'ok' : 'bad'} aria-hidden="true" /><b className="mono">maestro</b><span className="au-win"><MonitorSmartphone size={12} /> PC del profe</span></div>
              <div className="au-pc-estado">NameNode, ResourceManager, Hive{a.red === 'wireguard' && ' y el hub del túnel'}<small>su DataNode guarda una copia de cada bloque (ARCHIVE)</small></div>
              <dl className="au-pc-d"><div><dt>Bloques</dt><dd className="num">{nf(a.maestro.bloques)}</dd></div><div><dt>En disco</dt><dd className="num">{mbLabel(a.maestro.usadoMb)}</dd></div></dl>
            </li>
          </ul>
        </div>
        {filas.length === 0 && <EmptyState kind="empty" title="Todavía no se sumó ninguna PC">Mandá el .cmd por Veyon con la línea de arriba: cada PC aparece acá apenas se inscribe.</EmptyState>}
        {filas.map(([fila, pcs]) => (
          <div className="au-fila" key={fila}>
            <h3>{fila}</h3>
            <ul>{pcs.map(pc => <Lampara key={pc.nodo} pc={pc} />)}</ul>
          </div>
        ))}
      </section>
      <div className="au-pie">
        <ul className="au-leyenda" aria-label="Qué quiere decir cada color">
          {(['sumandose', 'arriba', 'sin-respuesta', 'caida'] as const).map(e => <li key={e}><span className="au-lamp" data-k={LAMPARA[e].k} />{LAMPARA[e].label}<small>{LAMPARA[e].que}</small></li>)}
        </ul>
        {a.eventos.length > 0 && (
          <Panel title="Lo último de la inscripción" className="au-eventos">
            <ol>{a.eventos.slice(-8).reverse().map((e, i) => <li key={i} className="mono">{e}</li>)}</ol>
          </Panel>
        )}
      </div>
    </div>
  );
}
