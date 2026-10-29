/* Paso 3, Preprocesamiento: lo que va adentro del Pipeline antes del modelo, una rama por tipo de columna
   (ColumnTransformer en scikit-learn, etapas del Pipeline en Spark ML), y después la selección de
   variables y el PCA. Todo aprende solo con el entrenamiento: así no hay fuga hacia la prueba. */
import type { MlCatalogo, MlPreproceso, MlRevision } from '../../../api/types';
import { Panel } from '../../../components/base';
import { Switch } from '../../../components/ui';
import { Avisos, Campo, Numero, Opciones } from './comun';
import { editar, modeloDe, useEstudio } from './estado';

export function PasoPreproceso({ cat, rev }: { cat: MlCatalogo; rev: MlRevision | null }) {
  const { receta } = useEstudio();
  const pre: MlPreproceso = { ...cat.preprocesoDefecto, ...(rev?.receta.preproceso ?? {}), ...receta.preproceso };
  const set = <K extends keyof MlPreproceso>(k: K, v: MlPreproceso[K]) => editar(r => ({ ...r, preproceso: { ...r.preproceso, [k]: v } }));
  const roles = Object.entries(receta.columnas).filter(([c]) => c !== receta.objetivo);
  const n = (rol: string) => roles.filter(([, r]) => r === rol).length;
  const ops = (k: string) => (cat.preproceso[k]?.opciones ?? []).map(o => ({ valor: o.valor, etiqueta: o.etiqueta, ayuda: o.ayuda }));
  const modelo = modeloDe(cat, receta.modelo.id);
  const sup = receta.tarea === 'regresion' || receta.tarea === 'clasificacion';
  const spark = modelo?.motor === 'spark';

  return (
    <div className="es-paso es-pre">
      <Diagrama pre={pre} n={n} modelo={modelo?.etiqueta ?? receta.modelo.id} spark={spark} />
      <div className="es-pre-grid">
        <Panel title="Numéricas" sub={`${n('numerica')} columnas`}>
          <div className="es-form">
            <Campo label="Valores vacíos" nombre="SimpleImputer" ayuda={cat.preproceso.imputar_num.etiqueta}>
              <Opciones value={pre.imputar_num} onChange={v => set('imputar_num', v)} opciones={ops('imputar_num')} label="Imputación de numéricas" />
            </Campo>
            {!spark && (
              <Campo label="Marcar los vacíos" nombre="add_indicator" ayuda={cat.preproceso.indicador_nulos.ayuda}>
                <Switch checked={pre.indicador_nulos} onChange={v => set('indicador_nulos', v)} label="Agregar indicador de vacíos" />
              </Campo>
            )}
            <Campo label="Valores extremos" ayuda="Los outliers tiran de la media y de los coeficientes de los modelos lineales; a los árboles casi no les importan.">
              <Opciones value={pre.outliers} onChange={v => set('outliers', v)} opciones={ops('outliers')} label="Valores extremos" />
            </Campo>
            {(pre.outliers === 'recortar_iqr' || pre.outliers === 'eliminar_iqr') && (
              <Campo label="Factor k del IQR" nombre="factor" ayuda="1,5 es la regla de Tukey (la de los diagramas de caja); 3 solo toca los extremos muy lejanos.">
                <Numero value={pre.factor_iqr} onChange={v => v != null && set('factor_iqr', v)} min={0.5} max={10} label="Factor del IQR" />
              </Campo>
            )}
            <Campo label="Escalado" ayuda={modelo?.escala ? `${modelo.etiqueta} mide distancias o usa gradientes: necesita columnas escaladas.` : 'A los árboles y sus ensambles no les cambia nada.'}>
              <Opciones value={pre.escalar} onChange={v => set('escalar', v)} opciones={ops('escalar')} label="Escalado" />
            </Campo>
          </div>
        </Panel>

        <Panel title="Categóricas" sub={`${n('categorica')} columnas`}>
          <div className="es-form">
            {!spark && (
              <Campo label="Valores vacíos" nombre="SimpleImputer">
                <Opciones value={pre.imputar_cat} onChange={v => set('imputar_cat', v)} opciones={ops('imputar_cat')} label="Imputación de categóricas" />
              </Campo>
            )}
            <Campo label="Codificación" ayuda="Los modelos solo entienden números: cada categoría tiene que pasar a una o más columnas numéricas.">
              <Opciones value={pre.codificar} onChange={v => set('codificar', v)} opciones={ops('codificar')} label="Codificación" />
            </Campo>
            {pre.codificar === 'onehot' && !spark && (
              <Campo label="Categorías por columna" nombre="max_categories" ayuda="Las menos frecuentes se juntan en una sola ('infrequent'): evita miles de columnas con algo como un código postal.">
                <Numero value={pre.max_categorias} onChange={v => v != null && set('max_categorias', Math.round(v))} min={2} max={1000} label="Máximo de categorías" />
              </Campo>
            )}
          </div>
        </Panel>

        <Panel title="Fechas y texto" sub={`${n('fecha')} fechas · ${n('texto')} de texto`}>
          <div className="es-form">
            <Campo label="Separar las fechas" nombre="PartesDeFecha" ayuda={cat.preproceso.fecha.ayuda}>
              <Switch checked={pre.fecha} onChange={v => set('fecha', v)} label="Separar las fechas en partes" />
            </Campo>
            <Campo label="Palabras del TF-IDF" nombre="max_features" ayuda={cat.preproceso.texto.ayuda}>
              <Numero value={pre.texto_max} onChange={v => v != null && set('texto_max', Math.round(v))} min={10} max={20000} label="Palabras del TF-IDF" />
            </Campo>
          </div>
        </Panel>

        <Panel title="Selección de variables y PCA">
          <div className="es-form">
            <Campo label="Selección" ayuda="Menos columnas = modelo más rápido y a veces mejor (menos ruido). Va después del preprocesamiento.">
              <Opciones value={pre.seleccion} onChange={v => set('seleccion', v)} label="Selección de variables"
                opciones={ops('seleccion').map(o => ({ ...o, deshabilitada: (o.valor === 'kbest' || o.valor === 'modelo') && !sup ? 'Necesita un objetivo' : o.valor === 'modelo' && spark ? 'En Spark: por varianza o las k mejores' : undefined }))} />
            </Campo>
            {pre.seleccion === 'kbest' && (
              <Campo label="Cuántas" nombre="k"><Numero value={pre.k} onChange={v => v != null && set('k', Math.round(v))} min={1} max={10000} label="Cuántas variables" /></Campo>
            )}
            {pre.seleccion === 'varianza' && (
              <Campo label="Varianza mínima" nombre="threshold" ayuda="Con columnas escaladas (varianza 1) casi no saca nada: sirve sobre todo para columnas casi constantes.">
                <Numero value={pre.umbral_varianza} onChange={v => v != null && set('umbral_varianza', v)} min={0} label="Varianza mínima" />
              </Campo>
            )}
            {receta.tarea !== 'reduccion' && (
              <Campo label="PCA antes del modelo" nombre="n_components" ayuda={cat.preproceso.pca.ayuda} nota={pre.pca ? `${pre.pca} componentes` : 'apagado'}>
                <div className="es-fila">
                  <Switch checked={pre.pca != null} onChange={v => set('pca', v ? 2 : null)} label="Usar PCA" />
                  {pre.pca != null && <Numero value={pre.pca} onChange={v => v != null && set('pca', Math.round(v))} min={1} max={500} label="Componentes del PCA" ancho={80} />}
                </div>
              </Campo>
            )}
          </div>
        </Panel>
      </div>
      <Avisos rev={rev} prefijos={['preproceso']} />
    </div>
  );
}

