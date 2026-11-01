/* El aula (versión empresa, en el maestro), como un plano del laboratorio: adelante la PC del
   profe (el maestro), y atrás las filas, que son los racks de HDFS, con cada PC en su lugar. Cada
   PC es una lámpara: ámbar mientras se suma, verde cuando ya es parte del cluster, ámbar con aviso
   si dejó de contestar y roja caída; adentro, cuánta memoria de YARN presta y usa, sus bloques
   y sus contenedores. Arriba, el aula en números y cuándo se puede apagar sin perder nada; al
   costado, cómo sumar PCs por Veyon y el detalle de la PC elegida.
   Pensada para proyectarla con la Demostración de Veyon: pantalla completa y mucho contraste. */
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Maximize2, Minimize2, MonitorSmartphone, Power, X } from 'lucide-react';
import { useSnapshot } from '../../state/store';
import { useApi } from '../../state/useApi';
import { EmptyState, PageHeader, type Tone } from '../../components/base';
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

/* ---------- Arriba: el aula en números y si ya se puede apagar ---------- */

function Numeros({ a }: { a: AulaStatus }) {
  const total = a.pcs.length;
  const r = a.resumen;
  return (
    <section className="au-top" aria-label="El aula en números">
      <div className="au-kpi" data-k={r.caida ? 'bad' : r.sumandose || r['sin-respuesta'] ? 'run' : 'ok'}>
        <span>PCs en el cluster</span>
        <b className="num">{r.arriba}<small>/ {total}</small></b>
        <ul className="au-kpi-st">
          {(['arriba', 'sumandose', 'sin-respuesta', 'caida'] as const).filter(e => r[e] > 0).map(e => (
            <li key={e}><span className="au-lamp" data-k={LAMPARA[e].k} aria-hidden="true" />{r[e]} {LAMPARA[e].label.toLowerCase()}</li>
          ))}
        </ul>
      </div>
      <div className="au-kpi">
        <span>Memoria para trabajos</span>
        <b className="num">{mbLabel(a.yarn.mb)}</b>
        <Meter value={a.yarn.mbUsados} max={Math.max(a.yarn.mb, 1)} kind="run" label="Memoria de YARN en uso en el aula" />
        <small>{mbLabel(a.yarn.mbUsados)} en uso · la suma de lo que presta cada PC</small>
      </div>
      <div className="au-kpi">
        <span>Cores para trabajos</span>
        <b className="num">{nf(a.yarn.vcores)}</b>
        <Meter value={a.yarn.vcoresUsados} max={Math.max(a.yarn.vcores, 1)} kind="run" label="Cores de YARN en uso en el aula" />
        <small>{a.yarn.vcoresUsados} en uso · {plural(a.yarn.contenedores, 'contenedor', 'contenedores')}</small>
      </div>
      <div className="au-kpi" data-k={a.hdfs.perdidos ? 'bad' : a.hdfs.subReplicados ? 'run' : undefined}>
        <span>Bloques en HDFS</span>
        <b className="num">{nf(a.hdfs.bloques)}</b>
        <small>{a.hdfs.perdidos ? `${a.hdfs.perdidos} perdidos` : a.hdfs.subReplicados ? `${a.hdfs.subReplicados} con copias de menos: se están copiando` : `réplica ${a.replicacion ?? '—'}: una copia en una PC y otra en el maestro`}</small>
      </div>
      <Apagar a={a} />
    </section>
  );
}

function Apagar({ a }: { a: AulaStatus }) {
  const { listo, bloquesEnMaestro: en, bloques, porque } = a.apagar;
  return (
    <section className="au-apagar" data-k={listo ? 'ok' : 'run'} role="status" aria-live="polite">
      <div className="au-apagar-h"><Power size={18} aria-hidden="true" /><b>{listo ? 'Ya pueden apagar' : 'Todavía no apaguen las PCs'}</b></div>
      <span>{porque}</span>
      {bloques > 0 && <><Meter value={en} max={bloques} kind={listo ? 'ok' : 'run'} label="Bloques con copia en el maestro" /><small className="num">{nf(en)} de {nf(bloques)} bloques ya tienen copia en el maestro</small></>}
    </section>
  );
}

