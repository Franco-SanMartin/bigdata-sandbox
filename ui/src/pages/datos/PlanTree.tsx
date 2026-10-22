/* Plan de una consulta (EXPLAIN de Hive y MySQL, explain() de MongoDB) como árbol indentado, más la salida tal cual. */
import type { QueryPlan } from '../../api/types';
import { EngineTag } from '../../components/Trace';
import { CodeBlock } from '../../components/ui';
import { nf } from '../../lib/format';

type PlanNode = QueryPlan['nodes'][number];
interface Line { node: PlanNode; prefix: string }

/** Recorre el árbol desde la raíz y arma el prefijo de cada línea (├─ └─ │) */
function flatten(plan: QueryPlan): Line[] {
  const byId = new Map(plan.nodes.map(n => [n.id, n]));
  const childIds = new Set(plan.nodes.flatMap(n => n.children));
  const roots = plan.nodes.filter(n => !childIds.has(n.id));
  const out: Line[] = [];
  const seen = new Set<number>();
  const walk = (n: PlanNode, lead: string, last: boolean, depth: number) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    out.push({ node: n, prefix: depth === 0 ? '' : lead + (last ? '└─ ' : '├─ ') });
    const kids = n.children.map(id => byId.get(id)).filter((k): k is PlanNode => !!k);
    kids.forEach((k, i) => walk(k, depth === 0 ? '' : lead + (last ? '   ' : '│  '), i === kids.length - 1, depth + 1));
  };
  (roots.length ? roots : plan.nodes.slice(0, 1)).forEach((r, i, a) => walk(r, '', i === a.length - 1, 0));
  return out;
}

/** Lee la tabla o colección entera: lo que conviene mirar en un plan */
const fullScan = (n: PlanNode) => /COLLSCAN|\(ALL\)|TableScan/.test(n.label + ' ' + (n.detail ?? ''));

export function PlanTree({ plan }: { plan: QueryPlan }) {
  const lines = flatten(plan);
  return (
    <div>
      <div className="plan-sum">
        <EngineTag engine={plan.engine} />
        <span>{plan.yarnStages ? `Lanza un trabajo en YARN con ${plan.yarnStages} etapas` : 'Sin trabajo en YARN: lo resuelve el motor en su proceso'}</span>
        <span>{nf(plan.nodes.length)} operadores</span>
      </div>
      <ul className="plan" aria-label="Plan de la consulta">
        {lines.map(({ node, prefix }) => (
          <li key={node.id} className="plan-n">
            <span className="br" aria-hidden="true">{prefix}</span>
            <span><span className="lb">{node.label}</span>{fullScan(node) && <span className="tag">lee todo</span>}{node.detail && <span className="dt">{node.detail}</span>}</span>
            <span className="rw">{node.rows != null ? `${nf(node.rows)} ${node.rows === 1 ? 'fila' : 'filas'}` : ''}</span>
          </li>
        ))}
      </ul>
      <details className="raw">
        <summary>Salida del motor ({plan.source === 'mongodb' ? 'explain()' : 'EXPLAIN'})</summary>
        <CodeBlock lines={plan.raw} prompt={null} label="Salida del plan" />
      </details>
    </div>
  );
}
