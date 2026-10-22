/* Confirmaciones, avisos y el visor del docker-compose.yml */
import { useEffect, useState } from 'react';
import { AlertDialog, Dialog, Toast } from 'radix-ui';
import { AlertTriangle, CheckCircle2, Download, Info, Loader2, X, XCircle } from 'lucide-react';
import { composeDraft, composeOpen, confirmReq, dismissToast, toast, toasts } from '../state/ui';
import { api } from '../api';
import { useStatus } from '../state/store';
import { CodeBlock } from '../components/ui';

export function ConfirmHost() {
  const r = confirmReq.use();
  const close = (ok: boolean) => { r?.resolve(ok); confirmReq.set(null); };
  return (
    <AlertDialog.Root open={!!r} onOpenChange={o => { if (!o) close(false); }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="overlay" />
        {r && <AlertDialog.Content className="dialog">
          <div className="dialog-b">
            <AlertDialog.Title asChild><h2>{r.title}</h2></AlertDialog.Title>
            <AlertDialog.Description asChild><p>{r.description}</p></AlertDialog.Description>
            {r.facts && <dl className="facts">{r.facts.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
          </div>
          <div className="dialog-f">
            <AlertDialog.Cancel asChild><button className="btn" type="button">Cancelar</button></AlertDialog.Cancel>
            <AlertDialog.Action asChild><button className={`btn ${r.danger ? 'btn-danger-solid' : 'btn-primary'}`} type="button" onClick={() => close(true)}>{r.confirmLabel}</button></AlertDialog.Action>
          </div>
        </AlertDialog.Content>}
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

const ICON = { ok: CheckCircle2, bad: XCircle, run: Loader2, info: Info };
export function Toaster() {
  const list = toasts.use();
  return (
    <Toast.Provider swipeDirection="right" duration={4200}>
      {list.map(t => {
        const I = ICON[t.kind || 'info'];
        return (
          <Toast.Root key={t.id} className="toast" data-k={t.kind} onOpenChange={o => { if (!o) dismissToast(t.id); }}>
            <I size={16} className={t.kind === 'run' ? 'spin' : undefined} aria-hidden="true" />
            <Toast.Title className="toast-t">{t.title}</Toast.Title>
            <Toast.Close asChild><button className="btn btn-sm btn-icon btn-ghost" aria-label="Cerrar" type="button"><X size={14} /></button></Toast.Close>
            {t.description && <Toast.Description className="toast-d">{t.description}</Toast.Description>}
          </Toast.Root>
        );
      })}
      <Toast.Viewport className="toasts" />
    </Toast.Provider>
  );
}

export function ComposeSheet() {
  const open = composeOpen.use();
  const s = useStatus();
  const draft = composeDraft.use();
  const cfg = draft || s?.config;
  const [yaml, setYaml] = useState('');
  useEffect(() => { if (open && cfg) api().compose(cfg).then(setYaml); }, [open, JSON.stringify(cfg)]); // eslint-disable-line react-hooks/exhaustive-deps
  const download = () => {
    const url = URL.createObjectURL(new Blob([yaml], { type: 'text/yaml' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'docker-compose.yml' });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast({ title: 'docker-compose.yml descargado', kind: 'ok' });
  };
  return (
    <Dialog.Root open={open} onOpenChange={composeOpen.set}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="sheet" aria-describedby={undefined}>
          <div className="sheet-h"><Dialog.Title asChild><h2 className="mono">docker-compose.yml</h2></Dialog.Title>
            <Dialog.Close asChild><button className="btn btn-sm btn-icon btn-ghost" style={{ marginLeft: 'auto' }} aria-label="Cerrar" type="button"><X size={16} /></button></Dialog.Close></div>
          <div className="sheet-b">
            <p className="dim">El mismo cluster, sin pasar por esta interfaz. Guardalo en una carpeta vacía y corré <span className="mono">docker compose up -d</span>.</p>
            {yaml ? <CodeBlock lines={yaml.split('\n')} prompt={null} label="docker-compose.yml" /> : <div className="skel" style={{ height: 420 }} />}
            <div className="callout"><AlertTriangle size={14} /><span>Los puertos quedan en <b>127.0.0.1</b>: solo los ve tu compu. El sandbox no tiene contraseñas.</span></div>
          </div>
          <div className="sheet-f"><button className="btn btn-primary" type="button" onClick={download} disabled={!yaml}><Download size={15} />Descargar</button></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