/* ---------- El plano: el maestro adelante y las filas ---------- */

function Maestro({ a }: { a: AulaStatus }) {
  const k = a.maestro.estado === 'vivo' ? 'ok' : a.maestro.estado === 'no' ? 'off' : 'bad';
  const roles = ['NameNode', 'ResourceManager', 'Hive', 'Spark History', ...(a.red === 'wireguard' ? ['hub del túnel'] : [])];
  return (
    <div className="au-frente">
      <span className="au-frente-t">Frente del aula</span>
      <div className="au-maestro" data-k={k}>
        <div className="au-maestro-h">
          <span className="au-lamp au-lamp-lg" data-k={k} aria-hidden="true" />
          <b className="mono">maestro</b>
          <span className="au-win"><MonitorSmartphone size={13} aria-hidden="true" />PC del profe</span>
        </div>
        <ul className="au-roles">{roles.map(r => <li key={r}>{r}</li>)}</ul>
        <dl className="au-maestro-d">
          <div><dt>Bloques</dt><dd className="num">{nf(a.maestro.bloques)}</dd></div>
          <div><dt>En disco</dt><dd className="num">{mbLabel(a.maestro.usadoMb)}</dd></div>
          <div><dt>Copia</dt><dd>una de cada bloque (ARCHIVE)</dd></div>
        </dl>
      </div>
    </div>
  );
}

function Pc({ pc, sel, onSel }: { pc: AulaPc; sel: boolean; onSel: () => void }) {
  const l = LAMPARA[pc.estado];
  const nm = pc.nodemanager;
  const mb = nm?.mb ?? pc.prestaMb ?? null;
  const vc = nm?.vcores ?? pc.prestaVcores ?? null;
  const cont = nm?.contenedores ?? 0;
  return (
    <li>
      <button type="button" className="au-pc" data-k={l.k} data-sel={sel || undefined} onClick={onSel} aria-pressed={sel}
        aria-label={`${pc.nodo}${pc.nombre ? ` (${pc.nombre})` : ''}: ${l.label}${pc.motivo ? `, ${pc.motivo}` : ''}`}>
        <span className="au-pc-h">
          <span className="au-lamp" data-k={l.k} aria-hidden="true" />
          <b className="mono">{pc.nodo}</b>
          {pc.nombre && <span className="au-win">{pc.nombre}</span>}
        </span>
        <span className="au-pc-st">{l.label}{pc.motivo && <small>{pc.motivo}</small>}</span>
        <span className="au-pc-mem">
          {nm && nm.mb > 0
            ? <Meter value={nm.mbUsados} max={nm.mb} kind="run" label={`Memoria de YARN en uso en ${pc.nodo}`} />
            : <span className="au-pc-mem-0" aria-hidden="true" />}
          <small className="num">{mb != null ? mbLabel(mb) : '—'}{vc != null && ` · ${vc} cores`}</small>
        </span>
        <span className="au-pc-f">
          <span className="num">{pc.datanode ? `${nf(pc.datanode.bloques)} bloques` : 'sin DataNode'}</span>
          {cont > 0 && <span className="au-cont" title={plural(cont, 'contenedor', 'contenedores') + ' corriendo'}>{Array.from({ length: Math.min(cont, 8) }, (_, i) => <i key={i} />)}{cont > 8 && <em>+{cont - 8}</em>}</span>}
        </span>
      </button>
    </li>
  );
}

