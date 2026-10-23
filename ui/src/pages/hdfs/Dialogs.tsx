/* Lo que se abre desde una fila del explorador: ver el contenido por tramos, mover o renombrar,
   cambiar la réplica y subir (ejemplo o archivo de tu compu, con arrastrar y soltar). */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { ArrowRight, Download, FileUp, Loader2, MoveRight, Upload, X } from 'lucide-react';
import { api } from '../../api';
import { errorCode } from '../../api/errors';
import type { ApiErrorCode, HdfsCat, HdfsExample } from '../../api/types';
import { ResultTable, type RtCell } from '../../components/base';
import { Seg, Stepper } from '../../components/ui';
import { hdfsUpload } from '../../state/actions';
import { toast } from '../../state/ui';
import { nf, sizeLabel } from '../../lib/format';
import { cleanPath } from '../../lib/jobs';
import { ErrorLine } from './common';

type Err = { message: string; code?: ApiErrorCode };
const asErr = (e: unknown): Err => ({ message: e instanceof Error ? e.message : String(e), code: errorCode(e) });
const nameOf = (p: string) => p.split('/').pop() || p;
const parentOf = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/';

/** Diálogo centrado con título, cuerpo y botones (mismo armado que la confirmación) */
function Modal({ open, onClose, title, children, foot }: { open: boolean; onClose: () => void; title: string; children: ReactNode; foot: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog hd-dialog" aria-describedby={undefined}>
          <div className="dialog-b">
            <Dialog.Title asChild><h2>{title}</h2></Dialog.Title>
            {children}
          </div>
          <div className="dialog-f">{foot}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Baja un archivo de HDFS con el navegador (en el demo, el contenido simulado) */
export async function downloadFile(path: string) {
  try {
    const d = await api().hdfsDownload(path);
    const a = document.createElement('a');
    a.href = d.url; a.download = d.name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    toast({ kind: 'ok', title: `Bajando ${d.name}`, description: `hdfs dfs -get ${path}` });
  } catch (e) { toast({ kind: 'bad', title: 'No se pudo bajar', description: asErr(e).message }); }
}

/* ---------- Ver ---------- */

const STEP = 64 * 1024;
const bytes = (b: number) => (b < 1024 ? `${nf(b)} bytes` : b < 1048576 ? `${nf(b / 1024, 0)} KB` : sizeLabel(b / 1048576));
const isCsv = (path: string, text: string) => /\.csv$/i.test(path) || (/^[^\n,]+(,[^\n,]*){2,}\n/.test(text) && !/\t/.test(text.split('\n')[0]));
const cell = (s: string): RtCell => (s === '' ? null : /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s);

export function Viewer({ path, onClose }: { path: string | null; onClose: () => void }) {
  const [parts, setParts] = useState<HdfsCat[]>([]);
  const [err, setErr] = useState<Err | null>(null);
  const [busy, setBusy] = useState(false);
  const [raw, setRaw] = useState(false);
  const seq = useRef(0);

  const load = async (offset: number) => {
    if (!path) return;
    const n = ++seq.current;
    setBusy(true);
    try {
      const c = await api().hdfsCat(path, offset, STEP);
      if (n === seq.current) { setParts(p => (offset ? [...p, c] : [c])); setErr(null); }
    } catch (e) { if (n === seq.current) setErr(asErr(e)); }
    if (n === seq.current) setBusy(false);
  };
  useEffect(() => { setParts([]); setErr(null); setRaw(false); if (path) void load(0); }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  const last = parts[parts.length - 1];
  const text = useMemo(() => parts.map(p => p.text).join(''), [parts]);
  const read = parts.reduce((s, p) => s + p.length, 0);
  const csv = !!path && !!text && isCsv(path, text);
  const table = useMemo(() => {
    if (!csv) return null;
    const lines = text.split('\n').filter(Boolean);
    const [head, ...rows] = lines;
    const cols = head.split(',');
    return { cols, rows: rows.map(l => { const v = l.split(','); return cols.map((_, i) => cell(v[i] ?? '')); }) };
  }, [csv, text]);

  return (
    <Dialog.Root open={!!path} onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="sheet hd-viewer" aria-describedby={undefined}>
          <div className="sheet-h">
            <Dialog.Title asChild><h2 className="mono hd-ell">{path && nameOf(path)}</h2></Dialog.Title>
            {last && <span className="muted hd-ell">{bytes(last.totalBytes)}</span>}
            <span className="hd-sp" />
            {path && <button type="button" className="btn btn-sm" onClick={() => downloadFile(path)}><Download size={13} />Bajar</button>}
            <Dialog.Close asChild><button className="btn btn-sm btn-icon btn-ghost" type="button" aria-label="Cerrar"><X size={16} /></button></Dialog.Close>
          </div>
          <div className="sheet-b">
            {last && <code className="hd-cmd">$ {parts[0].command}</code>}
            {err && <ErrorLine err={err} onRetry={() => load(read)} />}
            {!last && !err && <span className="muted hd-row"><Loader2 size={13} className="spin" />Leyendo el principio del archivo…</span>}
            {last && (last.binary ? (
              <div className="callout">El archivo es binario (parquet, jar, comprimido): no se puede mostrar como texto. Bajalo para abrirlo con su programa.</div>
            ) : !text ? (
              <div className="callout">El archivo está vacío{path?.endsWith('/_SUCCESS') ? ': _SUCCESS es la marca que deja un trabajo cuando termina bien' : ''}.</div>
            ) : (
              <>
                {table && <Seg value={raw ? 'raw' : 'table'} onChange={v => setRaw(v === 'raw')} label="Cómo verlo" options={[{ value: 'table', label: 'Tabla' }, { value: 'raw', label: 'Texto' }]} />}
                {table && !raw
                  ? <ResultTable label={`Contenido de ${path}`} columns={table.cols} rows={table.rows} fileName={nameOf(path!).replace(/\.\w+$/, '')} maxHeight="calc(100vh - 260px)" />
                  : <pre className="log hd-text" aria-label={`Contenido de ${path}`}>{text}</pre>}
              </>
            ))}
          </div>
          {last && !last.binary && (
            <div className="sheet-f hd-foot">
              <span className="muted">Leídos {bytes(read)} de {bytes(last.totalBytes)}{last.totalBytes ? ` · ${nf(Math.min(100, (read / last.totalBytes) * 100), 0)} %` : ''}</span>
              <span className="hd-sp" />
              {last.truncated
                ? <button type="button" className="btn btn-sm" disabled={busy} aria-busy={busy || undefined} onClick={() => load(read)}>{busy && <Loader2 size={13} className="spin" />}Leer {bytes(STEP)} más</button>
                : <span className="muted">Es todo el archivo</span>}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ---------- Mover / renombrar ---------- */

export function MoveDialog({ path, onClose, onMoved }: { path: string | null; onClose: () => void; onMoved: (to: string) => void }) {
  const [to, setTo] = useState('');
  const [err, setErr] = useState<Err | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (path) { setTo(path); setErr(null); } }, [path]);
  const dst = cleanPath(to || '/');
  const same = !!path && dst === path;
  const go = async () => {
    if (!path || same) return;
    setBusy(true);
    try {
      const r = await api().hdfsMove(path, dst);
      toast({ kind: 'ok', title: parentOf(r.id) === parentOf(path) ? 'Renombrado' : 'Movido', description: `${path} → ${r.id}` });
      onMoved(r.id); onClose();
    } catch (e) { setErr(asErr(e)); }
    setBusy(false);
  };
  return (
    <Modal open={!!path} onClose={onClose} title={`Mover o renombrar ${path ? nameOf(path) : ''}`}
      foot={<>
        <button type="button" className="btn" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={busy || same || !to.trim()} aria-busy={busy || undefined} onClick={go}><MoveRight size={14} />Mover</button>
      </>}>
      <p>Cambiá el nombre para renombrar, o poné otra carpeta para moverlo. Si el destino es una carpeta que ya existe, queda adentro con el mismo nombre. No se copian datos: el NameNode solo cambia la ruta.</p>
      <form onSubmit={e => { e.preventDefault(); void go(); }}>
        <label className="hd-lbl" htmlFor="hd-move">Nueva ruta</label>
        <input id="hd-move" className="input mono hd-wide" autoFocus value={to} onChange={e => { setTo(e.target.value); setErr(null); }} aria-invalid={!!err || undefined} spellCheck={false} />
      </form>
      <dl className="facts"><dt>Comando</dt><dd className="mono">hdfs dfs -mv {path} {dst}</dd></dl>
      {err && <ErrorLine err={err} />}
    </Modal>
  );
}

/* ---------- Réplica ---------- */

export function ReplicaDialog({ file, live, onClose, onDone }: { file: { path: string; replication: number; blocks: number } | null; live: number; onClose: () => void; onDone: () => void }) {
  const [n, setN] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Err | null>(null);
  useEffect(() => { if (file) { setN(file.replication); setErr(null); } }, [file]);
  if (!file) return null;
  const go = async () => {
    setBusy(true);
    try {
      await api().setReplication(file.path, n);
      toast({ kind: 'run', title: `Réplica ${file.replication} → ${n}`, description: n > live ? `Hay ${live} DataNodes vivos: van a quedar bloques con copias de menos` : file.path });
      onDone(); onClose();
    } catch (e) { setErr(asErr(e)); }
    setBusy(false);
  };
  return (
    <Modal open onClose={onClose} title={`Réplica de ${nameOf(file.path)}`}
      foot={<>
        <button type="button" className="btn" onClick={onClose}>Cancelar</button>
        <button type="button" className={n < file.replication ? 'btn btn-danger-solid' : 'btn btn-primary'} disabled={busy || n === file.replication} aria-busy={busy || undefined} onClick={go}>
          {n < file.replication ? 'Bajar la réplica' : 'Aplicar'}
        </button>
      </>}>
      <p>Cuántas copias de cada bloque guarda HDFS, en DataNodes distintos. Más copias aguantan más nodos caídos y ocupan más disco.</p>
      <div className="hd-row"><Stepper value={n} onChange={setN} min={1} max={9} label="copias" /><span className="muted">copias por bloque · hay {live} DataNodes vivos</span></div>
      <dl className="facts">
        <dt>Comando</dt><dd className="mono">hdfs dfs -setrep {n} {file.path}</dd>
        <dt>Copias</dt><dd>{nf(file.blocks * file.replication)} <ArrowRight size={11} /> {nf(file.blocks * n)}</dd>
      </dl>
      {n < file.replication && <div className="callout" data-k="run">El NameNode borra las copias que sobran de los DataNodes más llenos.</div>}
      {n > live && <div className="callout" data-k="run">Con {live} DataNodes no entran {n} copias: los bloques van a quedar sub-replicados hasta que sumes nodos.</div>}
      {err && <ErrorLine err={err} />}
    </Modal>
  );
}

/* ---------- Subir ---------- */

export const EXAMPLES: { value: HdfsExample; label: string; size: string }[] = [
  { value: 'ventas', label: 'ventas_grandes.csv', size: '5,9 MB' },
  { value: 'sucias', label: 'ventas_sucias.csv', size: '4,5 MB' },
  { value: 'numeros', label: 'numeros.txt', size: '6,6 MB' },
  { value: 'senal', label: 'clientes_senal.csv', size: '0,7 MB' },
  { value: 'texto', label: 'texto.txt', size: '138 bytes' },
];

export function UploadDialog({ open, dest, initialFile, defRep, defBlock, onClose, onDone }: {
  open: boolean; dest: string; initialFile: File | null; defRep: number; defBlock: string; onClose: () => void; onDone: () => void;
}) {
  const [src, setSrc] = useState<'example' | 'local'>('example');
  const [example, setExample] = useState<HdfsExample>('ventas');
  const [file, setFile] = useState<File | null>(null);
  const [rep, setRep] = useState('');
  const [bs, setBs] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setFile(initialFile); setSrc(initialFile ? 'local' : 'example'); } }, [open, initialFile]);

  const name = src === 'example' ? EXAMPLES.find(x => x.value === example)!.label : file?.name;
  const flags = [rep && `-D dfs.replication=${rep}`, bs.trim() && `-D dfs.blocksize=${bs.trim()}`].filter(Boolean).join(' ');
  const go = async () => {
    if (src === 'local' && !file) return;
    setBusy(true);
    const r = await hdfsUpload({ dest, ...(src === 'example' ? { example } : { file: file! }), replication: rep ? +rep : undefined, blockSize: bs.trim() || undefined });
    setBusy(false);
    if (r) { onDone(); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} title={`Subir a ${dest}`}
      foot={<>
        <button type="button" className="btn" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={busy || (src === 'local' && !file)} aria-busy={busy || undefined} onClick={go}><Upload size={14} />Subir</button>
      </>}>
      <Seg value={src} onChange={setSrc} label="Qué subir" options={[{ value: 'example', label: 'Un ejemplo' }, { value: 'local', label: 'De tu compu' }]} />
      {src === 'example' ? (
        <div className="hd-examples" role="radiogroup" aria-label="Archivo de ejemplo">
          {EXAMPLES.map(x => (
            <button key={x.value} type="button" role="radio" aria-checked={example === x.value} className="hd-example" onClick={() => setExample(x.value)}>
              <span className="mono">{x.label}</span><span className="muted">{x.size}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="hd-drop" data-over={over || undefined}
          onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}>
          <FileUp size={20} />
          {file ? <span><b className="mono">{file.name}</b> · {sizeLabel(file.size / 1048576)}</span> : <span>Soltá un archivo acá</span>}
          <button type="button" className="btn btn-sm" onClick={() => input.current?.click()}>{file ? 'Elegir otro' : 'Elegir archivo'}</button>
          <input ref={input} type="file" hidden aria-label="Archivo de tu compu" onChange={e => setFile(e.target.files?.[0] ?? null)} />
        </div>
      )}
      <div className="hd-opts">
        <label className="hd-lbl">Réplica
          <select className="input hd-sel" value={rep} onChange={e => setRep(e.target.value)}>
            <option value="">{defRep} (la del cluster)</option>{[1, 2, 3, 4, 5, 6, 7, 8, 9].map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label className="hd-lbl">Tamaño de bloque
          <input className="input mono hd-sel" value={bs} onChange={e => setBs(e.target.value)} placeholder={defBlock} spellCheck={false} />
        </label>
      </div>
      <dl className="facts"><dt>Comando</dt><dd className="mono">hdfs dfs {flags && flags + ' '}-put {name ?? '…'} {dest}</dd></dl>
    </Modal>
  );
}
