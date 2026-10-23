/* Prácticas guiadas: la lista (qué se puede hacer ya y qué no, con el arreglo) y cada práctica paso a
   paso, con el comando de la terminal, qué entra, qué hace y qué tiene que dar. */
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, Clock, ExternalLink, Lightbulb, Play, RotateCcw, SearchCheck, SquareTerminal } from 'lucide-react';
import { PRACTICES, blocker, currentStep, doneCount, practiceById, practiceState, suggested, type Practice, type PracticeProgress, type Step, type StepOut } from '../../lib/practicas';
import type { Capability } from '../../lib/capabilities';
import { useStatus } from '../../state/store';
import { runFix } from '../../state/capabilities';
import { checkStep, liveOf, markManual, restartPractice, runStep, undoStep, usePractices, type StepLive } from '../../state/practicas';
import { confirm, navigate, useRouteArg } from '../../state/ui';
import { Chip, EmptyState, GatedButton, KeyValue, PageHeader, ResultTable, Why } from '../../components/base';
import { CodeBlock, Meter } from '../../components/ui';
import { TraceView } from '../../components/Trace';
import './practicas.css';

const GUIDE_URL = 'https://github.com/Franki-678/bigdata-sandbox/blob/main/guias/';

const STATE_LABEL = { nueva: 'Sin empezar', 'en-curso': 'En curso', completa: 'Completa' } as const;

export function PracticasPage() {
  const arg = useRouteArg();
  const pr = arg ? practiceById(arg.split('/')[0]) : undefined;
  if (arg && !pr) {
    return (
      <div className="page-in">
        <EmptyState icon={<BookOpen size={20} aria-hidden="true" />} title="Esa práctica no existe"
          actions={<button type="button" className="btn btn-primary" onClick={() => navigate('practicas')}>Ver todas las prácticas</button>}>
          Puede que el enlace sea de otra versión.
        </EmptyState>
      </div>
    );
  }
  return pr ? <Detail pr={pr} /> : <List />;
}

/* ---------- Lista ---------- */

function List() {
  const status = useStatus();
  const { progress } = usePractices();
  const done = PRACTICES.filter(p => practiceState(p, progress[p.id]) === 'completa').length;
  const next = useMemo(() => suggested(PRACTICES, progress, status, 3), [progress, status]);
  return (
    <div className="page-in">
      <PageHeader title="Prácticas" sub="Las guías de la materia paso a paso: el comando de cada paso y un botón que lo corre y lo verifica."
        status={{ k: done === PRACTICES.length ? 'ok' : 'off', label: `${done} de ${PRACTICES.length} completas` }} />

      {next.length > 0 && (
        <>
          <div className="section-h"><h2>Para seguir</h2><span>Las que empezaste y las que se pueden hacer ya</span></div>
          <div className="pr-next">
            {next.map(p => <NextCard key={p.id} pr={p} pp={progress[p.id]} cap={blocker(status, p)} />)}
          </div>
        </>
      )}

      <div className="section-h"><h2>Todas</h2><span>En el orden de las guías</span></div>
      <div className="capgrid">
        {PRACTICES.map(p => <Card key={p.id} pr={p} pp={progress[p.id]} cap={blocker(status, p)} />)}
      </div>
    </div>
  );
}

function Progress({ pr, pp }: { pr: Practice; pp?: PracticeProgress }) {
  const n = doneCount(pr, pp);
  const st = practiceState(pr, pp);
  return (
    <div className="pr-prog">
      <Meter value={n} max={pr.steps.length} kind={st === 'completa' ? 'ok' : st === 'en-curso' ? 'run' : undefined} label={`Pasos hechos de ${pr.title}`} />
      <span className="muted">{n} de {pr.steps.length} pasos</span>
    </div>
  );
}

