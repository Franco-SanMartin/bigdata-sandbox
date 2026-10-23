/* Diagrama sinóptico del cluster: cada componente es un módulo con su lámpara de estado,
   unidos por cables. Sirve de vista previa de una configuración (con lo que se agrega y lo
   que se apaga) y de vista en vivo (lámparas, bloques reales y re-replicación animada). */
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import type { ClusterConfig, DataNode, HdfsFile, Process } from '../api/types';
import { blockSizeLabel, blockSizeMb, processSpecs } from '../lib/cluster';

const DATASET_MB = 5.93;
type Part = 'coord' | 'meta' | 'rack' | 'chips' | 'compute' | 'services' | 'mongo' | 'jupyter';
export type Highlight = keyof ClusterConfig | null;
const PARTS: Partial<Record<keyof ClusterConfig, Part[]>> = {
  datanodes: ['rack'], replication: ['chips'], blockSize: ['chips'], namenodes: ['coord', 'meta'],
  services: ['compute', 'services'], mongodb: ['mongo'], jupyter: ['jupyter'],
};
type Lamp = 'off' | 'start' | 'up' | 'down';
type Tag = 'new' | 'gone' | undefined;

export function blockPlan(c: ClusterConfig) {
  const mb = blockSizeMb(c.blockSize) || 128;
  const blocks = Math.ceil(DATASET_MB / mb);
  const reps = Math.min(c.replication, c.datanodes);
  const per = Array.from({ length: c.datanodes }, () => [] as number[]);
  for (let b = 0; b < blocks; b++) for (let k = 0; k < reps; k++) per[(b + k) % c.datanodes].push(b + 1);
  return { mb, blocks, reps, per, missing: blocks * Math.max(0, c.replication - c.datanodes) };
}

interface Chip { key: string; b: string; label: string; kind: string; ghost?: boolean; under?: boolean; tip: string }

interface Props {
  config: ClusterConfig;
  /** En vivo: estados de los procesos y bloques reales. Sin esto, es una vista previa */
  processes?: Process[];
  dataNodes?: DataNode[];
  files?: HdfsFile[];
  /** Vista previa: configuración que está corriendo, para marcar lo nuevo y lo que se apaga */
  base?: ClusterConfig | null;
  highlight?: Highlight;
  selected?: string | null;
  onSelect?: (id: string) => void;
  now?: number;
}

