/* Paso 5, Validación y búsqueda: cómo se parte (holdout aleatorio, estratificado o temporal, con o sin
   validación aparte), la validación cruzada, la semilla, la métrica que decide, la búsqueda de
   hiperparámetros con su espacio y su presupuesto, y qué curvas calcular. */
import { Plus, Trash2 } from 'lucide-react';
import type { MlBusqueda, MlCatalogo, MlParam, MlRango, MlRevision, MlValidacion, MlValor } from '../../../api/types';
import { Panel } from '../../../components/base';
import { Meter, Switch } from '../../../components/ui';
import { Avisos, Campo, Numero, Opciones } from './comun';
import { editar, modeloDe, textoValor, useEstudio } from './estado';
import { AyudaParam } from './PasoModelo';
import { HelpTip } from '../../../components/base';

export function PasoValidacion({ cat, rev }: { cat: MlCatalogo; rev: MlRevision | null }) {
  const { receta } = useEstudio();
  const modelo = modeloDe(cat, receta.modelo.id);
  const motor = modelo?.motor ?? 'sklearn';
  const sup = receta.tarea === 'regresion' || receta.tarea === 'clasificacion';
  const val: MlValidacion = { ...(rev?.receta.validacion ?? {} as MlValidacion), ...stripUndef(receta.validacion) } as MlValidacion;
  const bus: MlBusqueda = { ...(rev?.receta.busqueda ?? {} as MlBusqueda), ...stripUndef(receta.busqueda) } as MlBusqueda;
  const setV = <K extends keyof MlValidacion>(k: K, v: MlValidacion[K]) => editar(r => ({ ...r, validacion: { ...r.validacion, [k]: v } }));
  const setB = <K extends keyof MlBusqueda>(k: K, v: MlBusqueda[K]) => editar(r => ({ ...r, busqueda: { ...r.busqueda, [k]: v } }));
  const metricas = Object.entries(cat.metricas).filter(([, m]) => m.tarea === receta.tarea && (motor === 'sklearn' ? m.sklearn || !sup : m.spark || !sup));
  const columnasTiempo = Object.entries(receta.columnas).filter(([c, r]) => c !== receta.objetivo && (r === 'fecha' || r === 'numerica' || r === 'ignorar' || r === 'id')).map(([c]) => c);
  const revB = rev?.receta.busqueda;

  if (!sup) {
    return (
      <div className="es-paso">
        <Panel title="Validación">
          <p className="es-nota">{receta.tarea === 'clustering' ? 'En clustering no hay una respuesta correcta para validar: se entrena con todas las filas y se mide qué tan compactos y separados quedan los grupos (silhouette, Davies-Bouldin, Calinski-Harabasz y, si elegiste una columna para comparar, el índice de Rand ajustado).' : 'PCA no se valida: se mira cuánta varianza juntan las componentes.'}</p>
          <div className="es-form">
            <Campo label="Semilla" nombre="random_state" ayuda="Fija el azar (inicios de KMeans, muestras): con la misma semilla sale lo mismo.">
              <Numero value={val.semilla ?? 42} onChange={v => v != null && setV('semilla', Math.round(v))} min={0} label="Semilla" />
            </Campo>
            <Campo label="Métrica principal">
              <select className="input" value={val.metrica} onChange={e => setV('metrica', e.target.value)}>
                {metricas.map(([k, m]) => <option key={k} value={k}>{m.etiqueta}</option>)}
              </select>
            </Campo>
          </div>
        </Panel>
        <Curvas cat={cat} />
        <Avisos rev={rev} prefijos={['validacion', 'busqueda', 'informe']} />
      </div>
    );
  }

  const particiones = Object.entries(cat.particiones).map(([k, p]) => ({ valor: k, etiqueta: p.etiqueta, ayuda: p.ayuda,
    deshabilitada: k === 'estratificada' && receta.tarea !== 'clasificacion' ? 'Solo en clasificación' : undefined }));
  const cvs = Object.entries(cat.cv).map(([k, c]) => ({ valor: k, etiqueta: c.etiqueta, ayuda: c.ayuda,
    deshabilitada: motor === 'spark' && !['ninguna', 'kfold'].includes(k) ? 'Spark MLlib solo tiene KFold (CrossValidator)' : k === 'estratificada' && receta.tarea !== 'clasificacion' ? 'Solo en clasificación' : undefined }));
  const busquedas = Object.entries(cat.busquedas[motor]).map(([k, b]) => ({ valor: k, etiqueta: b.etiqueta, ayuda: b.ayuda }));

  return (
    <div className="es-paso es-val">
      <div className="es-val-grid">
        <Panel title="Partición">
          <div className="es-form">
            <Campo label="Cómo se separa la prueba">
              <Opciones value={val.particion} onChange={v => setV('particion', v)} opciones={particiones} label="Tipo de partición" />
            </Campo>
            {(val.particion === 'temporal' || val.cv === 'temporal') && (
              <Campo label="Columna de tiempo" nombre="orden" ayuda="Se ordena por esta columna: lo más viejo entrena, lo más nuevo prueba." error={rev?.errores.find(e => e.campo === 'validacion.columna_tiempo')?.mensaje}>
                <select className="input mono" value={val.columna_tiempo ?? ''} onChange={e => setV('columna_tiempo', e.target.value || null)}>
                  <option value="">— elegí —</option>
                  {columnasTiempo.map(c => <option key={c} value={c}>{c} ({receta.columnas[c]})</option>)}
                </select>
              </Campo>
            )}
            <div className="es-form-fila">
              <Campo label="Prueba" nombre="test_size" ayuda="Las filas que no se tocan hasta el final: la nota honesta del modelo." nota={`${Math.round(val.prueba * 100)} % de las filas`}>
                <input type="range" min={5} max={50} value={Math.round(val.prueba * 100)} onChange={e => setV('prueba', Number(e.target.value) / 100)} aria-label="Porcentaje de prueba" className="es-rango" />
              </Campo>
              <Campo label="Validación aparte" ayuda="Otra parte, separada de la prueba, para comparar modelos sin gastar la prueba. Con validación cruzada no hace falta." nota={val.validacion ? `${Math.round(val.validacion * 100)} %` : 'no'}>
                <input type="range" min={0} max={30} value={Math.round(val.validacion * 100)} onChange={e => setV('validacion', Number(e.target.value) / 100)} aria-label="Porcentaje de validación" className="es-rango" />
              </Campo>
            </div>
            <Campo label="Semilla" nombre="random_state" ayuda="Fija todo el azar (partición, particiones de la CV, modelos con azar): con la misma semilla sale exactamente lo mismo.">
              <Numero value={val.semilla} onChange={v => v != null && setV('semilla', Math.round(v))} min={0} label="Semilla" />
            </Campo>
          </div>
        </Panel>

        <Panel title="Validación cruzada">
          <div className="es-form">
            <Opciones value={val.cv} onChange={v => setV('cv', v)} opciones={cvs} label="Tipo de validación cruzada" />
            {val.cv !== 'ninguna' && (
              <div className="es-form-fila">
                <Campo label="Particiones" nombre="n_splits"><Numero value={val.k} onChange={v => v != null && setV('k', Math.round(v))} min={2} max={20} label="Particiones" ancho={80} /></Campo>
                {val.cv === 'repetida' && <Campo label="Repeticiones" nombre="n_repeats"><Numero value={val.repeticiones} onChange={v => v != null && setV('repeticiones', Math.round(v))} min={1} max={10} label="Repeticiones" ancho={80} /></Campo>}
              </div>
            )}
            <Campo label="Métrica principal" ayuda="La que decide qué modelo es mejor (en la búsqueda y en la tabla de posiciones). Las demás se calculan igual.">
              <select className="input" value={val.metrica} onChange={e => setV('metrica', e.target.value)}>
                {metricas.map(([k, m]) => <option key={k} value={k}>{m.etiqueta}{m.mayor_mejor ? '' : ' (menos es mejor)'}</option>)}
              </select>
            </Campo>
            <p className="es-nota">{cat.metricas[val.metrica]?.ayuda}</p>
          </div>
        </Panel>
      </div>

      <Panel title="Búsqueda de hiperparámetros" sub={motor === 'spark' ? 'ParamGridBuilder + CrossValidator o TrainValidationSplit' : 'GridSearchCV, RandomizedSearchCV y successive halving'}>
        <div className="es-form">
          <Opciones value={bus.tipo} onChange={v => setB('tipo', v)} opciones={busquedas} label="Tipo de búsqueda" />
          {bus.tipo !== 'ninguna' && modelo && (
            <>
              <Espacio params={modelo.params} espacio={receta.busqueda.espacio ?? {}} rangos={bus.tipo === 'random' || bus.tipo === 'halving_random'} onChange={e => setB('espacio', e)} />
              <div className="es-form-fila">
                {(bus.tipo === 'random' || bus.tipo === 'halving_random') && <Campo label="Combinaciones" nombre="n_iter" ayuda="Cuántas combinaciones al azar prueba."><Numero value={bus.iteraciones} onChange={v => v != null && setB('iteraciones', Math.round(v))} min={1} max={500} label="Combinaciones" ancho={80} /></Campo>}
                {bus.tipo.startsWith('halving') && <Campo label="Factor" nombre="factor" ayuda="En cada ronda sigue 1 de cada 'factor' candidatos, con 'factor' veces más filas."><Numero value={bus.factor} onChange={v => v != null && setB('factor', Math.round(v))} min={2} max={10} label="Factor" ancho={70} /></Campo>}
                <Campo label="Tiempo máximo" nombre="min" ayuda="Si se pasa, la corrida se corta (y queda marcada como cortada)."><Numero value={bus.max_minutos} onChange={v => v != null && setB('max_minutos', Math.round(v))} min={1} max={cat.limites.max_minutos} label="Minutos" ancho={70} /></Campo>
                <Campo label={motor === 'spark' ? 'Modelos a la vez' : 'Procesos'} nombre={motor === 'spark' ? 'parallelism' : 'n_jobs'} ayuda="Más procesos = más rápido, pero cada uno ocupa su memoria: en una notebook, 1 o 2."><Numero value={bus.n_jobs} onChange={v => v != null && setB('n_jobs', Math.round(v))} min={1} max={cat.limites.max_n_jobs} label="Procesos" ancho={70} /></Campo>
              </div>
              {revB?.ajustes != null && (
                <div className="es-presupuesto">
                  <span><b>{revB.candidatos}</b> combinaciones × particiones = <b>{revB.ajustes}</b> entrenamientos</span>
                  <Meter value={revB.ajustes} max={cat.limites.max_ajustes} kind={revB.ajustes > cat.limites.max_ajustes ? 'bad' : revB.ajustes > 300 ? 'run' : 'ok'} label="Presupuesto de la búsqueda" />
                  <span className="muted">máximo {cat.limites.max_ajustes}</span>
                </div>
              )}
            </>
          )}
        </div>
      </Panel>

      <Curvas cat={cat} />
      <Avisos rev={rev} prefijos={['validacion', 'busqueda', 'informe']} />
    </div>
  );
}

