/* Nuevo trabajo: elegís una plantilla, completás sus parámetros (se validan mientras escribís, con las
   mismas reglas que el servidor) y ves el comando equivalente antes de lanzarlo. */
import { useEffect, useMemo, useState } from 'react';
import { Dialog } from 'radix-ui';
import { Loader2, Play, X } from 'lucide-react';
import { api } from '../../api';
import type { JobParam, JobTemplate } from '../../api/types';
import { useBlock } from '../../components/base';
import { EngineTag } from '../../components/Trace';
import { Switch } from '../../components/ui';
import { navigate, toast } from '../../state/ui';
import { fillCommand, formErrors, initialValues, TEMPLATES, toParams, type JobValue, type JobValues } from '../../lib/jobs';
import type { CapId } from '../../lib/capabilities';
import { shortId } from './Containers';

/** Qué capacidad necesita cada motor para poder lanzarse */
export const ENGINE_CAP: Record<JobTemplate['engine'], CapId> = { mr: 'mapreduce', tez: 'tez', spark: 'spark' };

/** Las plantillas del servidor; si no responde, las mismas de lib/jobs */
export function useTemplates(): JobTemplate[] {
  const [t, setT] = useState<JobTemplate[]>(TEMPLATES);
  useEffect(() => { let on = true; api().jobTemplates().then(x => { if (on && x?.length) setT(x); }, () => {}); return () => { on = false; }; }, []);
  return t;
}

/** Manda el trabajo y abre su detalle. Devuelve el error para mostrarlo en la hoja (o null si salió) */
export async function launch(t: JobTemplate, values: JobValues): Promise<string | null> {
  try {
    const id = await api().submitJob({ template: t.id, params: toParams(t, values) });
    toast({ kind: 'run', title: `${t.label}: enviado a YARN`, description: shortId(id) });
    navigate('yarn', id);
    return null;
  } catch (e) { return e instanceof Error ? e.message : String(e); }
}

function TemplateCard({ t, checked, onPick }: { t: JobTemplate; checked: boolean; onPick: () => void }) {
  const block = useBlock(ENGINE_CAP[t.engine]);
  return (
    <button type="button" role="radio" aria-checked={checked} className="nj-t" data-off={block ? true : undefined} onClick={onPick}
      aria-label={t.label} aria-description={block ? `No disponible: ${block.reason}` : t.description}>
      <span className="nj-t-h"><b>{t.label}</b><EngineTag engine={t.engine} /></span>
      <span className="nj-t-d">{block ? <span className="nj-off">{block.reason}</span> : t.params.length ? `${t.params.length} parámetro${t.params.length > 1 ? 's' : ''}` : 'sin parámetros'}</span>
    </button>
  );
}

function Field({ prm, value, error, onChange }: { prm: JobParam; value: JobValue; error?: string; onChange: (v: JobValue) => void }) {
  const id = `nj-${prm.name}`;
  if (prm.type === 'bool') {
    return (
      <div className="nj-f nj-bool">
        <Switch checked={!!value} onChange={onChange} label={prm.label} />
        <span><span className="nj-l">{prm.label}</span>{prm.help && <span className="nj-h">{prm.help}</span>}</span>
      </div>
    );
  }
  return (
    <div className="nj-f">
      <label className="nj-l" htmlFor={id}>{prm.label}{prm.type === 'int' && prm.min != null && <span className="dim"> · de {prm.min} a {prm.max}</span>}</label>
      {prm.type === 'select' ? (
        <select id={id} className="input" value={String(value)} onChange={e => onChange(e.target.value)}>
          {prm.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input id={id} className={`input${prm.type === 'int' ? ' nj-num' : ' mono'}`} value={String(value)} spellCheck={false} autoComplete="off"
          inputMode={prm.type === 'int' ? 'numeric' : undefined} aria-invalid={error ? true : undefined} aria-describedby={`${id}-m`}
          onChange={e => onChange(e.target.value)} />
      )}
      <span id={`${id}-m`} className={error ? 'nj-err' : 'nj-h'}>{error ?? prm.help}</span>
    </div>
  );
}

export function NewJobSheet({ open, onClose, templates, initial }: { open: boolean; onClose: () => void; templates: JobTemplate[]; initial?: string }) {
  const [tid, setTid] = useState(initial ?? templates[0]?.id);
  const t = templates.find(x => x.id === tid) ?? templates[0];
  const [values, setValues] = useState<Record<string, JobValues>>({});
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setErr(null); if (initial) setTid(initial); } }, [open, initial]);

  const v = (t && values[t.id]) || (t ? initialValues(t) : {});
  const errors = useMemo(() => (t ? formErrors(t, v) : {}), [t, v]);
  const block = useBlock(t ? ENGINE_CAP[t.engine] : 'yarn.submit');
  const bad = Object.keys(errors).length > 0;
  const set = (name: string, x: JobValue) => { setErr(null); setValues(s => ({ ...s, [t.id]: { ...v, [name]: x } })); };

  const go = async () => {
    if (!t || bad || block || sending) return;
    setSending(true); setErr(null);
    const e = await launch(t, v);
    setSending(false);
    if (e) setErr(e); else onClose();
  };

  return (
    <Dialog.Root open={open} onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="sheet nj" aria-describedby={undefined}>
          <div className="sheet-h">
            <Dialog.Title asChild><h2>Nuevo trabajo</h2></Dialog.Title>
            <Dialog.Close asChild><button className="btn btn-ghost btn-icon" type="button" aria-label="Cerrar"><X size={16} /></button></Dialog.Close>
          </div>
          <form className="sheet-b nj-b" onSubmit={e => { e.preventDefault(); void go(); }}>
            <div className="nj-sec">
              <h3>Qué querés correr</h3>
              <div className="nj-ts" role="radiogroup" aria-label="Plantilla">
                {templates.map(x => <TemplateCard key={x.id} t={x} checked={x.id === t?.id} onPick={() => { setTid(x.id); setErr(null); }} />)}
              </div>
            </div>
            {t && <>
              <p className="nj-desc">{t.description}</p>
              {t.params.length > 0 && (
                <div className="nj-sec">
                  <h3>Parámetros</h3>
                  <div className="nj-fs">{t.params.map(p => <Field key={t.id + p.name} prm={p} value={v[p.name] ?? p.default} error={errors[p.name]} onChange={x => set(p.name, x)} />)}</div>
                </div>
              )}
              <div className="nj-sec">
                <h3>Lo mismo en la terminal</h3>
                <code className="hd-cmd nj-cmd" aria-label="Comando equivalente">{fillCommand(t, v)}</code>
              </div>
              {block && <div className="callout" data-k="run">No se puede lanzar ahora: {block.reason}.</div>}
              {err && <div className="callout" data-k="bad" role="alert">{err}</div>}
            </>}
            <button type="submit" hidden />
          </form>
          <div className="sheet-f">
            <span className="muted nj-foot">{bad ? `Hay ${Object.keys(errors).length === 1 ? 'un parámetro' : `${Object.keys(errors).length} parámetros`} para corregir` : t ? 'Corre en YARN; lo seguís en vivo en el detalle' : ''}</span>
            <Dialog.Close asChild><button className="btn btn-ghost" type="button">Cancelar</button></Dialog.Close>
            <button className="btn btn-primary" type="button" disabled={!t || bad || !!block || sending} aria-busy={sending || undefined} onClick={() => void go()}>
              {sending ? <><Loader2 size={14} className="spin" />Mandando…</> : <><Play size={14} />Lanzar</>}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