function Diagrama({ pre, n, modelo, spark }: { pre: MlPreproceso; n: (rol: string) => number; modelo: string; spark: boolean }) {
  const pasoNum = [pre.imputar_num !== 'ninguna' && (spark ? 'Imputer' : 'SimpleImputer'), pre.outliers.startsWith('recortar') && (spark ? 'recorte (SQL)' : 'RecortarExtremos'),
    pre.escalar !== 'ninguno' && ({ estandar: 'StandardScaler', minmax: 'MinMaxScaler', robusto: 'RobustScaler' } as Record<string, string>)[pre.escalar]].filter(Boolean) as string[];
  const ramas = [
    n('numerica') > 0 && { t: `numéricas · ${n('numerica')}`, pasos: pasoNum },
    n('categorica') > 0 && { t: `categóricas · ${n('categorica')}`, pasos: spark ? ['StringIndexer', pre.codificar === 'onehot' ? 'OneHotEncoder' : ''].filter(Boolean) : ['SimpleImputer', pre.codificar === 'onehot' ? 'OneHotEncoder' : 'OrdinalEncoder'] },
    n('fecha') > 0 && pre.fecha && { t: `fechas · ${n('fecha')}`, pasos: [spark ? 'year, month… (SQL)' : 'PartesDeFecha', 'SimpleImputer'] },
    n('texto') > 0 && { t: `texto · ${n('texto')}`, pasos: spark ? ['Tokenizer', 'HashingTF', 'IDF'] : ['TfidfVectorizer'] },
  ].filter(Boolean) as { t: string; pasos: string[] }[];
  const despues = [pre.seleccion !== 'ninguna' && ({ varianza: 'VarianceThreshold', kbest: spark ? 'UnivariateFeatureSelector' : 'SelectKBest', modelo: 'SelectFromModel' } as Record<string, string>)[pre.seleccion],
    pre.pca != null && `PCA(${pre.pca})`].filter(Boolean) as string[];
  return (
    <figure className="es-diag" aria-label="Diagrama del Pipeline">
      <div className="es-diag-ramas">
        <span className="es-diag-t mono">{spark ? 'Pipeline (Spark ML)' : 'ColumnTransformer'}</span>
        {ramas.map(r => (
          <div key={r.t} className="es-diag-rama"><b>{r.t}</b>{r.pasos.map(p => <span key={p} className="mono">{p}</span>)}{!r.pasos.length && <span className="muted">tal cual</span>}</div>
        ))}
        {!ramas.length && <span className="muted">Ninguna columna marcada como variable</span>}
      </div>
      <span className="es-diag-flecha" aria-hidden="true">→</span>
      {spark && <><span className="es-diag-caja mono">VectorAssembler</span><span className="es-diag-flecha" aria-hidden="true">→</span></>}
      {despues.map(d => <span key={d} className="es-diag-caja mono">{d}</span>)}
      {despues.length > 0 && <span className="es-diag-flecha" aria-hidden="true">→</span>}
      <span className="es-diag-caja es-diag-modelo">{modelo}</span>
    </figure>
  );
}
