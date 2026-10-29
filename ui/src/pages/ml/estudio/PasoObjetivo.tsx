/* Paso 2, Objetivo y variables: qué columna predecir (cualquiera), el tipo de problema (detectado, se
   puede cambiar) y el rol de cada columna. Con el objetivo elegido, el perfil dice el balance de clases y
   qué tan bien lo predice cada columna sola: arriba de 0,97 es casi seguro una fuga de datos. */
import { ShieldAlert, Wand2 } from 'lucide-react';
import type { MlCatalogo, MlColumnaPerfil, MlPerfil, MlRevision, MlRol, MlTarea } from '../../../api/types';
import { EmptyState, Panel, SkeletonLines } from '../../../components/base';
import { Avisos, Campo, usePerfil } from './comun';
import { editar, MODELO_INICIAL, modeloDe, ROL_LABEL, rolesSugeridos, useEstudio } from './estado';
import { Barras, Histograma, SERIE, fnum } from './graficos';

const ROLES: MlRol[] = ['numerica', 'categorica', 'fecha', 'texto', 'id', 'ignorar'];
const TAREAS: MlTarea[] = ['regresion', 'clasificacion', 'clustering', 'reduccion'];

export function PasoObjetivo({ cat, rev }: { cat: MlCatalogo; rev: MlRevision | null }) {
  const { receta } = useEstudio();
  const sup = receta.tarea === 'regresion' || receta.tarea === 'clasificacion';
  const perfil = usePerfil(receta.datos, sup ? receta.objetivo : null);
  const p = perfil.data;
  if (!p) return <Panel title="Objetivo y variables">{perfil.error ? <EmptyState compact kind="error" title="No se pudo leer el perfil">{perfil.error}</EmptyState> : <SkeletonLines n={6} />}</Panel>;

  const sugerida = p.objetivo?.tarea;

  function cambiarTarea(t: MlTarea) {
    editar(r => {
      const m = modeloDe(cat, r.modelo.id);
      const modelo = m?.tarea === t ? r.modelo : { id: MODELO_INICIAL[m?.motor ?? 'sklearn'][t], params: {} };
      const objetivo = t === 'regresion' || t === 'clasificacion' ? r.objetivo : null;
      return { ...r, tarea: t, objetivo, modelo, validacion: { ...r.validacion, metrica: undefined, particion: undefined, cv: undefined }, busqueda: { tipo: 'ninguna' }, informe: {} };
    });
  }

  function cambiarObjetivo(col: string | null) {
    editar(r => {
      const columnas = { ...r.columnas };
      if (r.objetivo && r.objetivo in columnas) columnas[r.objetivo] = p!.columnas.find(c => c.nombre === r.objetivo)?.rol ?? 'ignorar';
      if (col) columnas[col] = 'ignorar';
      const info = p!.columnas.find(c => c.nombre === col);
      // Con un objetivo nuevo, el tipo de problema que conviene: número con muchos valores → regresión
      let tarea = r.tarea;
      if (col && info) tarea = (info.tipo === 'int' || info.tipo === 'float') && info.unicos > 20 ? 'regresion' : 'clasificacion';
      if (!col && (tarea === 'regresion' || tarea === 'clasificacion')) tarea = 'clustering';
      const m = modeloDe(cat, r.modelo.id);
      const modelo = m?.tarea === tarea ? r.modelo : { id: MODELO_INICIAL[m?.motor ?? 'sklearn'][tarea], params: {} };
      return { ...r, objetivo: col, columnas, tarea, modelo, ...(tarea !== r.tarea ? { validacion: {}, busqueda: { tipo: 'ninguna' as const }, informe: {} } : {}) };
    });
  }

  const rolDe = (c: MlColumnaPerfil): MlRol => receta.columnas[c.nombre] ?? c.rol;
  const usadas = p.columnas.filter(c => c.nombre !== receta.objetivo && c.nombre !== receta.referencia && !['id', 'ignorar'].includes(rolDe(c))).length;
  const objInfo = p.columnas.find(c => c.nombre === receta.objetivo);

  return (
    <div className="es-paso es-objetivo">
      <Panel title="Qué querés predecir">
        <div className="es-form">
          <Campo label="Objetivo" nombre="y" ayuda="La columna que el modelo aprende a predecir a partir de las demás. Sin objetivo, el estudio busca grupos (clustering) o resume columnas (PCA).">
            <select className="input mono" value={receta.objetivo ?? ''} onChange={e => cambiarObjetivo(e.target.value || null)} aria-label="Columna objetivo">
              <option value="">— sin objetivo (agrupar o reducir) —</option>
              {p.columnas.map(c => <option key={c.nombre} value={c.nombre}>{c.nombre} · {c.tipo} · {fnum(c.unicos)} distintos</option>)}
            </select>
          </Campo>
          <Campo label="Tipo de problema" ayuda={cat.tareas[receta.tarea].que}
            nota={sugerida && sup ? (sugerida === receta.tarea ? `Detectado: ${p.objetivo?.por_que}` : <>El objetivo parece de <b>{cat.tareas[sugerida].etiqueta.toLowerCase()}</b> ({p.objetivo?.por_que}). <button type="button" className="es-link" onClick={() => cambiarTarea(sugerida)}>Usar {cat.tareas[sugerida].etiqueta.toLowerCase()}</button></>) : undefined}>
            <div className="es-ops" role="radiogroup" aria-label="Tipo de problema">
              {TAREAS.map(t => {
                const necesita = (t === 'regresion' || t === 'clasificacion') && !receta.objetivo;
                return (
                  <button key={t} type="button" role="radio" aria-checked={receta.tarea === t} disabled={necesita}
                    title={necesita ? 'Elegí primero una columna objetivo' : cat.tareas[t].que} onClick={() => cambiarTarea(t)}>
                    <b>{cat.tareas[t].etiqueta}</b><span>{cat.tareas[t].que}</span>
                  </button>
                );
              })}
            </div>
          </Campo>
          {receta.tarea === 'clustering' && (
            <Campo label="Columna para comparar" nombre="referencia" ayuda="Opcional. No se usa para entrenar: al final se compara cuánto se parecen los grupos a esta columna (índice de Rand ajustado).">
              <select className="input mono" value={receta.referencia ?? ''} onChange={e => editar(r => ({ ...r, referencia: e.target.value || null, columnas: e.target.value ? { ...r.columnas, [e.target.value]: 'ignorar' } : r.columnas }))}>
                <option value="">— ninguna —</option>
                {p.columnas.map(c => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
              </select>
            </Campo>
          )}
        </div>
        {sup && objInfo && <Objetivo info={objInfo} tarea={receta.tarea} />}
      </Panel>

      <Panel title="Variables" sub={`${usadas} de ${p.columnas.length - (receta.objetivo ? 1 : 0)} entran al modelo`} flush
        end={<button type="button" className="btn btn-sm" onClick={() => editar(r => ({ ...r, columnas: rolesSugeridos(p, r.objetivo) }))}><Wand2 size={13} aria-hidden="true" />Roles sugeridos</button>}>
        <TablaRoles perfil={p} rolDe={rolDe} objetivo={receta.objetivo} referencia={receta.referencia ?? null} />
        <div className="es-pad"><Avisos rev={rev} prefijos={['objetivo', 'columnas', 'referencia', 'tarea']} /></div>
      </Panel>
    </div>
  );
}

function Objetivo({ info, tarea }: { info: MlColumnaPerfil; tarea: MlTarea }) {
  if (tarea === 'clasificacion' && info.balance) {
    const menor = Math.min(...info.balance.map(b => b.pct));
    return (
      <div className="es-obj">
        <h3>Balance de clases <span className="muted">{info.balance.length} clases{menor < 0.1 && ' · desbalanceado'}</span></h3>
        <Barras titulo="Filas por clase" items={info.balance.slice(0, 12).map((b, i) => ({ etiqueta: b.clase, valor: b.pct, color: SERIE[i % SERIE.length], nota: `${fnum(b.n)} filas` }))}
          fmt={v => `${(v * 100).toFixed(1).replace('.', ',')} %`} max={1} />
        {menor < 0.1 && <p className="es-nota">Con una clase rara, la exactitud engaña: conviene partición estratificada, <span className="mono">class_weight=balanced</span> y medir con F1 macro o PR AUC.</p>}
      </div>
    );
  }
  if (info.histograma) {
    return (
      <div className="es-obj">
        <h3>Distribución del objetivo <span className="muted">media {fnum(info.num?.media)} · desvío {fnum(info.num?.desvio)}</span></h3>
        <Histograma bordes={info.histograma.bordes} cuentas={info.histograma.cuentas} xLabel={info.nombre} titulo={`Distribución de ${info.nombre}`} />
      </div>
    );
  }
  return null;
}

function TablaRoles({ perfil, rolDe, objetivo, referencia }: { perfil: MlPerfil; rolDe: (c: MlColumnaPerfil) => MlRol; objetivo: string | null; referencia: string | null }) {
  const hayAsoc = perfil.columnas.some(c => c.asociacion);
  return (
    <div className="tbl-wrap">
      <table className="tbl es-roles" aria-label="Rol de cada columna">
        <thead><tr><th>columna</th><th>tipo</th><th>rol</th>{hayAsoc && <th>predice al objetivo, sola</th>}<th>nota</th></tr></thead>
        <tbody>
          {perfil.columnas.map(c => {
            const esObj = c.nombre === objetivo, esRef = c.nombre === referencia;
            const rol = rolDe(c);
            const asoc = c.asociacion?.valor;
            const fuga = asoc != null && asoc >= 0.97 && !esObj && !['id', 'ignorar'].includes(rol);
            return (
              <tr key={c.nombre} data-rol={esObj ? 'objetivo' : rol}>
                <td className="mono">{c.nombre}</td>
                <td className="mono muted">{c.tipo}</td>
                <td>
                  {esObj ? <span className="badge" data-k="ok">objetivo</span> : esRef ? <span className="badge">para comparar</span> : (
                    <select className="input select-sm" value={rol} aria-label={`Rol de ${c.nombre}`}
                      onChange={e => editar(r => ({ ...r, columnas: { ...r.columnas, [c.nombre]: e.target.value as MlRol } }))}>
                      {ROLES.map(x => <option key={x} value={x}>{ROL_LABEL[x]}{x === c.rol ? ' (sugerido)' : ''}</option>)}
                    </select>
                  )}
                </td>
                {hayAsoc && (
                  <td>{asoc != null && !esObj ? (
                    <span className="es-asoc" data-k={fuga ? 'bad' : undefined} title={`${c.asociacion!.metodo}: ${asoc.toFixed(2)} (0 = nada, 1 = perfecto)`}>
                      <i style={{ width: `${Math.max(2, asoc * 100)}%` }} /><span className="mono">{asoc.toFixed(2).replace('.', ',')}</span>
                      {fuga && <ShieldAlert size={13} aria-label="posible fuga de datos" />}
                    </span>) : null}</td>
                )}
                <td className="muted es-resu">{esObj ? 'lo que se predice' : c.rol === 'id' && rol !== 'id' ? 'parece un identificador' : c.por_que}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
