/* Arranque paso a paso: la lista de pasos y, del elegido, el comando y el log en vivo. */
import { useEffect, useRef, useState } from 'react';
import { Check, Minus } from 'lucide-react';
import type { BootProgress } from '../api/types';
import { CodeBlock, Dot } from '../components/ui';
import { clock, duration } from '../lib/format';

export function BootView({ boot, now }: { boot: BootProgress; now: number }) {
  const running = boot.steps.find(s => s.state === 'running');
  const [pick, setPick] = useState<string | null>(null);
  const sel = boot.steps.find(s => s.id === pick) || running || boot.steps[boot.steps.length - 1];
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [sel?.log.length, sel?.id]);
  const done = boot.steps.filter(s => s.state === 'done').length;
  const total = boot.steps.filter(s => s.state !== 'skipped').length;
  const elapsed = ((boot.finishedAt || now) - boot.startedAt) / 1000;
  const stepSec = (s: typeof boot.steps[number]) => s.finishedAt && s.startedAt ? (s.finishedAt - s.startedAt) / 1000 : s.startedAt ? (now - s.startedAt) / 1000 : 0;
  return (
    <div className="boot">
      <div className="boot-top">
        <div className="boot-bar" aria-hidden="true">{boot.steps.map(s => <i key={s.id} data-s={s.state} style={{ flexGrow: s.state === 'skipped' ? .4 : s.expectedSec }} />)}</div>
        <div className="boot-meta num"><span>{done} de {total} pasos</span><span>{duration(elapsed)} de ~{duration(boot.expectedSec)}</span><span>{boot.kind === 'first' ? 'primer arranque: formatea HDFS y carga las bases' : 'los datos del volumen quedan como estaban'}</span></div>
      </div>
      <div className="boot-body">
        <ol className="boot-steps" aria-label="Pasos del arranque">
          {boot.steps.map((s, i) => (
            <li key={s.id}>
              <button type="button" className="boot-step" data-s={s.state} aria-current={sel?.id === s.id ? 'step' : undefined} onClick={() => setPick(s.id)}>
                <span className="boot-ico">{s.state === 'done' ? <Check size={13} /> : s.state === 'skipped' ? <Minus size={13} /> : s.state === 'running' ? <Dot s="running" /> : <span className="num">{i + 1}</span>}</span>
                <span className="boot-name">{s.name}{s.skipReason && <small>{s.skipReason}</small>}</span>
                <span className="boot-t num">{s.state === 'done' || s.state === 'running' ? duration(stepSec(s)) : s.state === 'skipped' ? 'salteado' : ''}</span>
              </button>
            </li>
          ))}
        </ol>
        {sel && (
          <div className="boot-detail">
            <div className="boot-dh"><h3>{sel.name}</h3><span className="badge" data-k={sel.state === 'done' ? 'ok' : sel.state === 'running' ? 'run' : undefined}>{{ pending: 'en espera', running: 'corriendo', done: 'listo', skipped: 'salteado', failed: 'falló' }[sel.state]}</span></div>
            <p className="dim">{sel.description}</p>
            <CodeBlock lines={sel.commands} label={`Comandos de ${sel.name}`} />
            {sel.state !== 'skipped' && (
              <pre className="log" ref={logRef} aria-live="off" style={{ height: 150 }}>
                {sel.log.length ? sel.log.map((l, i) => <div key={i}><span className="t">{clock(l.t)}</span> <span className={l.level === 'WARN' ? 'w' : l.level === 'ERROR' ? 'e' : undefined}>{l.text}</span></div>) : <span className="t">{sel.state === 'pending' ? 'Todavía no empezó.' : 'Esperando la primera línea…'}</span>}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