function Fila({ fila, pcs, sel, onSel }: { fila: string; pcs: AulaPc[]; sel: string | null; onSel: (n: string) => void }) {
  const n = /^\/fila(\d+)$/.exec(fila)?.[1];
  const arriba = pcs.filter(p => p.estado === 'arriba').length;
  const mb = pcs.reduce((s, p) => s + (p.nodemanager?.mb ?? p.prestaMb ?? 0), 0);
  return (
    <div className="au-lane">
      <header>
        <b>{n ? `Fila ${n}` : 'Sin fila'}</b>
        <span className="mono">rack {fila}</span>
        <span className="au-lane-r">{arriba} de {plural(pcs.length, 'PC')} arriba · {mbLabel(mb)} para trabajos</span>
      </header>
      <ul className="au-pcs">{pcs.map(pc => <Pc key={pc.nodo} pc={pc} sel={sel === pc.nodo} onSel={() => onSel(pc.nodo)} />)}</ul>
    </div>
  );
}

/* ---------- Al costado: el detalle de una PC y cómo sumar PCs ---------- */

function Detalle({ pc, ahora, onClose }: { pc: AulaPc; ahora: number; onClose: () => void }) {
  const l = LAMPARA[pc.estado];
  const nm = pc.nodemanager, dn = pc.datanode, t = pc.tunel;
  const filas: [string, string | null | undefined][] = [
    ['PC', pc.nombre],
    ['Procesador', pc.cpu],
    ['RAM de la PC', pc.ramPcGb ? `${pc.ramPcGb} GB` : null],
    ['RAM de Docker', pc.dockerRamMb != null ? mbLabel(pc.dockerRamMb) : null],
    ['Presta a YARN', nm ? `${mbLabel(nm.mb)} · ${nm.vcores} cores` : pc.prestaMb != null ? `${mbLabel(pc.prestaMb)} · ${pc.prestaVcores ?? '—'} cores` : null],
    ['En uso', nm ? `${mbLabel(nm.mbUsados)} · ${nm.vcoresUsados} cores · ${plural(nm.contenedores, 'contenedor', 'contenedores')}` : null],
    ['DataNode', dn ? `${dn.estado} · ${nf(dn.bloques)} bloques · ${mbLabel(dn.usadoMb)} · último latido hace ${dn.ultimoS} s` : null],
    ['Túnel', pc.ipTunel ? `${pc.ipTunel}${t?.saludoHaceS != null ? ` · saludo hace ${t.saludoHaceS} s` : ''}` : null],
    ['Tráfico', t ? `↓ ${mbLabel(t.rxMb)} · ↑ ${mbLabel(t.txMb)}` : null],
    ['Se sumó', pc.inscriptaEn ? `hace ${Math.max(0, Math.round((ahora - pc.inscriptaEn) / 60000))} min` : null],
  ];
  return (
    <section className="au-card au-det" data-k={l.k} aria-label={`Detalle de ${pc.nodo}`}>
      <header>
        <span className="au-lamp au-lamp-lg" data-k={l.k} aria-hidden="true" />
        <b className="mono">{pc.nodo}</b>
        <span className="au-det-st">{l.label}</span>
        <button type="button" className="btn btn-sm btn-icon btn-ghost" onClick={onClose} aria-label="Cerrar el detalle"><X size={14} /></button>
      </header>
      <p>{pc.motivo ?? l.que}</p>
      <dl>{filas.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </section>
  );
}

function Sumar({ a }: { a: AulaStatus }) {
  if (a.red !== 'wireguard') {
    return (
      <section className="au-card au-sumar">
        <h3>Aula simulada</h3>
        <p className="au-nota">Las PCs son contenedores en la misma compu (<code>RED=docker</code>). Para sumar otra, copiá el bloque de <code>pc02</code> en <code>aula-simulada.yml</code>.</p>
      </section>
    );
  }
  const linea = a.lineaVeyon ?? `empresa-alumno.cmd ${a.ipAula ?? 'IP'} ${a.codigo ?? 'CODIGO'}`;
  return (
    <section className="au-card au-sumar" aria-label="Para sumar PCs">
      <h3>Sumar PCs</h3>
      <div className="au-datos">
        <div><span>IP de la PC del profe</span><b className="mono">{a.ipAula ?? '—'}</b></div>
        <div><span>Código de la clase</span><b className="mono au-codigo">{a.codigo ?? '—'}</b></div>
      </div>
      <ol className="au-pasos">
        <li><b>En Veyon, elegí las PCs</b> y mandá por <b>Transferencia de archivos</b> la imagen <code>bigdata-sandbox-trabajador.tar.gz</code> y <code>empresa-alumno.cmd</code>.</li>
        <li>
          <b>Ejecutar programa</b> con esta línea:
          <div className="au-linea"><code className="mono">{linea}</code><Copiar texto={linea} label="Copiar la línea para Veyon" /></div>
        </li>
        <li><b>Esperá la lámpara verde</b>: cada PC aparece en su fila apenas se inscribe (ámbar) y se pone verde cuando su DataNode y su NodeManager se suman.</li>
      </ol>
      <small className="au-nota">Túnel WireGuard ({a.tunel === 'go' ? 'wireguard-go' : 'módulo del kernel'}, MTU {a.mtu ?? '—'}) · réplica {a.replicacion ?? '—'} · las PCs no abren puertos</small>
    </section>
  );
}

/* ---------- La pantalla ---------- */

export function AulaPage() {
  const { status } = useSnapshot();
  const enAula = !!status?.aula;
  const demo = !status?.aula && status != null;
  const { data: a, error, reload } = useApi(x => x.aula(), []);
  // Sin evento propio: se vuelve a pedir cada 2 s (los latidos y el túnel cambian solos)
  useEffect(() => { const t = setInterval(reload, 2000); return () => clearInterval(t); }, [reload]);
  const caja = useRef<HTMLDivElement>(null);
  const [completa, setCompleta] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
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
  const elegida = a.pcs.find(p => p.nodo === sel) ?? null;
  return (
    <div className="page-in au" ref={caja}>
      <PageHeader title="El aula"
        sub={<>Las PCs del laboratorio armando un solo cluster: cada fila es un rack de HDFS{demo && ' · demo: así se ve con las 11 PCs del 27/10'}</>}
        status={{ k: tono, label: total ? `${a.resumen.arriba} de ${plural(total, 'PC')} arriba` : 'Ninguna PC todavía' }}
        actions={<button type="button" className="btn btn-sm" onClick={() => completa ? document.exitFullscreen() : caja.current?.requestFullscreen()}>
          {completa ? <Minimize2 size={13} /> : <Maximize2 size={13} />}{completa ? 'Salir' : 'Pantalla completa'}</button>} />
      <Numeros a={a} />
      <div className="au-main">
        <section className="au-plano" aria-label="El plano del laboratorio">
          <Maestro a={a} />
          {filas.length === 0 && <EmptyState kind="empty" title="Todavía no se sumó ninguna PC">Mandá el .cmd por Veyon con la línea de al lado: cada PC aparece acá apenas se inscribe.</EmptyState>}
          {filas.map(([fila, pcs]) => <Fila key={fila} fila={fila} pcs={pcs} sel={sel} onSel={n => setSel(s => (s === n ? null : n))} />)}
          <ul className="au-leyenda" aria-label="Qué quiere decir cada color">
            {(['sumandose', 'arriba', 'sin-respuesta', 'caida'] as const).map(e => <li key={e}><span className="au-lamp" data-k={LAMPARA[e].k} aria-hidden="true" /><b>{LAMPARA[e].label}</b><small>{LAMPARA[e].que}</small></li>)}
          </ul>
        </section>
        <aside className="au-side">
          {elegida && <Detalle pc={elegida} ahora={a.ahora} onClose={() => setSel(null)} />}
          <Sumar a={a} />
          {a.eventos.length > 0 && (
            <section className="au-card au-eventos" aria-label="Lo último de la inscripción">
              <h3>Lo último</h3>
              <ol>{a.eventos.slice(-8).reverse().map((e, i) => <li key={i} className="mono">{e}</li>)}</ol>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