function StateChip({ pr, pp, cap }: { pr: Practice; pp?: PracticeProgress; cap: Capability | null }) {
  const st = practiceState(pr, pp);
  if (st === 'completa') return <Chip k="ok">Completa</Chip>;
  if (cap) return <Chip k={cap.state === 'starting' ? 'run' : 'off'}>{cap.state === 'starting' ? 'Preparándose' : 'No disponible'}</Chip>;
  return <Chip k={st === 'en-curso' ? 'run' : undefined}>{STATE_LABEL[st]}</Chip>;
}

function Card({ pr, pp, cap }: { pr: Practice; pp?: PracticeProgress; cap: Capability | null }) {
  const blocked = !!cap && practiceState(pr, pp) !== 'completa';
  return (
    <article className="capcard pr-card" data-k={blocked ? 'blocked' : 'ready'}>
      <div className="capcard-h">
        <span className="pr-guide">Guía {pr.guide}</span>
        <StateChip pr={pr} pp={pp} cap={cap} />
      </div>
      <h3><button type="button" className="pr-title-btn" onClick={() => navigate('practicas', pr.id)}>{pr.title}</button></h3>
      <p className="muted">{pr.summary}</p>
      <div className="pr-meta"><Clock size={13} aria-hidden="true" /> {pr.minutes} min · {pr.steps.length} pasos</div>
      {blocked && cap && <div className="capcard-why"><Why reason={cap.reason ?? 'No disponible'} cap={cap} /></div>}
      <div className="capcard-f">
        <Progress pr={pr} pp={pp} />
      </div>
    </article>
  );
}

function NextCard({ pr, pp, cap }: { pr: Practice; pp?: PracticeProgress; cap: Capability | null }) {
  const st = practiceState(pr, pp);
  const step = currentStep(pr, pp);
  return (
    <article className="pr-nextcard" data-k={cap ? 'blocked' : 'ready'}>
      <div className="pr-nextcard-t">
        <span className="pr-guide">Guía {pr.guide} · {pr.minutes} min</span>
        <h3>{pr.title}</h3>
        <span className="muted">{st === 'en-curso' && step ? <>Sigue en: <b>{step.title}</b></> : pr.summary}</span>
      </div>
      {cap
        ? <Why reason={cap.reason ?? 'No disponible'} cap={cap} />
        : <button type="button" className="btn btn-primary" onClick={() => navigate('practicas', pr.id)}>{st === 'en-curso' ? 'Seguir' : 'Empezar'} <ArrowRight size={14} aria-hidden="true" /></button>}
    </article>
  );
}

/* ---------- Detalle ---------- */

