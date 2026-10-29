/* Paso 4, Modelo e hiperparámetros. El catálogo (sandbox_ml/catalogo.py) trae el esquema completo de cada
   hiperparámetro: tipo, rango, valor por defecto, cuándo se usa y qué hace. El formulario se arma solo de
   ahí: un parámetro que no se usa con los demás (momentum sin solver=sgd) se muestra apagado y no va al código. */
import { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { MlCatalogo, MlModelo, MlMotor, MlParam, MlRevision, MlValor } from '../../../api/types';
import { Panel } from '../../../components/base';
import { HelpTip } from '../../../components/base';
import { Seg, Switch } from '../../../components/ui';
import { Avisos, Numero } from './comun';
import { activo, editar, iguales, MODELO_INICIAL, modeloDe, textoValor, useEstudio, valoresDe } from './estado';

export function PasoModelo({ cat, rev }: { cat: MlCatalogo; rev: MlRevision | null }) {
  const { receta } = useEstudio();
  const actual = modeloDe(cat, receta.modelo.id);
  const motor: MlMotor = actual?.motor ?? 'sklearn';
  const modelos = cat.modelos.filter(m => m.tarea === receta.tarea && m.motor === motor);
  const familias = useMemo(() => [...new Set(modelos.map(m => m.familia))], [modelos]);

  function elegir(id: string) { editar(r => ({ ...r, modelo: { id, params: {} }, busqueda: { ...r.busqueda, espacio: {} }, informe: { ...r.informe, curva_validacion: undefined } })); }
  function cambiarMotor(m: MlMotor) {
    if (m === motor) return;
    const eq = m === 'spark' ? cat.equivalente[receta.modelo.id] : Object.entries(cat.equivalente).find(([, v]) => v === receta.modelo.id)?.[0];
    const id = eq && modeloDe(cat, eq)?.tarea === receta.tarea ? eq : MODELO_INICIAL[m][receta.tarea];
    editar(r => ({ ...r, modelo: { id, params: {} }, validacion: { ...r.validacion, metrica: undefined, cv: undefined, particion: undefined },
                   busqueda: { tipo: 'ninguna' }, informe: {} }));
  }

  return (
    <div className="es-paso es-modelo">
      <Panel title="Modelo" sub={`${modelos.length} para ${cat.tareas[receta.tarea].etiqueta.toLowerCase()}`} flush
        end={<Seg value={motor} onChange={cambiarMotor} label="Motor" options={[
          { value: 'sklearn', label: 'scikit-learn', tip: 'En una sola máquina (pandas en memoria): milisegundos con datos que entran en RAM' },
          { value: 'spark', label: 'Spark MLlib', tip: 'Repartido en los executors de YARN: para datos que no entran en una máquina. Arrancar Spark cuesta ~20 s' },
        ]} />}>
        <div className="es-familias">
          {familias.map(f => (
            <section key={f} aria-label={f}>
              <h3>{f}</h3>
              <div className="es-modelos" role="radiogroup" aria-label={`Modelos: ${f}`}>
                {modelos.filter(m => m.familia === f).map(m => (
                  <button key={m.id} type="button" role="radio" aria-checked={m.id === receta.modelo.id} onClick={() => elegir(m.id)} className="es-mcard">
                    <b>{m.etiqueta}</b>
                    <span className="mono es-mclase">{m.clase.split('.').pop()}</span>
                    <span className="es-mque">{m.que}</span>
                    <span className="es-mtags">
                      {m.costo && <span className="tag" title="Costo computacional">{m.costo}</span>}
                      {m.escala && <span className="tag" title="Necesita las columnas escaladas">escalar</span>}
                      {m.nulos && <span className="tag" title="Acepta nulos sin imputar">nulos ok</span>}
                      {m.binaria && <span className="tag" title="Solo dos clases">binaria</span>}
                      {m.extra && <span className="tag">{m.extra}</span>}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </Panel>
      {actual && <Hiperparametros modelo={actual} params={receta.modelo.params} rev={rev} />}
    </div>
  );
}

function Hiperparametros({ modelo, params, rev }: { modelo: MlModelo; params: Record<string, MlValor>; rev: MlRevision | null }) {
  const valores = valoresDe(modelo, params);
  const grupos = [...new Set(modelo.params.map(p => p.grupo ?? 'General'))];
  const cambiados = modelo.params.filter(p => p.nombre in params && !iguales(params[p.nombre], p.defecto)).length;
  const set = (k: string, v: MlValor) => editar(r => ({ ...r, modelo: { ...r.modelo, params: { ...r.modelo.params, [k]: v } } }));
  const reset = (k?: string) => editar(r => {
    if (!k) return { ...r, modelo: { ...r.modelo, params: {} } };
    const { [k]: _, ...resto } = r.modelo.params;
    void _;
    return { ...r, modelo: { ...r.modelo, params: resto } };
  });
  const errores = rev?.errores.filter(e => e.campo.startsWith('modelo.params.')) ?? [];
  return (
    <Panel title={<>Hiperparámetros <span className="mono muted">{modelo.clase}</span></>}
      sub={cambiados ? `${cambiados} cambiado${cambiados > 1 ? 's' : ''}` : 'los valores por defecto'}
      end={cambiados > 0 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => reset()}><RotateCcw size={13} aria-hidden="true" />Todos por defecto</button>}>
      {modelo.params.length === 0 && <p className="muted">Este modelo no tiene hiperparámetros para tocar.</p>}
      <div className="es-hp">
        {grupos.map(g => (
          <fieldset key={g} className="es-hpg">
            <legend>{g}</legend>
            {modelo.params.filter(p => (p.grupo ?? 'General') === g).map(p => (
              <ParamCampo key={p.nombre} p={p} valor={valores[p.nombre]} activo={activo(p, valores)} cambiado={p.nombre in params && !iguales(params[p.nombre], p.defecto)}
                error={errores.find(e => e.campo === `modelo.params.${p.nombre}`)?.mensaje} onChange={v => set(p.nombre, v)} onReset={() => reset(p.nombre)} modelo={modelo} valores={valores} />
            ))}
          </fieldset>
        ))}
      </div>
      <Avisos rev={rev} prefijos={['modelo']} />
    </Panel>
  );
}

export function AyudaParam({ p }: { p: MlParam }) {
  return (
    <span className="es-ayuda">
      <b>Qué hace.</b> {p.ayuda.que}<br />
      <b>Efecto.</b> {p.ayuda.efecto}<br />
      <b>Rango sugerido.</b> {p.ayuda.rango}<br />
      <span className="muted">Por defecto: <span className="mono">{textoValor(p, p.defecto)}</span>{p.min != null && <> · permitido de <span className="mono">{p.min}</span> a <span className="mono">{p.max}</span></>}{p.log && ' · conviene probar en escala log'}</span>
    </span>
  );
}

function condicion(p: MlParam, modelo: MlModelo): string {
  return Object.entries(p.si ?? {}).map(([k, vals]) => {
    const otro = modelo.params.find(x => x.nombre === k);
    return vals === 'no_nulo' ? `con ${k} prendido` : `con ${k} = ${vals.map(v => textoValor(otro, v)).join(' o ')}`;
  }).join(' y ');
}

function ParamCampo({ p, valor, activo: on, cambiado, error, onChange, onReset, modelo }: {
  p: MlParam; valor: MlValor; activo: boolean; cambiado: boolean; error?: string; onChange: (v: MlValor) => void; onReset: () => void;
  modelo: MlModelo; valores: Record<string, MlValor>;
}) {
  return (
    <div className="es-param" data-off={!on || undefined} data-cambiado={cambiado || undefined} data-error={error ? true : undefined}>
      <span className="es-pn">
        <span className="mono">{p.nombre}</span>
        <HelpTip label={`Qué hace ${p.nombre}`}><AyudaParam p={p} /></HelpTip>
        {cambiado && <button type="button" className="es-preset" onClick={onReset} title={`Volver a ${textoValor(p, p.defecto)}`} aria-label={`Volver ${p.nombre} al valor por defecto`}><RotateCcw size={11} /></button>}
      </span>
      <span className="es-pc">{on ? <Control p={p} valor={valor} onChange={onChange} /> : <span className="muted es-pcond">solo {condicion(p, modelo)}</span>}</span>
      <span className="es-pq">{error ? <span className="es-cerr">{error}</span> : p.ayuda.que}</span>
    </div>
  );
}

function Control({ p, valor, onChange }: { p: MlParam; valor: MlValor; onChange: (v: MlValor) => void }) {
  if (p.tipo === 'bool') return <Switch checked={!!valor} onChange={onChange} label={p.nombre} />;
  if (p.tipo === 'choice') {
    const i = p.opciones!.findIndex(o => iguales(o.valor, valor));
    return (
      <select className="input select-sm" value={i < 0 ? '' : String(i)} aria-label={p.nombre} onChange={e => onChange(p.opciones![Number(e.target.value)].valor)}>
        {p.opciones!.map((o, j) => <option key={j} value={j}>{o.etiqueta}{iguales(o.valor, p.defecto) ? ' (por defecto)' : ''}</option>)}
      </select>
    );
  }
  if (p.tipo === 'layers') return <Capas valor={String(valor ?? '')} onChange={onChange} />;
  if (p.tipo === 'int' || p.tipo === 'float') {
    return (
      <span className="es-fila">
        {p.nulo && <label className="es-nulo"><input type="checkbox" checked={valor == null} onChange={e => onChange(e.target.checked ? null : (p.defecto ?? p.min ?? 0))} />{p.nulo}</label>}
        {valor != null && <Numero value={typeof valor === 'number' ? valor : null} min={p.min} max={p.max} label={p.nombre}
          onChange={v => v != null && onChange(p.tipo === 'int' ? Math.round(v) : v)} />}
        {valor != null && p.min != null && p.max != null && !p.log && p.max - p.min <= 1000 && (
          <input type="range" className="es-rango" min={p.min} max={Math.min(p.max, p.tipo === 'int' ? p.max : p.max)} step={p.tipo === 'int' ? 1 : (p.max - p.min) / 100}
            value={typeof valor === 'number' ? valor : 0} aria-label={`${p.nombre} (deslizador)`} onChange={e => onChange(p.tipo === 'int' ? Math.round(Number(e.target.value)) : Number(e.target.value))} />
        )}
      </span>
    );
  }
  return <input className="input mono" value={String(valor ?? '')} onChange={e => onChange(e.target.value)} aria-label={p.nombre} />;
}

/** Capas de una red: una cajita por capa con sus neuronas, agregar y sacar */
function Capas({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  const [txt, setTxt] = useState(valor);
  const capas = valor.split(',').map(x => parseInt(x, 10)).filter(x => x > 0);
  const poner = (cs: number[]) => { const v = cs.join(','); setTxt(v); onChange(v); };
  return (
    <span className="es-capas">
      {capas.map((c, i) => (
        <span key={i} className="es-capa">
          <input className="input mono" value={c} inputMode="numeric" aria-label={`Neuronas de la capa ${i + 1}`}
            onChange={e => { const n = parseInt(e.target.value, 10); if (n > 0) poner(capas.map((x, j) => (j === i ? Math.min(4096, n) : x))); }} />
          {capas.length > 1 && <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={`Sacar la capa ${i + 1}`} onClick={() => poner(capas.filter((_, j) => j !== i))}>×</button>}
        </span>
      ))}
      {capas.length < 5 && <button type="button" className="btn btn-sm" onClick={() => poner([...capas, capas[capas.length - 1] ? Math.max(2, Math.round(capas[capas.length - 1] / 2)) : 16])}>+ capa</button>}
      <span className="mono muted" title="Así queda el parámetro">({txt || valor})</span>
    </span>
  );
}