const fit = (t: string, px: number, cw = 6.9) => (t.length * cw <= px ? t : t.slice(0, Math.max(1, Math.floor(px / cw) - 1)) + '…');
const fileKind = (f: HdfsFile) => /ventas_grandes/.test(f.path) ? 'a' : f.path.startsWith('/apps/') ? 'lib' : /numeros/.test(f.path) ? 'num' : ({ Pig: 'mr', Hive: 'tez', Spark: 'spark', pandas: 'uno' } as Record<string, string>)[f.writtenBy] || 'num';
const fileLetter = (f: HdfsFile) => { const n = f.path.split('/').pop() || ''; return /^part-/.test(n) ? (f.path.split('/').slice(-2)[0][0] || 'p') : n.startsWith('spark-libs') ? 's' : n.startsWith('tez') ? 't' : n[0] || 'b'; };

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    setW(Math.round(el.getBoundingClientRect().width));
    const ro = new ResizeObserver(e => setW(Math.round(e[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Corta un texto corto en renglones de a lo sumo `max` caracteres, sin partir palabras */
function wrap(t: string, max: number): string[] {
  const lines: string[] = [];
  for (const w of t.split(' ')) {
    const last = lines[lines.length - 1];
    if (last != null && (last + ' ' + w).length <= max) lines[lines.length - 1] = last + ' ' + w;
    else lines.push(w);
  }
  return lines;
}

export function Mimic({ config: c, processes, dataNodes = [], files = [], base, highlight, selected, onSelect, now = 0 }: Props) {
  const [wrapRef, width] = useWidth();
  const svgRef = useRef<SVGSVGElement>(null);
  const ghostRef = useRef<SVGGElement>(null);
  const [hb, setHb] = useState<string | null>(null);
  const live = !!processes;
  const W = Math.max(440, width);
  // Angosto: los títulos de sección van en su propia fila y el diagrama usa todo el ancho
  const narrow = W < 620;
  const LBL = narrow ? 0 : 124, X0 = LBL, CW = W - X0 - 2;
  const SEC = narrow ? 22 : 0;
  // Columnas de módulos: si en tres no entran sin cortar el texto, pasan a dos
  const COLS = (CW - 24) / 3 >= 170 ? 3 : 2;
  const colW = (CW - (COLS - 1) * 12) / COLS;
  const grid = (i: number, top: number, rowH: number) => ({ x: X0 + (i % COLS) * (colW + 12), y: top + Math.floor(i / COLS) * (rowH + 12) });
  const parts = new Set(highlight ? PARTS[highlight] || [] : []);
  const ha = c.namenodes > 1, yarn = c.services !== 'hdfs', todo = c.services === 'todo';
  const ids = new Set(processSpecs(c).map(s => s.id));
  const baseIds = base ? new Set(processSpecs(base).map(s => s.id)) : null;
  const tagOf = (id: string): Tag => (!baseIds ? undefined : !baseIds.has(id) && ids.has(id) ? 'new' : baseIds.has(id) && !ids.has(id) ? 'gone' : undefined);

  const lampOf = (id: string): Lamp => {
    if (!live) return 'off';
    if (id.startsWith('dn')) { const d = dataNodes.find(x => `dn${x.id}` === id); if (d?.state === 'stale') return 'start'; if (d?.state === 'dead') return 'down'; }
    const p = processes!.find(x => x.id === id);
    if (!p) return 'off';
    return p.state === 'up' ? 'up' : p.state === 'down' ? 'down' : p.state === 'off' ? 'off' : 'start';
  };
  const roleOf = (id: string) => live ? processes!.find(x => x.id === id)?.role : undefined;

  const out: ReactNode[] = [];
  const bands: ReactNode[] = [];
  let y = 8;

  const keyAct = (id: string) => (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(id); } };
  const lamp = (s: Lamp, cx: number, cy: number) => <>{s === 'start' && <circle className="m-ring" cx={cx} cy={cy} r={8} />}<circle className={`m-lamp l-${s}`} cx={cx} cy={cy} r={5} /></>;
  const box = (id: string, x: number, yy: number, w: number, h: number, title: string, sub: string, o: { na?: boolean; role?: string; act?: boolean; eng?: string; engName?: string; tag?: Tag; sel?: boolean } = {}) => {
    const s = o.na ? 'off' : lampOf(id);
    const clickable = !!onSelect && live && !o.na;
    const roleW = o.role ? o.role.length * 6.6 + 10 : 0;
    out.push(
      <g key={id} className={`m-box${o.na ? ' na' : ''}${o.tag ? ' tag-' + o.tag : ''}${selected === id ? ' sel' : ''}${clickable ? ' click' : ''}`} data-s={s}
        {...(clickable ? { role: 'button', tabIndex: 0, 'aria-label': `${title}: ${s === 'up' ? 'arriba' : s === 'down' ? 'caído' : s === 'start' ? 'en transición' : 'apagado'}`, 'aria-pressed': selected === id, onClick: () => onSelect!(id), onKeyDown: keyAct(id) } : {})}>
        <rect className="m-rect" x={x} y={yy} width={w} height={h} rx={3} />
        {lamp(s, x + 15, yy + 18)}
        <text className="m-t" x={x + 28} y={yy + 22}>{fit(title, w - 38 - roleW)}</text>
        <text className="m-s" x={x + 28} y={yy + 39}>{fit(o.na ? 'apagado' : sub, w - 38, 6.5)}</text>
        {o.role && !o.na && <text className={`m-role${o.act ? ' act' : ''}`} x={x + w - 9} y={yy + 21} textAnchor="end">{o.role}</text>}
        {o.eng && !o.na && <><rect className="m-eng" x={x + 28} y={yy + h - 16} width={8} height={8} rx={1.5} style={{ fill: `var(--eng-${o.eng})` }} /><text className="m-s" x={x + 41} y={yy + h - 8.5}>{fit(o.engName || '', w - 52, 6.6)}</text></>}
        {o.tag && <g className="m-tag"><rect x={x + w - 62} y={yy - 7} width={56} height={14} rx={3} /><text x={x + w - 34} y={yy + 3.5} textAnchor="middle">{o.tag === 'new' ? 'NUEVO' : 'SE APAGA'}</text></g>}
      </g>);
  };
  // Devuelve cuánto hay que bajar el contenido (sólo en angosto, donde el título ocupa su fila)
  const sec = (key: string, label: string, sub: string, yy: number) => {
    // El fondo tapa los cables que bajan por la fila del título
    if (narrow) { out.push(<g key={`sec-${key}`}><rect className="m-secbg" x={0} y={yy} width={label.length * 7.6 + 12 + sub.length * 6.2} height={17} /><text className="m-sec" x={0} y={yy + 12}>{label}<tspan className="m-secs" dx={8}>{sub}</tspan></text></g>); return SEC; }
    const lines = wrap(sub, Math.floor((LBL - 14) / 5.9));
    out.push(<g key={`sec-${key}`}><text className="m-sec" x={0} y={yy + 14}>{label}</text>{lines.map((l, i) => <text key={i} className="m-secs" x={0} y={yy + 30 + i * 14}>{l}</text>)}</g>);
    return 0;
  };
  const wire = (key: string, d: string, na?: boolean) => out.push(<path key={key} className={`m-wire${na ? ' na' : ''}`} d={d} />);
  const dot = (key: string, x: number, yy: number) => out.push(<circle key={key} className="m-node" cx={x} cy={yy} r={2.6} />);
  const wlabel = (key: string, x: number, yy: number, t: string) => out.push(<text key={key} className="m-wl" x={x + 8} y={yy}>{t}</text>);
  const band = (part: Part, y0: number, y1: number) => { if (parts.has(part)) bands.push(<rect key={`hl-${part}-${y0}`} className="m-hl" x={1} y={y0} width={W - 2} height={y1 - y0} rx={6} />); };

  /* ---------- Metadatos ---------- */
  const metaTop = y;
  let nnCenters: number[] = [];
  if (!ha) {
    const bw = (CW - 22) / 2;
    y += sec('meta', 'METADATOS', 'qué bloque está dónde', y);
    box('nn1', X0, y, bw, 54, 'NameNode', 'nn1 · :9870 · RPC :9000', { tag: tagOf('nn1') });
    box('snn', X0 + bw + 22, y, bw, 54, 'Secondary NameNode', ':9868 · copia cada 5 min', { tag: tagOf('snn') });
    wire('w-nn-snn', `M${X0 + bw} ${y + 27}H${X0 + bw + 22}`);
    nnCenters = [X0 + bw / 2]; y += 54;
    band('meta', metaTop - 4, y + 4);
  } else {
    y += sec('coord', 'COORDINACIÓN', 'elige al activo', y);
    const zw = CW * .27, jw = (CW - zw - 30) / 3;
    box('zk', X0, y, zw, 44, 'ZooKeeper', ':2181', { tag: tagOf('zk') });
    [1, 2, 3].forEach(j => box(`jn${j}`, X0 + zw + 10 + (j - 1) * (jw + 10), y, jw, 44, jw > 140 ? `JournalNode ${j}` : `Journal ${j}`, `jn${j} · :${8479 + j}`, { tag: tagOf(`jn${j}`) }));
    band('coord', y - 4, y + 48);
    const bus = y + 44 + 14;
    wire('w-zk', `M${X0 + zw / 2} ${y + 44}V${bus}`); [1, 2, 3].forEach(j => wire(`w-jn${j}`, `M${X0 + zw + 10 + (j - 1) * (jw + 10) + jw / 2} ${y + 44}V${bus}`));
    wire('w-bus1', `M${X0 + zw / 2} ${bus}H${X0 + zw + 10 + 2 * (jw + 10) + jw / 2}`);
    y = bus + 14;
    const mt = y;
    y += sec('meta', 'METADATOS', `${c.namenodes} NameNodes`, y);
    const n = c.namenodes, w = (CW - (n - 1) * 12) / n;
    for (let j = 0; j < n; j++) {
      const x = X0 + j * (w + 12), id = `nn${j + 1}`;
      const r = live ? roleOf(id) : j === 0 ? 'active' : 'standby';
      box(id, x, y, w, 54, `NameNode ${j + 1}`, `:${9870 + j} · RPC :${9000 + j}`, { role: r === 'active' ? 'ACTIVO' : r === 'standby' ? 'EN ESPERA' : undefined, act: r === 'active', tag: tagOf(id) });
      wire(`w-nnup${j}`, `M${x + w / 2} ${bus}V${y}`); dot(`d-nnup${j}`, x + w / 2, bus);
      nnCenters.push(x + w / 2);
    }
    y += 54;
    band('meta', mt - 4, y + 4);
  }

  /* ---------- Datos: el rack ---------- */
  const busY = y + 15, rackTop = y + 30 + SEC;
  nnCenters.forEach((x, i) => wire(`w-nnd${i}`, `M${x} ${y}V${busY}`));
  if (nnCenters.length > 1) wire('w-bus2', `M${nnCenters[0]} ${busY}H${nnCenters[nnCenters.length - 1]}`);
  wire('w-rack', `M${X0 + CW / 2} ${busY}V${rackTop}`); dot('d-rack', X0 + CW / 2, busY);
  wlabel('l-hb', X0 + CW / 2, busY + 11, 'latidos cada 3 s');
  sec('datos', 'DATOS', 'los bloques, en HDFS', narrow ? rackTop - SEC : rackTop + 4);
  y = rackTop;
  const plan = blockPlan(c);
  const dnIds = Array.from({ length: c.datanodes }, (_, i) => i + 1);
  if (live) dataNodes.filter(d => d.id > c.datanodes && d.state !== 'off').forEach(d => dnIds.push(d.id));
  const goneDns = !live && base && base.datanodes > c.datanodes ? Array.from({ length: base.datanodes - c.datanodes }, (_, i) => c.datanodes + i + 1) : [];
  const unitH = 30, gap = 6, headH = 24;
  const rows = dnIds.length + goneDns.length + (plan.missing && !live ? 1 : 0);
  const rackH = headH + 8 + rows * (unitH + gap) + 2;
  out.push(<rect key="rack" className="m-rack" x={X0} y={y} width={CW} height={rackH} rx={3} />);
  out.push(<rect key="rack-h" className="m-rack-h" x={X0} y={y} width={CW} height={headH} rx={2} />);
  // Rótulo del rack: el de la derecha se acorta (o se va) antes de pisar al de la izquierda
  const rackL = `RACK · ${dnIds.length} DATANODE${dnIds.length > 1 ? 'S' : ''} · BLOQUE ${blockSizeLabel(c.blockSize).toUpperCase()} · RÉPLICA ${c.replication}`;
  const rackRs = live ? ['EN VIVO'] : ['VISTA PREVIA · VENTAS_GRANDES.CSV', 'VISTA PREVIA'];
  const rackR = rackRs.find(r => CW - 22 - r.length * 6.9 - 16 >= rackL.length * 6.9) ?? (CW - 22 - rackRs[rackRs.length - 1].length * 6.9 - 16 >= 200 ? rackRs[rackRs.length - 1] : '');
  out.push(<text key="rack-ht" className="m-rack-t" x={X0 + 11} y={y + 16}>{fit(rackL, CW - 22 - (rackR ? rackR.length * 6.9 + 16 : 0), 6.9)}</text>);
  if (rackR) out.push(<text key="rack-hr" className="m-rack-t" x={X0 + CW - 11} y={y + 16} textAnchor="end">{rackR}</text>);
  const chipArea = CW - 16 - 144 - 82;
  const maxChips = Math.max(2, Math.floor(chipArea / 34));
  const chipsFor = (dn: number): Chip[] => {
    if (!live) return (plan.per[dn - 1] || []).map(n => ({ key: `b${n}@${dn}`, b: `b${n}`, label: `b${n}`, kind: 'prev', tip: `Bloque ${n} de ${plan.blocks} de ventas_grandes.csv` }));
    const out2: Chip[] = [];
    files.forEach(f => f.blocks.forEach(b => {
      const has = b.locations.includes(dn), ghost = b.stale.includes(dn);
      if (!has && !ghost) return;
      out2.push({ key: `${b.id}@${dn}`, b: String(b.id), label: `${fileLetter(f)}${b.index}`, kind: fileKind(f), ghost, under: !ghost && f.state !== 'writing' && b.locations.length < f.replication, tip: `${b.name} · ${f.path} · bloque ${b.index} de ${f.blocks.length}` });
    }));
    return out2;
  };
  const allChips: { x: number; y: number; c: Chip }[] = [];
  const unit = (dn: number, i: number, gone?: boolean) => {
    const uy = y + headH + 8 + i * (unitH + gap);
    const id = `dn${dn}`, s = gone ? 'off' : lampOf(id), d = dataNodes.find(x => x.id === dn);
    const tag = gone ? 'gone' : tagOf(id);
    const clickable = !!onSelect && live && !gone;
    const chips = gone ? [] : chipsFor(dn);
    const shown = chips.length > maxChips ? chips.slice(0, maxChips - 1) : chips;
    shown.forEach((ch, k) => allChips.push({ x: X0 + 152 + k * 34, y: uy + 6, c: ch }));
    let meta = '';
    if (gone) meta = 'se apaga';
    else if (!live) meta = chips.length ? `${chips.length} × ${plan.mb > DATASET_MB ? '5,9' : plan.mb} MB` : 'sin bloques';
    else if (d?.state === 'stale') meta = `sin latidos · ${Math.max(0, Math.ceil(((d.deadAt || 0) - now) / 1000))} s`;
    else if (d?.state === 'dead') meta = 'muerto';
    else if (d?.state === 'starting' || s === 'start') meta = 'arrancando';
    else meta = `${chips.filter(x => !x.ghost).length} bloque${chips.filter(x => !x.ghost).length !== 1 ? 's' : ''}`;
    out.push(
      <g key={`u-${dn}${gone ? 'g' : ''}`} className={`m-unit${tag ? ' tag-' + tag : ''}${selected === id ? ' sel' : ''}${clickable ? ' click' : ''}`} data-s={s}
        {...(clickable ? { role: 'button', tabIndex: 0, 'aria-label': `DataNode ${dn}: ${meta}`, onClick: () => onSelect!(id), onKeyDown: keyAct(id) } : {})}>
        <rect className="m-unit-r" x={X0 + 8} y={uy} width={CW - 16} height={unitH} rx={2} />
        {lamp(s, X0 + 22, uy + unitH / 2)}
        <text className="m-t" x={X0 + 34} y={uy + 19.5} style={{ fontSize: 12.5 }}>DataNode {dn}</text>
        <text className="m-s" x={X0 + 144} y={uy + 19} textAnchor="end">:{9900 + dn}</text>
        {chips.length > shown.length && <text className="m-s" x={X0 + 152 + shown.length * 34 + 4} y={uy + 19}>+{chips.length - shown.length}</text>}
        <text className={`m-s${d?.state === 'stale' ? ' warn' : d?.state === 'dead' || gone ? ' bad' : ''}`} x={X0 + CW - 18} y={uy + 19} textAnchor="end">{meta}</text>
        {tag && <g className="m-tag"><rect x={X0 + CW - 76} y={uy - 7} width={56} height={14} rx={3} /><text x={X0 + CW - 48} y={uy + 3.5} textAnchor="middle">{tag === 'new' ? 'NUEVO' : 'SE APAGA'}</text></g>}
      </g>);
  };
  dnIds.forEach((dn, i) => unit(dn, i));
  goneDns.forEach((dn, i) => unit(dn, dnIds.length + i, true));
  if (plan.missing && !live) {
    const uy = y + headH + 8 + (dnIds.length + goneDns.length) * (unitH + gap);
    out.push(<g key="missing"><text className="m-s warn" x={X0 + 22} y={uy + 19}>FALTAN {plan.missing} COPIAS</text>
      {Array.from({ length: Math.min(plan.missing, maxChips - 1) }, (_, k) => <g key={k} transform={`translate(${X0 + 152 + k * 34} ${uy + 6})`}><rect className="m-chip miss" width={30} height={18} rx={2} /><text className="m-chip-t miss" x={15} y={12.5} textAnchor="middle">?</text></g>)}
      <text className="m-s warn" x={X0 + CW - 18} y={uy + 19} textAnchor="end">pedís {c.replication}</text></g>);
  }
  band('rack', y - 4, y + rackH + 4);
  const rackChipsHl = parts.has('chips');
  y += rackH;

  /* ---------- Cómputo ---------- */
  const cTop = y + 34 + SEC;
  wire('w-comp', `M${X0 + CW / 2} ${y}V${cTop}`, !yarn);
  wlabel('l-comp', X0 + CW / 2, y + 21, 'los trabajos leen bloques');
  sec('comp', 'CÓMPUTO', yarn ? 'YARN reparte 4 GB' : 'sin YARN', cTop - SEC);
  y = cTop;
  const yTag = (on: boolean, was: boolean): Tag => (!base || live ? undefined : on && !was ? 'new' : !on && was ? 'gone' : undefined);
  const wasYarn = base ? base.services !== 'hdfs' : false, wasTodo = base?.services === 'todo';
  const yarnNa = !yarn && !(base && wasYarn);
  const comp: [string, string, string, number, { eng?: string; engName?: string }][] = [
    ['rm', 'ResourceManager', ':8088 · los trabajos', 54, {}],
    ['nm', 'NodeManager', ':8042 · presta 4 GB', 64, { eng: 'mr', engName: 'MapReduce, Pig, Sqoop' }],
    ['jh', 'JobHistory', ':19888 · terminados', 54, {}],
  ];
  comp.forEach(([id, t, sub, h, o], i) => { const g = grid(i, y, 64); box(id, g.x, g.y, colW, h, t, sub, { na: yarnNa, tag: yTag(yarn, wasYarn), ...o }); });
  const compH = Math.ceil(comp.length / COLS) * 76 - 12;
  band('compute', y - 4, y + compH + 4);
  y += compH;

  /* ---------- Servicios ---------- */
  const sBus = y + 17, sTop = y + 34 + SEC;
  const xs = [0, 1].map(i => X0 + i * (colW + 12));
  wire('w-sv', `M${X0 + CW / 2} ${y}V${sBus}`, !todo);
  wire('w-sbus', `M${xs[0] + colW / 2} ${sBus}H${xs[1] + colW / 2}`, !todo);
  [0, 1].forEach(i => wire(`w-sv${i}`, `M${xs[i] + colW / 2} ${sBus}V${sTop}`, !todo));
  if (todo) dot('d-sv', X0 + CW / 2, sBus);
  wlabel('l-sv', X0 + CW / 2, y + 13, 'Hive y Spark piden memoria');
  sec('serv', 'SERVICIOS', 'consultas y bases', sTop - SEC);
  y = sTop;
  const svTop = y;
  const hiveId = live ? (processes!.some(p => p.id === 'hiveserver2') ? 'hiveserver2' : 'hive') : 'hiveserver2';
  const servs: [string, string, string, number, { na?: boolean; eng?: string; engName?: string; tag?: Tag }][] = [
    [hiveId, 'Hive', ':10000 · :10002', 64, { na: !todo && !(base && wasTodo), eng: 'tez', engName: 'motor Tez', tag: yTag(todo, !!wasTodo) }],
    ['sparkhistory', 'Spark', ':18080 · :4040', 64, { na: !todo && !(base && wasTodo), eng: 'spark', engName: 'sobre YARN', tag: yTag(todo, !!wasTodo) }],
    ['mysql', 'MySQL', ':3306 · base tienda', 64, { na: !yarn && !(base && wasYarn), tag: yTag(yarn, wasYarn) }],
    ['mongodb', 'MongoDB', ':27017 · base tienda', 54, { na: !c.mongodb && tagOf('mongodb') !== 'gone', tag: tagOf('mongodb') }],
    ['jupyter', 'JupyterLab', ':8888 · notebooks', 54, { na: !c.jupyter && tagOf('jupyter') !== 'gone', tag: tagOf('jupyter') }],
    ['ui', 'Esta interfaz', ':8080', 54, {}],
  ];
  // En cada fila manda el módulo más alto
  const rowH = (r: number) => Math.max(...servs.slice(r * COLS, r * COLS + COLS).map(x => x[3]));
  const rowY = (r: number) => svTop + Array.from({ length: r }, (_, k) => rowH(k) + 12).reduce((a, b) => a + b, 0);
  const servAt = (i: number) => ({ x: X0 + (i % COLS) * (colW + 12), y: rowY(Math.floor(i / COLS)) });
  servs.forEach(([id, t, sub, h, o], i) => { const g = servAt(i); box(id, g.x, g.y, colW, h, t, sub, o); });
  const rowsS = Math.ceil(servs.length / COLS);
  const svEnd = rowY(rowsS - 1) + rowH(rowsS - 1);
  band('services', svTop - 4, svEnd + 4);
  ([['mongo', 3], ['jupyter', 4]] as const).forEach(([part, i]) => {
    if (!parts.has(part)) return;
    const g = servAt(i);
    bands.push(<rect key={`hl-${part}`} className="m-hl" x={g.x - 4} y={g.y - 4} width={colW + 8} height={62} rx={6} />);
  });
  y = svEnd + 8;

  /* ---------- Bloques (con animación) ---------- */
  const chipEls = allChips.map(({ x, y: cy, c: ch }) => (
    <g key={ch.key} transform={`translate(${x} ${cy})`} data-k={ch.key} data-b={ch.b} data-x={x} data-y={cy} className="m-chipg" onMouseEnter={() => setHb(ch.b)} onMouseLeave={() => setHb(null)}>
      <g className="m-chip-in">
        <title>{ch.tip}</title>
        <rect className={`m-chip k-${ch.kind}${ch.ghost ? ' ghost' : ''}${hb === ch.b || rackChipsHl ? ' hl' : ''}`} width={30} height={18} rx={2} />
        <text className={`m-chip-t k-${ch.kind}${ch.ghost ? ' ghost' : ''}`} x={15} y={12.5} textAnchor="middle">{ch.label}</text>
        {ch.under && <circle className="m-under" cx={29} cy={1} r={3.2} />}
      </g>
    </g>));
  useChipFlip(svgRef, ghostRef, allChips.map(a => `${a.c.key}:${a.x}:${a.y}`).join('|'));

  const H = y;
  return (
    <div className="mimic" ref={wrapRef}>
      <svg ref={svgRef} className="mimic-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Arquitectura del cluster">
        {bands}{out}{chipEls}<g ref={ghostRef} />
      </svg>
    </div>
  );
}

export function MimicLegend() {
  return (
    <div className="mimic-legend" aria-label="Referencias">
      <span><i className="lg-lamp off" />apagado</span><span><i className="lg-lamp start" />arrancando</span><span><i className="lg-lamp up" />arriba</span><span><i className="lg-lamp down" />caído</span>
      <span className="eng eng-mr">MapReduce</span><span className="eng eng-tez">Tez</span><span className="eng eng-spark">Spark</span>
    </div>
  );
}

/* Los bloques que ya estaban se deslizan, los nuevos vuelan desde otra copia del mismo bloque
   y los que se van se desvanecen. Las posiciones salen del layout (data-x, data-y). */
function useChipFlip(svgRef: RefObject<SVGSVGElement | null>, ghostRef: RefObject<SVGGElement | null>, sig: string) {
  const prev = useRef<Map<string, { x: number; y: number; b: string; html: string }>>(new Map());
  useLayoutEffect(() => {
    const svg = svgRef.current; if (!svg) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const next = new Map<string, { x: number; y: number; b: string; html: string }>();
    const byBlock = new Map<string, { x: number; y: number }>();
    prev.current.forEach(p => { if (!byBlock.has(p.b)) byBlock.set(p.b, p); });
    const first = prev.current.size === 0;
    svg.querySelectorAll<SVGGElement>('g[data-k]').forEach(g => {
      const k = g.dataset.k!, x = +g.dataset.x!, y = +g.dataset.y!, b = g.dataset.b!;
      next.set(k, { x, y, b, html: g.outerHTML });
      if (first || reduce) return;
      const inner = g.firstElementChild as SVGGElement;
      const p = prev.current.get(k);
      if (p) {
        if (p.x !== x || p.y !== y) inner.animate([{ transform: `translate(${p.x - x}px, ${p.y - y}px)` }, { transform: 'translate(0px, 0px)' }], { duration: 380, easing: 'cubic-bezier(.3,.7,.2,1)' });
        return;
      }
      const src = byBlock.get(b);
      if (src) {
        const dx = src.x - x, dy = src.y - y;
        inner.animate([{ transform: `translate(${dx}px, ${dy}px)`, opacity: 1 }, { transform: `translate(${dx / 2}px, ${dy / 2 - 12}px)`, offset: .5 }, { transform: 'translate(0px, 0px)', opacity: 1 }], { duration: Math.hypot(dx, dy) > 40 ? 720 : 380, easing: 'cubic-bezier(.35,.6,.2,1)' });
        inner.querySelector('rect')?.animate([{ strokeWidth: 3, stroke: '#0E7C73' }, { strokeWidth: 3, stroke: '#0E7C73', offset: .7 }, {}], { duration: 900 });
      } else inner.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260 });
    });
    if (!first && !reduce && ghostRef.current) prev.current.forEach((p, k) => {
      if (next.has(k)) return;
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.innerHTML = p.html;
      const n = g.firstElementChild; if (!n) return;
      n.removeAttribute('data-k');
      ghostRef.current!.appendChild(g);
      g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 480, easing: 'ease-in' }).onfinish = () => g.remove();
    });
    prev.current = next;
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
}
