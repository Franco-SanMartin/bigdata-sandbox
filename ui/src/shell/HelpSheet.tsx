import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { helpOpen, route } from '../state/ui';
import { HELP, SHORTCUTS } from '../help/content';
import { navById } from './nav';
import { Kbd } from '../components/ui';

export function HelpSheet() {
  const open = helpOpen.use();
  const page = route.use();
  const h = HELP[page];
  return (
    <Dialog.Root open={open} onOpenChange={helpOpen.set} modal={false}>
      <Dialog.Portal>
        <Dialog.Content className="sheet narrow help" aria-describedby={undefined} onInteractOutside={e => e.preventDefault()}>
          <div className="sheet-h"><Dialog.Title asChild><h2>Ayuda · {navById(page).title}</h2></Dialog.Title>
            <Dialog.Close asChild><button className="btn btn-sm btn-icon btn-ghost" style={{ marginLeft: 'auto' }} type="button" aria-label="Cerrar la ayuda"><X size={16} /></button></Dialog.Close></div>
          <div className="sheet-b">
            <p>{h.intro}</p>
            {h.terms.length > 0 && <div><h3>Conceptos</h3><dl>{h.terms.map(([t, d]) => <div key={t}><dt>{t}</dt><dd>{d}</dd></div>)}</dl></div>}
            <div><h3>Atajos</h3><div className="keys">{SHORTCUTS.map(([a, k]) => <div key={a} style={{ display: 'contents' }}><span>{a}</span><span>{k.includes(' ') ? k.split(' ').map(x => <kbd key={x}>{x}</kbd>) : <Kbd k={k} />}</span></div>)}</div></div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
