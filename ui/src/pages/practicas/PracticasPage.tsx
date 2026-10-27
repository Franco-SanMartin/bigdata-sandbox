/* Prácticas guiadas: la lista (qué se puede hacer ya y qué no, con el arreglo) y cada práctica paso a
   paso: la pregunta (¿cuál es el comando?), el comando de la terminal, qué entra, qué hace, qué tiene
   que dar, la salida como en la terminal y dónde queda cada cosa. Al terminar, el resumen. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, ClipboardCheck, Download, CircleCheck, CircleHelp, CircleX, Clock, Container, ExternalLink, Eye, HardDrive, Laptop, Layers, Lightbulb, MapPin, Play, Upload, RotateCcw, SearchCheck, SquareTerminal, Terminal as TerminalIcon } from 'lucide-react';
import {
  AUTOEVAL, PRACTICES, blocker, canRun, correctIndex, currentStep, splitCommon, doneCount, fill, optionOrder, pinVars, practiceById, practiceState, requirements, score, stepVars, suggested,
  type Practice, type PracticeProgress, type RawOut, type Step, type StepOut,
} from '../../lib/practicas';
import type { ClusterStatus } from '../../api/types';
import type { Capability } from '../../lib/capabilities';
import { useStatus } from '../../state/store';
import { runFix } from '../../state/capabilities';
import { answerSelf, answerStep, checkStep, downloadProgress, liveOf, solveChallenge, uploadProgress, markManual, pinStep, restartPractice, runInTerminal, runStep, undoStep, usePractices, type StepLive } from '../../state/practicas';
import { api } from '../../api';
import { confirm, navigate, terminalOpen, practiceReturn, useRouteArg, type PracticeReturn } from '../../state/ui';
import { Chip, EmptyState, GatedButton, KeyValue, PageHeader, ResultTable, Why } from '../../components/base';
import { CodeBlock, Meter } from '../../components/ui';
import { TraceView } from '../../components/Trace';
import { terminal } from '../../lib/terminal';
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
  const file = useRef<HTMLInputElement>(null);
  return (
    <div className="page-in">
      <PageHeader title="Prácticas" sub="Las guías de la materia paso a paso: el comando de cada paso y un botón que lo corre y lo verifica."
        status={{ k: done === PRACTICES.length ? 'ok' : 'off', label: `${done} de ${PRACTICES.length} completas` }}
        actions={<>
          <button type="button" className="btn btn-sm" onClick={() => downloadProgress()} disabled={!Object.keys(progress).length}
            title="Baja un .json con lo que hiciste en todas las prácticas, para seguir en otra compu o en otro navegador">
            <Download size={14} aria-hidden="true" /> Exportar avance
          </button>
          <button type="button" className="btn btn-sm" onClick={() => file.current?.click()}
            title="Junta un avance exportado con el de acá: de cada práctica queda la versión más avanzada, no se pierde nada">
            <Upload size={14} aria-hidden="true" /> Importar avance
          </button>
          <input ref={file} type="file" accept="application/json,.json" hidden aria-label="Archivo de avance"
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void uploadProgress(f); }} />
        </>} />

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
      <Needs pr={pr} />
      {blocked && cap && <div className="capcard-why"><Why reason={cap.reason ?? 'No disponible'} cap={cap} /></div>}
      <div className="capcard-f">
        <Progress pr={pr} pp={pp} />
      </div>
    </article>
  );
}

/** Lo que pide antes de empezar, corto: los servicios (prendidos o no) y las prácticas previas */
function Needs({ pr }: { pr: Practice }) {
  const status = useStatus();
  const { progress } = usePractices();
  const needs = requirements(status, pr);
  const prev = (pr.after ?? []).map(id => practiceById(id)).filter((p): p is Practice => !!p);
  if (!needs.length && !prev.length) return null;
  return (
    <ul className="pr-card-needs" aria-label="Antes de empezar">
      {needs.map(n => (
        <li key={n.key} data-ok={n.ready} title={n.ready ? 'Andando' : n.cap.reason ?? 'No está lista'}>
          <span className="dot" data-s={n.ready ? 'ok' : n.cap.state === 'starting' ? 'starting' : 'off'} aria-hidden="true" />{n.label}
          <span className="sr-only">{n.ready ? ' (andando)' : ' (no está lista)'}</span>
        </li>
      ))}
      {prev.map(p => {
        const ok = practiceState(p, progress[p.id]) === 'completa';
        return (
          <li key={p.id} data-ok={ok} title={ok ? 'Hecha' : 'Conviene hacerla antes'}>
            <span className="dot" data-s={ok ? 'ok' : 'off'} aria-hidden="true" />Antes: {p.title}
            <span className="sr-only">{ok ? ' (hecha)' : ' (sin hacer)'}</span>
          </li>
        );
      })}
    </ul>
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
  const arg = useRouteArg();
  const pp = state.progress[pr.id];
  const cur = currentStep(pr, pp);
  // Abiertos: el paso que toca y los que se abrieron a mano. Al completar uno se abre el siguiente
  // sin cerrar el anterior, para que su resultado quede a la vista
  const [open, setOpen] = useState<Set<string>>(() => new Set(cur ? [cur.id] : []));
  const curId = cur?.id ?? null;
  useEffect(() => { if (curId) setOpen(o => (o.has(curId) ? o : new Set(o).add(curId))); }, [curId]);
  // #practicas/<práctica>/<paso>: se vuelve a un paso (desde "Volver al paso N")
  const target = arg.split('/')[1] ?? '';
  useEffect(() => {
    if (!target || !pr.steps.some(s => s.id === target)) return;
    setOpen(o => new Set(o).add(target));
    const t = setTimeout(() => document.getElementById(`paso-${target}`)?.scrollIntoView({ block: 'start' }), 50);
    return () => clearTimeout(t);
  }, [target, pr]);
  const toggle = (id: string) => setOpen(o => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const cap = blocker(status, pr);
  const st = practiceState(pr, pp);
  const sc = score(pr, pp);
  const missing = (pr.after ?? []).map(id => practiceById(id)).filter((p): p is Practice => !!p && practiceState(p, state.progress[p.id]) !== 'completa');
  const needs = requirements(status, pr);
  // lo que piden pasos puntuales y no está (lo de la práctica entera ya lo dice el aviso de arriba)
  const stepNeeds = cap ? [] : needs.filter(n => !n.ready && n.steps.length);

  const reset = async () => {
    if (await confirm({ title: `¿Empezar de nuevo "${pr.title}"?`, description: 'Se borra lo que marcaste como hecho y lo que respondiste en esta práctica. Lo que creaste en el cluster queda.', confirmLabel: 'Empezar de nuevo' })) restartPractice(pr);
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
          <section>
            <h2>Antes de empezar</h2>
            {pr.before && <p className="muted pr-before">{pr.before}</p>}
            <ul className="pr-needs" aria-label="Lo que necesita">
              {needs.map(n => (
                <li key={n.key} data-ok={n.ready}>
                  <span className="dot" data-s={n.ready ? 'ok' : n.cap.state === 'starting' ? 'starting' : 'off'} aria-hidden="true" />
                  <span>
                    <b>{n.label}</b>{n.steps.length > 0 && <span className="muted"> · paso{n.steps.length > 1 ? 's' : ''} {n.steps.join(', ')}</span>}
                    <span className="muted">{n.ready ? ' · andando' : ` · ${n.cap.reason ?? 'no está lista'}`}</span>
                  </span>
                </li>
              ))}
              {pr.after?.map(id => {
                const p = practiceById(id);
                if (!p) return null;
                const done = practiceState(p, state.progress[p.id]) === 'completa';
                return (
                  <li key={id} data-ok={done}>
                    <span className="dot" data-s={done ? 'ok' : 'off'} aria-hidden="true" />
                    <span>Práctica <button type="button" className="pr-link" onClick={() => navigate('practicas', p.id)}>{p.title}</button><span className="muted">{done ? ' · hecha' : ' · conviene hacerla antes'}</span></span>
                  </li>
                );
              })}
            </ul>
          </section>
          <section>
            <h2>Avance</h2>
            <Progress pr={pr} pp={pp} />
            {sc.answered > 0 && <p className="pr-score muted">Preguntas: acertaste {sc.firstTry} de {sc.answered} al primer intento{sc.answered < sc.total ? ` (faltan ${sc.total - sc.answered})` : ''}</p>}
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
          {stepNeeds.map(n => (
            <div key={n.key} className="capnote" data-k={n.cap.state} role="status">
              <span className="dot" data-s={n.cap.state === 'starting' ? 'starting' : 'off'} aria-hidden="true" />
              <span><b>Para el paso{n.steps.length > 1 ? 's' : ''} {n.steps.join(', ')}:</b> {n.cap.reason}. Lo de antes lo podés ir haciendo.</span>
              {n.cap.fix && n.cap.fix.kind !== 'wait' && <button type="button" className="btn btn-sm" onClick={() => runFix(n.cap.fix)}>{n.cap.fixLabel}</button>}
            </div>
          ))}
          {missing.length > 0 && st === 'nueva' && (
            <div className="capnote" data-k="info" role="note">
              <span className="dot" data-s="off" aria-hidden="true" />
              <span><b>Antes de esta:</b> conviene hacer {missing.map((p, i) => <span key={p.id}>{i ? ' y ' : ''}<button type="button" className="pr-link" onClick={() => navigate('practicas', p.id)}>{p.title}</button></span>)}. Usa lo que deja esa práctica; si ya lo tenés, seguí igual.</span>
            </div>
          )}
          {st === 'completa' && <Finished pr={pr} pp={pp} status={status} />}
          <ol className="pr-steps">
            {pr.steps.map((s, i) => (
              <StepCard key={s.id} pr={pr} step={s} n={i + 1} pp={pp} status={status} live={liveOf(state, pr, s)}
                open={open.has(s.id)} onToggle={() => toggle(s.id)} cap={blocker(status, pr, s)} />
            ))}
          </ol>
          {AUTOEVAL[pr.id] && <SelfCheck pr={pr} pp={pp} done={st === 'completa'} />}
        </div>
      </div>
    </div>
  );
}

/** Autoevaluación: preguntas de concepto y un desafío para hacer solo */
function SelfCheck({ pr, pp, done }: { pr: Practice; pp?: PracticeProgress; done: boolean }) {
  const ae = AUTOEVAL[pr.id];
  const answered = ae.preguntas.filter((_, i) => pp?.quiz?.[i]).length;
  const right = ae.preguntas.filter((_, i) => pp?.quiz?.[i]?.ok).length;
  const d = ae.desafio;
  const inTerm = !d.en && api().mode !== 'demo';
  return (
    <section className="pr-self" id="autoevaluacion" aria-labelledby="pr-self-h">
      <div className="pr-self-top">
        <h2 id="pr-self-h"><ClipboardCheck size={16} aria-hidden="true" /> Autoevaluación</h2>
        <span className="muted">
          {answered ? `Acertaste ${right} de ${answered}${answered < ae.preguntas.length ? ` (faltan ${ae.preguntas.length - answered})` : ''}` : done ? 'Ahora que terminaste, probá si te quedó' : 'Conviene hacerla al terminar los pasos'}
          {pp?.desafio ? ' · desafío resuelto' : ''}
        </span>
      </div>
      <ol className="pr-self-qs">
        {ae.preguntas.map((q, i) => {
          const a = pp?.quiz?.[i];
          return (
            <li key={i} className="pr-q">
              <p className="pr-q-h"><CircleHelp size={15} aria-hidden="true" /> <span>{q.enunciado}</span></p>
              <div className="pr-q-ops" role="group" aria-label={`Opciones de la pregunta ${i + 1}`}>
                {q.opciones.map((o, j) => {
                  const k = !a ? undefined : j === q.correcta ? 'ok' : a.pick === j ? 'bad' : 'off';
                  return (
                    <button key={j} type="button" className="pr-q-op" data-k={k} disabled={!!a} aria-pressed={a?.pick === j}
                      onClick={() => answerSelf(pr, i, j, j === q.correcta)}>
                      <span className="pr-q-mark" aria-hidden="true">{k === 'ok' ? <CircleCheck size={14} /> : k === 'bad' ? <CircleX size={14} /> : null}</span>
                      <span>{o}</span>
                    </button>
                  );
                })}
              </div>
              {a && <div className="pr-q-fb" data-k={a.ok ? 'ok' : 'bad'} role="status"><b>{a.ok ? '¡Bien!' : `Es: ${q.opciones[q.correcta]}.`}</b> {q.porque}</div>}
            </li>
          );
        })}
      </ol>
      <div className="pr-challenge" data-done={!!pp?.desafio}>
        <h3><Lightbulb size={15} aria-hidden="true" /> Desafío</h3>
        <p>{d.enunciado}</p>
        {d.en && <p className="muted">{d.en}</p>}
        <details><summary>Una pista</summary><p>{d.pista}</p></details>
        <details>
          <summary>Ver una solución</summary>
          <CodeBlock lines={d.solucion.split('\n')} prompt={d.en ? null : '$'} label={d.en ?? 'En la terminal del contenedor'} />
          {inTerm && (
            <button type="button" className="btn btn-sm" onClick={() => { terminalOpen.set(true); terminal.run(d.solucion).catch(() => { /* el motivo queda en la terminal */ }); }}>
              <TerminalIcon size={14} aria-hidden="true" /> Correr en la terminal
            </button>
          )}
        </details>
        <label className="pr-challenge-ok">
          <input type="checkbox" checked={!!pp?.desafio} onChange={e => solveChallenge(pr, e.target.checked)} /> Lo resolví
        </label>
      </div>
    </section>
  );
}

const SHELL = /^(hdfs|hadoop|yarn|mongosh|mysql|beeline|hive|pig|spark-submit|sqoop|cat|ls|echo|docker|curl|jps|datanode|namenode)\b/;

function StepCard({ pr, step, n, pp, status, live, open, onToggle, cap }: {
  pr: Practice; step: Step; n: number; pp?: PracticeProgress; status: ClusterStatus | null; live?: StepLive; open: boolean; onToggle: () => void; cap: Capability | null;
}) {
  const busy = live?.busy;
  const o = live?.outcome;
  const done = pp?.done[step.id];
  const vars = stepVars(step, status, pp?.vars ?? {});
  const lines = fill(step.command, vars).split('\n');
  // Los pasos con fija guardan lo que muestran apenas aparecen: lo que se copia en la terminal es lo que
  // después usan Verificar, "Lo hice en la terminal" y los pasos siguientes
  const pin = open && !done ? pinVars(step, status, pp?.vars ?? {}) : null;
  const pinKey = pin ? JSON.stringify(pin) : '';
  useEffect(() => { if (pin) pinStep(pr, pin); }, [pinKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const ans = pp?.answers?.[step.id];
  const [peek, setPeek] = useState(false);
  const unlocked = canRun(step, pp);
  // Antes de responder no se muestra el comando: sería la respuesta
  const showCmd = !step.pregunta || !!ans || peek || (!!pp?.completedBefore && !!done);
  // Lo que va en la terminal del contenedor se puede mandar a la terminal integrada (no lo de beeline,
  // mongosh o el navegador, ni en el demo, que no tiene contenedor)
  const inTerm = !step.en && api().mode !== 'demo';
  return (
    <li className="pr-step" id={`paso-${step.id}`} data-done={!!done} data-open={open}>
      <button type="button" className="pr-step-h" onClick={onToggle} aria-expanded={open}>
        <span className="pr-num" data-done={!!done}>{done ? <Check size={13} aria-hidden="true" /> : n}</span>
        <span className="pr-step-t">{step.title}</span>
        {ans && <span className="pr-ans-chip" data-ok={ans.ok} title={ans.ok ? 'Acertaste al primer intento' : 'No acertaste al primer intento'}>{ans.ok ? <CircleCheck size={13} aria-hidden="true" /> : <CircleX size={13} aria-hidden="true" />}</span>}
        {done && <span className="pr-how">{done.how === 'manual' ? 'Hecho en la terminal' : done.how === 'verify' ? 'Verificado' : 'Hecho'}</span>}
        {busy && <Chip k="run">{busy === 'run' ? 'Corriendo' : busy === 'term' ? 'En la terminal' : 'Verificando'}</Chip>}
      </button>
      {open && (
        <div className="pr-step-b">
          {step.pregunta && <Question pr={pr} step={step} vars={vars} pp={pp} peek={peek} onPeek={() => setPeek(true)} />}
          {showCmd && <CodeBlock lines={lines} prompt={!step.en && SHELL.test(lines[0]) ? '$' : null} label={step.en ?? 'En la terminal del contenedor'} />}
          <KeyValue items={[['Entra', step.input], ['Hace', step.does], ['Tiene que dar', step.expect]]} />
          {unlocked ? (
            <div className="pr-actions">
              {step.run && (
                <GatedButton cap={cap ?? undefined} className="btn btn-primary" busy={busy === 'run'} onClick={() => runStep(pr, step)}>
                  <Play size={14} aria-hidden="true" /> {busy === 'run' ? 'Corriendo…' : done ? 'Ejecutar de nuevo' : 'Ejecutar'}
                </GatedButton>
              )}
              {inTerm && showCmd && (
                <button type="button" className="btn" disabled={!!busy} aria-busy={busy === 'term'} onClick={() => runInTerminal(pr, step, lines.join('\n'), vars)}
                  title={'Lo escribe en la terminal de abajo como si lo tipearas, muestra lo que imprimió' + (step.verify ? ' y lo verifica' : '')}>
                  <TerminalIcon size={14} aria-hidden="true" /> {busy === 'term' ? 'En la terminal…' : 'Correr en la terminal'}
                </button>
              )}
              {step.verify && (
                <GatedButton cap={cap ?? undefined} className="btn" busy={busy === 'verify'} onClick={() => checkStep(pr, step)}
                  title="Mira el cluster y confirma que dio lo esperado (sirve si lo hiciste en la terminal)">
                  <SearchCheck size={14} aria-hidden="true" /> Verificar
                </GatedButton>
              )}
              {!done
                ? <button type="button" className="btn btn-ghost" onClick={() => markManual(pr, step, vars)}><SquareTerminal size={14} aria-hidden="true" /> Lo hice en la terminal</button>
                : <button type="button" className="btn btn-ghost btn-sm" onClick={() => undoStep(pr, step)}>Desmarcar</button>}
            </div>
          ) : <p className="pr-locked muted"><CircleHelp size={14} aria-hidden="true" /> Elegí una opción de la pregunta para habilitar Ejecutar.</p>}
          {busy && live?.note && <p className="pr-note" role="status"><span className="dot" data-s="run" aria-hidden="true" /> {live.note}</p>}
          {o && !busy && <Outcome live={live!} back={{ practice: pr.id, title: pr.title, step: step.id, n }} />}
          {step.donde && <Donde donde={step.donde} vars={vars} done={!!done} />}
          {step.tip && <p className="pr-tip"><Lightbulb size={14} aria-hidden="true" /> {step.tip}</p>}
        </div>
      )}
    </li>
  );
}

/** El multiple choice: elegís, te dice si es o no y por qué, y recién ahí se puede ejecutar */
function Question({ pr, step, vars, pp, peek, onPeek }: { pr: Practice; step: Step; vars: Record<string, string>; pp?: PracticeProgress; peek: boolean; onPeek: () => void }) {
  const q = step.pregunta!;
  const ans = pp?.answers?.[step.id];
  const right = correctIndex(q);
  const order = optionOrder(step.id, q.opciones.length);
  const shown = ans != null || peek;
  const { pre, mid, post } = splitCommon(q.opciones.map(o => fill(o.cmd, vars)));
  return (
    <section className="pr-q" aria-label="Pregunta del paso">
      <p className="pr-q-h"><CircleHelp size={15} aria-hidden="true" /> <span>{fill(q.enunciado, vars)}</span></p>
      {pre.length > 0 && <div className="pr-q-common"><span>Todas las opciones empiezan igual:</span><pre>{pre.join('\n')}</pre></div>}
      <div className="pr-q-ops" role="group" aria-label="Opciones">
        {order.map(i => {
          const k = !shown ? undefined : i === right ? 'ok' : ans?.pick === i ? 'bad' : 'off';
          return (
            <button key={i} type="button" className="pr-q-op" data-k={k} disabled={shown} aria-pressed={ans?.pick === i}
              onClick={() => answerStep(pr, step, i)}>
              <span className="pr-q-mark" aria-hidden="true">{k === 'ok' ? <CircleCheck size={14} /> : k === 'bad' ? <CircleX size={14} /> : null}</span>
              <code>{mid[i] || '(nada más)'}</code>
            </button>
          );
        })}
      </div>
      {post.length > 0 && <div className="pr-q-common"><span>Y todas terminan igual:</span><pre>{post.join('\n')}</pre></div>}
      {ans && (ans.ok
        ? <div className="pr-q-fb" data-k="ok" role="status"><b>¡Bien! Es ese.</b> {q.opciones[right].porque}</div>
        : (
          <div className="pr-q-fb" data-k="bad" role="status">
            <p><b>Ese no.</b> {q.opciones[ans.pick]?.porque}</p>
            <p><b>El correcto es {mid[right].includes('\n') ? 'el que quedó en verde' : <code>{mid[right]}</code>}:</b> {q.opciones[right].porque}</p>
          </div>
        ))}
      {!ans && peek && <div className="pr-q-fb" data-k="info" role="status"><b>La respuesta:</b> {q.opciones[right].porque}</div>}
      {!ans && !peek && pp?.completedBefore && (
        <p className="pr-q-peek muted">Ya completaste esta práctica: podés contestar de nuevo o <button type="button" className="pr-link" onClick={onPeek}><Eye size={13} aria-hidden="true" /> ver la respuesta</button>.</p>
      )}
    </section>
  );
}

const DONDE: { k: keyof NonNullable<Step['donde']>; label: string; icon: typeof Container }[] = [
  { k: 'contenedor', label: 'En el contenedor', icon: Container },
  { k: 'hdfs', label: 'En HDFS', icon: HardDrive },
  { k: 'yarn', label: 'En YARN', icon: Layers },
  { k: 'compu', label: 'En tu compu', icon: Laptop },
];

/** Dónde queda cada cosa después del paso: contenedor, HDFS, YARN o tu compu */
function Donde({ donde, vars, done }: { donde: NonNullable<Step['donde']>; vars: Record<string, string>; done: boolean }) {
  return (
    <section className="pr-donde" aria-label="Dónde queda cada cosa">
      <h3><MapPin size={14} aria-hidden="true" /> {done ? 'Dónde quedó' : 'Dónde va a quedar'}</h3>
      <dl>
        {DONDE.filter(d => donde[d.k]).map(d => (
          <div key={d.k} data-k={d.k}>
            <dt><d.icon size={13} aria-hidden="true" /> {d.label}</dt>
            <dd>{fill(donde[d.k]!, vars)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Outcome({ live, back }: { live: StepLive; back: PracticeReturn }) {
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
      {r?.raw && <Terminal raw={r.raw} />}
      {r?.out && <Out out={r.out} />}
      {(r?.trace || r?.link) && (
        <div className="pr-out-f">
          {r.trace && (
            <details className="pr-trace">
              <summary>Qué pasó en el cluster</summary>
              <TraceView trace={r.trace} />
            </details>
          )}
          {r.link && <button type="button" className="btn btn-sm" onClick={() => { practiceReturn.set(back); navigate(r.link!.page, r.link!.arg); }}>{r.link.label} <ArrowRight size={13} aria-hidden="true" /></button>}
        </div>
      )}
    </div>
  );
}

/** La salida como en la terminal: el comando, stdout y stderr, el código de salida y de dónde salió */
function Terminal({ raw }: { raw: RawOut }) {
  const hasErr = raw.lines.some(l => l.stream === 'err');
  return (
    <details className="pr-term" open>
      <summary>Salida en la terminal <span className="pr-term-src">{raw.origen === 'proceso' ? 'lo que imprimió el comando' : raw.origen === 'terminal' ? 'lo que imprimió en tu terminal' : 'armada con lo que respondió el servicio'}</span></summary>
      <pre className="pr-term-b" aria-label="Salida del comando">
        <div className="pr-term-cmd"><span aria-hidden="true">$ </span>{raw.command}</div>
        {raw.lines.map((l, i) => <div key={i} data-s={l.stream}>{l.text || ' '}</div>)}
        {!raw.lines.length && <div className="pr-term-none">(no imprime nada)</div>}
      </pre>
      <p className="pr-term-f">
        {raw.exitCode != null && <span>Código de salida {raw.exitCode}{raw.exitCode === 0 ? ' (terminó bien)' : ''}</span>}
        {hasErr && <span><span className="pr-term-key" data-s="err">stderr</span> en ámbar: Hadoop escribe ahí sus avisos (INFO, WARN), no siempre son errores</span>}
        {raw.nota && <span>{raw.nota}</span>}
      </p>
    </details>
  );
}

function Out({ out }: { out: StepOut }) {
  if (out.kind === 'table') return <ResultTable columns={out.columns} rows={out.rows} total={out.total} label="Resultado del paso" fileName="resultado" maxHeight={320} />;
  if (out.kind === 'kv') return <KeyValue items={out.items} />;
  return <pre className="pr-text">{out.text}</pre>;
}

/** Al terminar: qué hiciste, con qué comando, dónde quedó cada cosa y cuántas acertaste */
function Finished({ pr, pp, status }: { pr: Practice; pp?: PracticeProgress; status: ClusterStatus | null }) {
  const { progress } = usePractices();
  const next = suggested(PRACTICES, progress, status, 1)[0];
  const sc = score(pr, pp);
  return (
    <section className="pr-finished" aria-label="Qué hiciste">
      <div className="pr-finished-top">
        <span className="pr-finished-ico"><Check size={18} aria-hidden="true" /></span>
        <div>
          <strong>Terminaste {pr.title}</strong>
          <span className="muted">{sc.total ? (sc.answered ? `Acertaste ${sc.firstTry} de ${sc.answered} preguntas al primer intento.` : 'No respondiste preguntas en esta vuelta.') : pr.learn[0] + '.'}</span>
        </div>
        {next && <button type="button" className="btn btn-primary" onClick={() => navigate('practicas', next.id)}>Seguir con {next.title} <ArrowRight size={14} aria-hidden="true" /></button>}
      </div>
      <details className="pr-sum" open>
        <summary>Qué hiciste, paso por paso</summary>
        <ol>
          {pr.steps.map(s => {
            const v = stepVars(s, status, pp?.vars ?? {});
            const a = pp?.answers?.[s.id];
            const where = DONDE.filter(d => s.donde?.[d.k]);
            return (
              <li key={s.id}>
                <div className="pr-sum-h">
                  <b>{s.title}</b>
                  {pp?.done[s.id]?.how === 'manual' && <span className="muted">en la terminal</span>}
                  {a && <span className="pr-ans-chip" data-ok={a.ok}>{a.ok ? 'acertaste' : 'no acertaste'}</span>}
                </div>
                <code className="pr-sum-cmd">{fill(s.command, v)}</code>
                {where.length > 0 && <ul>{where.map(d => <li key={d.k}><span className="muted">{d.label}:</span> {fill(s.donde![d.k]!, v)}</li>)}</ul>}
              </li>
            );
          })}
        </ol>
      </details>
    </section>
  );
}