function stripUndef<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function Espacio({ params, espacio, rangos, onChange }: {
  params: MlParam[]; espacio: Record<string, MlValor[] | MlRango>; rangos: boolean; onChange: (e: Record<string, MlValor[] | MlRango>) => void;
}) {
  const buscables = params.filter(p => p.tipo !== 'str');
  const libres = buscables.filter(p => !(p.nombre in espacio));
  const poner = (k: string, v: MlValor[] | MlRango) => onChange({ ...espacio, [k]: v });
  const sacar = (k: string) => { const { [k]: _, ...r } = espacio; void _; onChange(r); };
  const agregar = (k: string) => {
    const p = params.find(x => x.nombre === k)!;
    poner(k, p.buscar?.length ? [...p.buscar] : p.opciones ? p.opciones.map(o => o.valor) : p.tipo === 'bool' ? [true, false] : [p.defecto]);
  };
  return (
    <div className="es-espacio">
      <table className="tbl" aria-label="Espacio de búsqueda">
        <thead><tr><th>hiperparámetro</th><th>valores a probar</th><th className="r">cuántos</th><th /></tr></thead>
        <tbody>
          {Object.entries(espacio).map(([k, v]) => {
            const p = params.find(x => x.nombre === k);
            if (!p) return null;
            const esRango = !Array.isArray(v);
            return (
              <tr key={k}>
                <td><span className="mono">{k}</span> <HelpTip label={`Qué hace ${k}`}><AyudaParam p={p} /></HelpTip></td>
                <td>
                  {esRango ? (
                    <span className="es-fila">de <Numero value={(v as MlRango).min} onChange={x => x != null && poner(k, { ...(v as MlRango), min: x })} label={`${k} mínimo`} ancho={90} />
                      a <Numero value={(v as MlRango).max} onChange={x => x != null && poner(k, { ...(v as MlRango), max: x })} label={`${k} máximo`} ancho={90} />
                      <label className="es-nulo"><input type="checkbox" checked={!!(v as MlRango).log} onChange={e => poner(k, { ...(v as MlRango), log: e.target.checked })} />escala log</label></span>
                  ) : p.opciones ? (
                    <span className="es-chips">{p.opciones.map(o => {
                      const on = (v as MlValor[]).some(x => x === o.valor);
                      return <button key={String(o.valor)} type="button" aria-pressed={on} onClick={() => poner(k, on ? (v as MlValor[]).filter(x => x !== o.valor) : [...(v as MlValor[]), o.valor])}>{o.etiqueta}</button>;
                    })}</span>
                  ) : (
                    <ListaValores p={p} valores={v as MlValor[]} onChange={x => poner(k, x)} />
                  )}
                  {rangos && (p.tipo === 'int' || p.tipo === 'float') && (
                    <button type="button" className="es-link es-alterna" onClick={() => poner(k, esRango ? (p.buscar?.length ? [...p.buscar] : [p.defecto]) : { min: p.min ?? 0, max: p.max ?? 1, log: !!p.log && (p.min ?? 0) > 0 })}>
                      {esRango ? 'usar una lista' : 'usar un rango'}
                    </button>
                  )}
                </td>
                <td className="r mono">{esRango ? '∞' : (v as MlValor[]).length}</td>
                <td><button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={() => sacar(k)} aria-label={`Sacar ${k} de la búsqueda`}><Trash2 size={13} /></button></td>
              </tr>
            );
          })}
          {!Object.keys(espacio).length && <tr><td colSpan={4} className="muted">Agregá los hiperparámetros que querés buscar.</td></tr>}
        </tbody>
      </table>
      {libres.length > 0 && (
        <label className="es-fila es-agregar"><Plus size={13} aria-hidden="true" />
          <select className="input select-sm" value="" onChange={e => e.target.value && agregar(e.target.value)} aria-label="Agregar un hiperparámetro a la búsqueda">
            <option value="">Agregar hiperparámetro…</option>
            {libres.map(p => <option key={p.nombre} value={p.nombre}>{p.nombre}{p.buscar ? ' (con valores sugeridos)' : ''}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

function ListaValores({ p, valores, onChange }: { p: MlParam; valores: MlValor[]; onChange: (v: MlValor[]) => void }) {
  const txt = valores.map(v => (v === null ? 'None' : String(v))).join(', ');
  return (
    <input className="input mono es-lista" defaultValue={txt} key={txt} aria-label={`Valores de ${p.nombre}`}
      placeholder={p.tipo === 'layers' ? '32; 64,32 (capas separadas por ;)' : 'separados por coma'}
      onBlur={e => {
        const sep = p.tipo === 'layers' ? ';' : ',';
        const raw = e.target.value.split(p.tipo === 'layers' && e.target.value.includes(';') ? ';' : sep).map(s => s.trim()).filter(Boolean);
        onChange(raw.map(s => (s === 'None' || s === 'null' ? null : p.tipo === 'layers' ? s : p.tipo === 'bool' ? s === 'true' : Number.isNaN(Number(s.replace(',', '.'))) ? s : Number(s.replace(',', '.')))));
      }}
      title={`Ej.: ${(p.buscar ?? [p.defecto]).map(v => textoValor(p, v)).join(', ')}`} />
  );
}

function Curvas({ cat }: { cat: MlCatalogo }) {
  const { receta } = useEstudio();
  const modelo = modeloDe(cat, receta.modelo.id);
  const inf = receta.informe ?? {};
  const sup = receta.tarea === 'regresion' || receta.tarea === 'clasificacion';
  const spark = modelo?.motor === 'spark';
  const set = (k: string, v: unknown) => editar(r => ({ ...r, informe: { ...r.informe, [k]: v } }));
  const numericos = (modelo?.params ?? []).filter(p => p.tipo === 'int' || p.tipo === 'float' || p.tipo === 'choice');
  const cv = inf.curva_validacion;
  return (
    <Panel title="Curvas e importancia" sub="se calculan después de entrenar; tardan">
      <div className="es-form">
        {sup && !spark && (
          <Campo label="Curva de aprendizaje" nombre="learning_curve" ayuda="El puntaje con 10 %, 32 %, 55 %, 78 % y 100 % del entrenamiento: si la validación sigue subiendo, más datos ayudarían; si entrenamiento y validación están lejos, sobreajusta.">
            <Switch checked={inf.curva_aprendizaje ?? true} onChange={v => set('curva_aprendizaje', v)} label="Curva de aprendizaje" />
          </Campo>
        )}
        {sup && !spark && (
          <Campo label="Importancia por permutación" nombre="permutation_importance" ayuda="Cuánto empeora la métrica de prueba si se mezcla una columna: la importancia de cada variable, para cualquier modelo.">
            <Switch checked={inf.permutacion ?? true} onChange={v => set('permutacion', v)} label="Importancia por permutación" />
          </Campo>
        )}
        <Campo label="Curva de validación" nombre="validation_curve" ayuda={receta.tarea === 'clustering' ? 'Silhouette (y la inercia, para el codo) según la cantidad de grupos.' : 'El puntaje de entrenamiento y validación según los valores de un hiperparámetro: dónde empieza a sobreajustar.'}>
          <span className="es-fila">
            <select className="input select-sm" value={cv?.param ?? ''} aria-label="Hiperparámetro de la curva de validación"
              onChange={e => { const p = numericos.find(x => x.nombre === e.target.value); set('curva_validacion', p ? { param: p.nombre, valores: p.buscar?.length ? p.buscar : p.opciones ? p.opciones.map(o => o.valor) : [p.defecto] } : undefined); }}>
              <option value="">{receta.tarea === 'clustering' && !spark ? 'por defecto (2 a 8 grupos)' : 'ninguna'}</option>
              {numericos.map(p => <option key={p.nombre} value={p.nombre}>{p.nombre}</option>)}
            </select>
            {cv && numericos.find(p => p.nombre === cv.param) && (
              <ListaValores p={numericos.find(p => p.nombre === cv.param)!} valores={cv.valores} onChange={v => set('curva_validacion', { ...cv, valores: v })} />
            )}
          </span>
        </Campo>
      </div>
    </Panel>
  );
}