function Detail({ pr }: { pr: Practice }) {
  const status = useStatus();
  const state = usePractices();
  const pp = state.progress[pr.id];
  const cur = currentStep(pr, pp);
  // Abiertos: el paso que toca y los que se abrieron a mano. Al completar uno se abre el siguiente
  // sin cerrar el anterior, para que su resultado quede a la vista
  const [open, setOpen] = useState<Set<string>>(() => new Set(cur ? [cur.id] : []));
  const curId = cur?.id ?? null;
  useEffect(() => { if (curId) setOpen(o => (o.has(curId) ? o : new Set(o).add(curId))); }, [curId]);
  const toggle = (id: string) => setOpen(o => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const cap = blocker(status, pr);
  const st = practiceState(pr, pp);

  const reset = async () => {
    if (await confirm({ title: `¿Empezar de nuevo "${pr.title}"?`, description: 'Se borra lo que marcaste como hecho en esta práctica. Lo que creaste en el cluster queda.', confirmLabel: 'Empezar de nuevo' })) restartPractice(pr);
  };

  return (
    <div className="page-in pr-detail">
      <button type="button" className="btn btn-ghost btn-sm pr-back" onClick={() => navigate('practicas')}><ArrowLeft size={14} aria-hidden="true" /> Prácticas</button>
      <PageHeader title={pr.title} sub={pr.summary}
        status={st === 'completa' ? { k: 'ok', label: 'Completa' } : st === 'en-curso' ? { k: 'run', label: 'En curso' } : undefined}
        actions={<>
          <a className="btn btn-sm" href={GUIDE_URL + pr.guideFile} target="_blank" rel="noreferrer"><BookOpen size={14} aria-hidden="true" /> Guía {pr.guide} <ExternalLink size={12} aria-hidden="true" /></a>
          {st !== 'nueva' && <button type="button" className="btn btn-sm btn-ghost" onClick={reset}><RotateCcw size={14} aria-hidden="true" /> Empezar de nuevo</button>}
        </>} />

      <div className="pr-layout">
        <aside className="pr-side" aria-label="Resumen de la práctica">
          <section>
            <h2>Te llevás</h2>
            <ul className="pr-learn">{pr.learn.map(l => <li key={l}>{l}</li>)}</ul>
          </section>
          {pr.before && <section><h2>Antes</h2><p className="muted">{pr.before}</p></section>}
          <section>
            <h2>Avance</h2>
            <Progress pr={pr} pp={pp} />
            <ol className="pr-index">
              {pr.steps.map((s, i) => (
                <li key={s.id} data-done={!!pp?.done[s.id]} data-cur={s.id === cur?.id}>
                  <button type="button" onClick={() => { setOpen(o => new Set(o).add(s.id)); document.getElementById(`paso-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
                    <span className="pr-num">{pp?.done[s.id] ? <Check size={12} aria-hidden="true" /> : i + 1}</span>{s.title}
                  </button>
                </li>
              ))}
            </ol>
          </section>
          <p className="pr-side-foot muted"><Clock size={13} aria-hidden="true" /> Unos {pr.minutes} minutos. El avance queda guardado en este navegador.</p>
        </aside>

        <div className="pr-main">
          {cap && (
            <div className="capnote" data-k={cap.state} role="status">
              <span className="dot" data-s={cap.state === 'starting' ? 'starting' : 'off'} aria-hidden="true" />
              <span><b>Para correr los pasos desde acá:</b> {cap.reason}. Igual podés leerlos, hacerlos en la terminal y marcarlos.</span>
              {cap.fix && cap.fix.kind !== 'wait' && <button type="button" className="btn btn-sm" onClick={() => runFix(cap.fix)}>{cap.fixLabel}</button>}
            </div>
          )}
          {st === 'completa' && <Finished pr={pr} />}
          <ol className="pr-steps">
            {pr.steps.map((s, i) => (
              <StepCard key={s.id} pr={pr} step={s} n={i + 1} done={pp?.done[s.id]} live={liveOf(state, pr, s)}
                open={open.has(s.id)} onToggle={() => toggle(s.id)} cap={blocker(status, pr, s)} />
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

const SHELL = /^(hdfs|hadoop|yarn|mongosh|mysql|beeline|hive|pig|spark-submit|sqoop|cat|ls|echo|docker|curl|jps)\b/;

function StepCard({ pr, step, n, done, live, open, onToggle, cap }: {
  pr: Practice; step: Step; n: number; done?: { at: number; how: string }; live?: StepLive; open: boolean; onToggle: () => void; cap: Capability | null;
}) {
  const busy = live?.busy;
  const o = live?.outcome;
  const lines = step.command.split('\n');
  return (
    <li className="pr-step" id={`paso-${step.id}`} data-done={!!done} data-open={open}>
      <button type="button" className="pr-step-h" onClick={onToggle} aria-expanded={open}>
        <span className="pr-num" data-done={!!done}>{done ? <Check size={13} aria-hidden="true" /> : n}</span>
        <span className="pr-step-t">{step.title}</span>
        {done && <span className="pr-how">{done.how === 'manual' ? 'Hecho en la terminal' : done.how === 'verify' ? 'Verificado' : 'Hecho'}</span>}
        {busy && <Chip k="run">{busy === 'run' ? 'Corriendo' : 'Verificando'}</Chip>}
      </button>
      {open && (
        <div className="pr-step-b">
          <CodeBlock lines={lines} prompt={SHELL.test(lines[0]) ? '$' : null} label="En la terminal del contenedor" />
          <KeyValue items={[['Entra', step.input], ['Hace', step.does], ['Tiene que dar', step.expect]]} />
          <div className="pr-actions">
            {step.run && (
              <GatedButton cap={cap ?? undefined} className="btn btn-primary" busy={busy === 'run'} onClick={() => runStep(pr, step)}>
                <Play size={14} aria-hidden="true" /> {busy === 'run' ? 'Corriendo…' : done ? 'Ejecutar de nuevo' : 'Ejecutar'}
              </GatedButton>
            )}
            {step.verify && (
              <GatedButton cap={cap ?? undefined} className="btn" busy={busy === 'verify'} onClick={() => checkStep(pr, step)}
                title="Mira el cluster y confirma que dio lo esperado (sirve si lo hiciste en la terminal)">
                <SearchCheck size={14} aria-hidden="true" /> Verificar
              </GatedButton>
            )}
            {!done
              ? <button type="button" className="btn btn-ghost" onClick={() => markManual(pr, step)}><SquareTerminal size={14} aria-hidden="true" /> Lo hice en la terminal</button>
              : <button type="button" className="btn btn-ghost btn-sm" onClick={() => undoStep(pr, step)}>Desmarcar</button>}
          </div>
          {busy && live?.note && <p className="pr-note" role="status"><span className="dot" data-s="run" aria-hidden="true" /> {live.note}</p>}
          {o && !busy && <Outcome live={live!} />}
          {step.tip && <p className="pr-tip"><Lightbulb size={14} aria-hidden="true" /> {step.tip}</p>}
        </div>
      )}
    </li>
  );
}

function Outcome({ live }: { live: StepLive }) {
  const o = live.outcome!;
  const r = o.result;
  const k = o.ok ? 'ok' : o.unsupported ? 'info' : 'bad';
  const head = o.ok ? (o.check?.detail ?? r?.summary ?? 'Listo') : (o.error ?? o.check?.detail ?? 'No dio lo esperado');
  return (
    <div className="pr-out" data-k={k} role="status">
      <p className="pr-out-h">
        {o.ok ? <Check size={15} aria-hidden="true" /> : o.unsupported ? <SquareTerminal size={15} aria-hidden="true" /> : null}
        <span>{head}</span>
      </p>
      {r && (o.ok ? r.summary !== head : true) && <p className="muted">{r.summary}</p>}
      {!o.ok && o.check && o.error && o.check.detail !== o.error && <p className="muted">{o.check.detail}</p>}
      {r?.out && <Out out={r.out} />}
      {(r?.trace || r?.link) && (
        <div className="pr-out-f">
          {r.trace && (
            <details className="pr-trace">
              <summary>Qué pasó en el cluster</summary>
              <TraceView trace={r.trace} />
            </details>
          )}
          {r.link && <button type="button" className="btn btn-sm" onClick={() => navigate(r.link!.page, r.link!.arg)}>{r.link.label} <ArrowRight size={13} aria-hidden="true" /></button>}
        </div>
      )}
    </div>
  );
}

function Out({ out }: { out: StepOut }) {
  if (out.kind === 'table') return <ResultTable columns={out.columns} rows={out.rows} total={out.total} label="Resultado del paso" fileName="resultado" maxHeight={320} />;
  if (out.kind === 'kv') return <KeyValue items={out.items} />;
  return <pre className="pr-text">{out.text}</pre>;
}

function Finished({ pr }: { pr: Practice }) {
  const status = useStatus();
  const { progress } = usePractices();
  const next = suggested(PRACTICES, progress, status, 1)[0];
  return (
    <div className="pr-finished">
      <span className="pr-finished-ico"><Check size={18} aria-hidden="true" /></span>
      <div>
        <strong>Terminaste {pr.title}</strong>
        <span className="muted">{pr.learn[0]}.</span>
      </div>
      {next && <button type="button" className="btn btn-primary" onClick={() => navigate('practicas', next.id)}>Seguir con {next.title} <ArrowRight size={14} aria-hidden="true" /></button>}
    </div>
  );
}
