/* Un comando para la terminal del contenedor: copiarlo o mandarlo a la terminal integrada.
   En la demo no hay contenedor, así que solo se copia. */
import { useState } from 'react';
import { Check, Copy, Play } from 'lucide-react';
import { terminalOpen } from '../state/ui';
import { terminal } from '../lib/terminal';
import { api } from '../api';

export function Copiar({ texto, label = 'Copiar' }: { texto: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="btn btn-sm btn-ghost" aria-label={`${label}: ${texto.split('\n')[0]}`}
      onClick={() => { void navigator.clipboard?.writeText(texto).then(() => { setOk(true); setTimeout(() => setOk(false), 1400); }); }}>
      {ok ? <Check size={13} /> : <Copy size={13} />}{ok ? 'Copiado' : label}
    </button>
  );
}

export function Correr({ cmd }: { cmd: string }) {
  const demo = api().mode === 'demo';
  return (
    <button type="button" className="btn btn-sm" disabled={demo} title={demo ? 'En la demo no hay contenedor: copialo y correlo en tu sandbox' : 'Lo escribe y lo corre en la terminal integrada'}
      onClick={() => { terminalOpen.set(true); terminal.run(cmd).catch(() => { /* el motivo queda en la terminal */ }); }}>
      <Play size={12} />Correr en la terminal
    </button>
  );
}

/** El comando con dónde se escribe; bash: se puede mandar a la terminal integrada */
export function Codigo({ cmd, bash, donde }: { cmd: string; bash: boolean; donde?: string }) {
  return (
    <div className="cmdbox">
      {donde && <span className="cmdbox-donde">{donde}</span>}
      <pre className="mono">{cmd}</pre>
      <div className="cmdbox-a"><Copiar texto={cmd} />{bash && <Correr cmd={cmd} />}</div>
    </div>
  );
}
