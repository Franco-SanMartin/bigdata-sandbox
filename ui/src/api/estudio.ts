/* Estudio de ML: los tipos de /api/ml/catalog, sources, profile, check, code, experiments y runs
   (server/sandbox_server/ml_estudio.py). Los nombres de los campos son los de sandbox_ml (ml/sandbox_ml),
   en castellano, tal cual: la receta que arma la pantalla es la misma que lee el código generado. */

export type MlTarea = 'regresion' | 'clasificacion' | 'clustering' | 'reduccion';
export type MlRol = 'numerica' | 'categorica' | 'fecha' | 'texto' | 'id' | 'ignorar';
export type MlMotor = 'sklearn' | 'spark';
export type MlValor = string | number | boolean | null;

/* ---------- Catálogo (sandbox_ml/catalogo.py) ---------- */

export interface MlParam {
  nombre: string;
  tipo: 'int' | 'float' | 'choice' | 'bool' | 'layers' | 'str';
  defecto: MlValor;
  min?: number;
  max?: number;
  /** Conviene recorrerlo en escala logarítmica */
  log?: boolean;
  /** Acepta None: cómo se llama ese valor (sin límite, apagado…) */
  nulo?: string;
  opciones?: { valor: MlValor; etiqueta: string }[];
  ayuda: { que: string; efecto: string; rango: string };
  grupo?: string;
  /** Solo se usa si otro parámetro vale alguno de estos valores ('no_nulo': si no es None) */
  si?: Record<string, MlValor[] | 'no_nulo'>;
  /** Valores sugeridos para una búsqueda en grilla */
  buscar?: MlValor[];
}

export interface MlModelo {
  id: string;
  motor: MlMotor;
  tarea: MlTarea;
  /** La clase de la librería (sklearn.ensemble.RandomForestClassifier…) */
  clase: string;
  etiqueta: string;
  familia: string;
  que: string;
  params: MlParam[];
  escala?: boolean;
  importancia?: 'coef' | 'arbol' | 'permutacion' | null;
  costo?: string;
  semilla?: string;
  proba?: boolean;
  binaria?: boolean;
  nulos?: boolean;
  paralelo?: boolean;
  perdida?: boolean;
  centros?: boolean;
  predice?: boolean;
  max_filas?: number;
  extra?: string;
}

export interface MlMetrica {
  tarea: MlTarea;
  etiqueta: string;
  sklearn: string | null;
  spark: string | null;
  mayor_mejor: boolean;
  ayuda: string;
  binaria?: boolean;
  spark_binaria?: boolean;
  proba?: boolean;
  referencia?: boolean;
}

export interface MlOpcion { valor: string; etiqueta: string; ayuda: string }

export interface MlPreproceso {
  imputar_num: 'mediana' | 'media' | 'cero' | 'ninguna';
  indicador_nulos: boolean;
  imputar_cat: 'mas_frecuente' | 'constante';
  escalar: 'estandar' | 'minmax' | 'robusto' | 'ninguno';
  outliers: 'ninguno' | 'recortar_iqr' | 'recortar_pct' | 'eliminar_iqr';
  factor_iqr: number;
  codificar: 'onehot' | 'ordinal';
  max_categorias: number;
  fecha: boolean;
  texto_max: number;
  seleccion: 'ninguna' | 'varianza' | 'kbest' | 'modelo';
  k: number;
  umbral_varianza: number;
  pca: number | null;
}

export interface MlValidacion {
  particion: 'aleatoria' | 'estratificada' | 'temporal';
  prueba: number;
  validacion: number;
  columna_tiempo: string | null;
  cv: 'ninguna' | 'kfold' | 'estratificada' | 'repetida' | 'temporal';
  k: number;
  repeticiones: number;
  semilla: number;
  metrica: string;
}

export type MlRango = { min: number; max: number; log?: boolean };

export interface MlBusqueda {
  tipo: 'ninguna' | 'grid' | 'random' | 'halving' | 'halving_random' | 'cv' | 'tvs';
  espacio: Record<string, MlValor[] | MlRango>;
  iteraciones: number;
  factor: number;
  max_minutos: number;
  n_jobs: number;
  /** Los calcula el servidor al revisar */
  candidatos?: number;
  ajustes?: number;
}

export interface MlInformeOpciones {
  curva_aprendizaje: boolean;
  curva_validacion: { param: string; valores: MlValor[] } | null;
  permutacion: boolean;
}

export interface MlCatalogo {
  version: number;
  tareas: Record<MlTarea, { etiqueta: string; que: string }>;
  roles: Record<MlRol, string>;
  modelos: MlModelo[];
  /** Modelo de Spark que equivale a cada uno de scikit-learn */
  equivalente: Record<string, string>;
  metricas: Record<string, MlMetrica>;
  metricaDefecto: Record<MlMotor, Record<MlTarea, string>>;
  preproceso: Record<string, { etiqueta: string; ayuda?: string; opciones?: MlOpcion[] }>;
  preprocesoDefecto: MlPreproceso;
  particiones: Record<string, { etiqueta: string; ayuda: string }>;
  cv: Record<string, { etiqueta: string; ayuda: string }>;
  busquedas: Record<MlMotor, Record<string, { etiqueta: string; ayuda: string }>>;
  limites: { max_ajustes: number; max_combinaciones: number; max_minutos: number; min_minutos: number; max_n_jobs: number };
  /** Los formatos que lee el estudio (sandbox_ml/fuentes.py) */
  formatos: Record<MlFormato, { etiqueta: string; ayuda: string }>;
  /** Los tipos de Spark que se pueden poner en el esquema editado */
  tiposEsquema: string[];
  /** Los pasos de la receta de limpieza (sandbox_ml/limpieza.py) */
  limpieza: {
    pasos: Record<MlPasoTipo, { etiqueta: string; fase: MlFase; ayuda: string }>;
    opciones: Record<string, { valor: string; etiqueta: string }[]>;
    factor: Record<'iqr' | 'percentiles' | 'zscore', { min: number; max: number; defecto: number }>;
  };
}

/* ---------- Datos y perfil ---------- */

export type MlFormato = 'parquet' | 'orc' | 'avro' | 'json' | 'csv' | 'texto';

export interface MlDatos {
  origen: 'local' | 'hdfs' | 'hive';
  ruta?: string;
  tabla?: string;
  formato?: MlFormato;
  /** CSV: el separador (coma, punto y coma, tabulación o barra), si la primera fila es el encabezado y si se infieren los tipos */
  separador?: string;
  encabezado?: boolean;
  inferir?: boolean;
  /** JSON: un documento entero (o un array) en vez de un objeto por línea */
  multilinea?: boolean;
  /** Lo detecta el servidor por la extensión (gzip, bz2, snappy): Hadoop lo descomprime solo */
  compresion?: string | null;
  /** Tipos editados: {columna: tipo de Spark} (se aplican con un cast al leer) */
  esquema?: Record<string, string>;
  /** Condición de Spark SQL sobre las columnas de partición (anio = 2024): Spark ni abre las demás carpetas */
  filtro_particiones?: string | null;
  limite?: number | null;
}

export interface MlParticiones { columnas: string[]; n: number; ejemplos: string[] }

export interface MlFuente extends MlDatos {
  nombre: string;
  bytes?: number;
  filas?: number | null;
  columnas?: string[];
  partes?: number;
  particiones?: MlParticiones;
}

export interface MlFuentes { local: MlFuente[]; hdfs: MlFuente[]; hive: MlFuente[]; avisos: string[] }

export interface MlColumnaPerfil {
  nombre: string;
  tipo: 'int' | 'float' | 'bool' | 'str' | 'fecha';
  dtype: string;
  nulos: number;
  nulos_pct: number;
  unicos: number;
  unicos_pct: number;
  /** El rol que sugiere el perfil y por qué */
  rol: MlRol;
  por_que: string;
  ejemplos: MlValor[];
  num?: { min: number; max: number; media: number; desvio: number; p25: number; p50: number; p75: number; ceros: number; extremos: number;
    /** Solo en el perfil con Spark (cuantiles aproximados) */
    p01?: number; p05?: number; p95?: number; p99?: number };
  /** Con Spark los distintos son aproximados (HyperLogLog, ±2 %) */
  unicos_aprox?: boolean;
  histograma?: { bordes: number[]; cuentas: number[] };
  top?: { valor: string; n: number }[];
  fecha?: { min: string; max: string };
  largo_medio?: number;
  /** Qué tan bien predice al objetivo esta columna sola (0 a 1): para avisar de fugas */
  asociacion?: { valor: number; metodo: string };
  correlacion?: number;
  /** Solo en la columna objetivo, si tiene pocas clases */
  balance?: { clase: string; n: number; pct: number }[];
}

export interface MlPerfil {
  datos: MlDatos;
  filas: number;
  recortado: boolean;
  columnas: MlColumnaPerfil[];
  duplicadas: number | null;
  memoria_mb: number | null;
  vista: { columnas: string[]; filas: MlValor[][] };
  objetivo?: { columna: string; tarea: MlTarea; por_que: string };
  segundos: number;
  /** pandas (una máquina, hasta 200.000 filas) o spark (a escala, en YARN) */
  motor?: 'pandas' | 'spark';
  modo?: 'muestra' | 'completo';
  /** Spark: las filas de todos los datos (filas son las perfiladas) */
  filas_total?: number;
  muestra_filas?: number | null;
  fuente?: MlFuenteInfo;
  app_id?: string;
  master?: string;
  /** Lo que el perfil vio distinto de lo elegido (p. ej. el separador del CSV) */
  sugerencias?: { separador?: string };
}

export interface MlFuenteInfo {
  formato?: string | null;
  compresion?: string | null;
  bytes?: number;
  archivos?: number;
  leidos?: number;
  ubicacion?: string;
  tabla?: string;
  particiones?: MlParticiones;
  aviso?: string;
}

export interface MlPerfilOpciones { motor?: 'pandas' | 'spark'; modo?: 'muestra' | 'completo'; filas?: number }

/* ---------- Receta de limpieza (sandbox_ml/limpieza.py) ---------- */

export type MlPasoTipo = 'tipo' | 'texto' | 'regex' | 'fecha' | 'nulos' | 'outliers' | 'raras' | 'mapeo' | 'derivada' | 'duplicados' | 'filtro';
export type MlFase = 'entrenamiento' | 'modelo';

/** Un paso: el tipo y sus opciones (las mismas claves que limpieza.py) */
export interface MlPaso {
  tipo: MlPasoTipo;
  columna?: string;
  activo?: boolean;
  nota?: string;
  // tipo
  a?: string;
  formato?: string;
  // texto
  ops?: string[];
  // regex
  patron?: string;
  reemplazo?: string;
  modo?: 'reemplazar' | 'extraer';
  grupo?: number;
  destino?: string;
  // fecha
  con_hora?: boolean;
  partes?: string[];
  // nulos
  estrategia?: 'mediana' | 'media' | 'moda' | 'constante' | 'eliminar';
  valor?: MlValor;
  indicador?: boolean;
  // outliers
  metodo?: 'iqr' | 'percentiles' | 'zscore';
  factor?: number;
  accion?: 'recortar' | 'nulo' | 'eliminar';
  // raras
  min_pct?: number;
  max_categorias?: number;
  otra?: string;
  // mapeo
  mapa?: Record<string, MlValor>;
  resto?: 'conservar' | 'nulo' | 'valor';
  otro?: MlValor;
  // derivada
  nombre?: string;
  expresion?: string;
  rol?: MlRol;
  // duplicados
  columnas?: string[];
  // filtro
  condicion?: string;
}

export interface MlLimpieza { nombre?: string | null; version?: number | null; pasos: MlPaso[] }

export interface MlPasoVista {
  paso: number;
  tipo: MlPasoTipo;
  titulo: string;
  fase: MlFase;
  ok: boolean;
  error?: { mensaje: string; detalle?: string | null };
  filas_antes?: number;
  filas_despues?: number;
  /** Filas que cambiaron (o que se sacaron, si quita) */
  afectadas?: number;
  quita?: boolean;
  aprendido?: Record<string, MlValor | MlValor[]> | null;
  expresiones?: [string, string][];
  ejemplos?: { columnas: string[]; filas: MlValor[][] };
}

export interface MlVistaLimpieza {
  filas: { leidas: number; entrenamiento: number };
  pasos: MlPasoVista[];
  final: { columnas: string[]; filas: MlValor[][] };
  expresiones: [string, string][];
  muestra: number;
  segundos: number;
  huella: string;
}

export interface MlLimpiezaVersion { version: number; creado: string; huella: string; nota: string | null; limpieza: MlLimpieza }
export interface MlLimpiezaGuardada { nombre: string; versiones: MlLimpiezaVersion[] }
export interface MlLimpiezaFila { nombre: string; versiones: number; version: number; creado: string; pasos: number; huella: string }

/* ---------- Receta (sandbox_ml/receta.py) ---------- */

export interface MlReceta {
  nombre?: string | null;
  datos: MlDatos;
  tarea: MlTarea;
  objetivo: string | null;
  referencia?: string | null;
  columnas: Record<string, MlRol>;
  preproceso: Partial<MlPreproceso>;
  validacion: Partial<MlValidacion>;
  modelo: { id: string; params: Record<string, MlValor> };
  busqueda: Partial<MlBusqueda>;
  informe?: Partial<MlInformeOpciones>;
  /** La receta de limpieza, columna por columna (solo con modelos de Spark) */
  limpieza?: MlLimpieza;
  /** Lo completa el servidor (sale del modelo) */
  motor?: MlMotor;
  version?: number;
}

export interface MlIssue { campo: string; mensaje: string; tipo?: 'aviso' | 'info' | 'fuga' | 'id' | 'desbalance' }

export interface MlRevision {
  /** La receta completa: con los valores por defecto y solo los parámetros que se usan */
  receta: MlReceta & { preproceso: MlPreproceso; validacion: MlValidacion; busqueda: MlBusqueda; informe: MlInformeOpciones; motor: MlMotor };
  errores: MlIssue[];
  avisos: MlIssue[];
  /** Si se validó contra el perfil de los datos (fugas, tipos, clases) */
  conPerfil: boolean;
  huella: string | null;
}

export type MlParteCodigo = 'entrenamiento' | 'perfil' | 'limpieza';
export interface MlCodigo { codigo: string; archivo: string; motor: MlMotor; huella: string; comando: string; parte?: MlParteCodigo }

/* ---------- Corridas ---------- */

export interface MlLinea { n: number; stream: 'out' | 'err'; texto: string }

export interface MlCorrida {
  /** Id de la acción del servidor */
  id: string;
  experimento: string;
  estado: 'corriendo' | 'listo' | 'falló';
  progreso: number;
  mensaje: string;
  motor: MlMotor;
  titulo: string;
  origen: string;
  inicio: number;
  fin?: number;
  /** Entrenamientos de la búsqueda (líneas [CV] END de scikit-learn) */
  ajustes: { hechos: number; total: number; particiones?: number; candidatos?: number; ultimo?: number } | null;
  limites: { minutos: number; memoriaMb: number };
  memoriaMb: number | null;
  memoriaPicoMb?: number;
  appId?: string;
  error?: string;
  /** GET /api/ml/runs/{id}?desde=N: las líneas desde la N y cuántas salieron en total */
  lineas?: MlLinea[];
  total?: number;
  comando?: string;
}

export interface MlCorrerCodigo { codigo: string; motor: MlMotor; receta?: MlReceta | null; minutos?: number; memoriaMb?: number }

/* ---------- Experimentos ---------- */

export interface MlMetricaValores { prueba?: number | null; cv?: number | null; cv_desvio?: number | null; entrenamiento?: number | null; validacion?: number | null; cv_particiones?: number[]; cv_entrenamiento?: number }

export interface MlExperimentoFila {
  id: string;
  nombre: string | null;
  creado: string;
  terminado?: string;
  estado: 'corriendo' | 'listo' | 'falló' | 'sin informe';
  origen: string;
  editado: boolean;
  motor: MlMotor;
  tarea: MlTarea | null;
  modelo: string | null;
  modeloEtiqueta: string | null;
  params: Record<string, MlValor> | null;
  metrica: string | null;
  /** La métrica principal: el promedio de la validación cruzada, o la de prueba si no hubo CV */
  valor: number | null;
  desvio: number | null;
  prueba: number | null;
  cv: number | null;
  metricas: Record<string, MlMetricaValores>;
  segundos: number | null;
  memoriaMb: number | null;
  memoriaYarnMb: number | null;
  modeloBytes: number | null;
  fuente: string | null;
  filas: number | null;
  hashDatos: string | null;
  huella: string | null;
  objetivo: string | null;
  busqueda: string | null;
  appId: string | null;
  error: string | null;
}

export interface MlCurva { x: number[]; y: number[]; umbral?: number[] }

export interface MlInforme {
  tarea: MlTarea;
  // clasificación
  clases?: string[];
  confusion?: number[][];
  reporte?: { clase: string; precision: number; recall: number; f1: number; soporte: number }[];
  reporte_promedios?: Record<string, { precision: number; recall: number; f1: number }>;
  roc?: (MlCurva & { clase: string; auc: number })[];
  pr?: (MlCurva & { clase: string; ap: number })[];
  positiva?: string;
  umbrales?: { umbral: number; vp: number; fp: number; fn: number; vn: number }[];
  calibracion?: { predicha: number[]; real: number[]; histograma: number[] };
  // regresión
  real?: number[];
  predicho?: number[];
  residuo?: number[];
  histograma_residuos?: { bordes: number[]; cuentas: number[] };
  // clustering y reducción
  tamanos?: { grupo: number; filas: number }[];
  proyeccion?: { x: number[]; y: number[]; grupo?: number[]; referencia?: string[]; varianza?: number[]; centros?: { x: number[]; y: number[] } };
  contra_referencia?: { grupos: number[]; referencia: string[]; cuentas: number[][] };
  silhouette_por_grupo?: { grupo: number; media: number; valores: number[] }[];
  varianza?: number[];
  cargas?: { columnas: string[]; valores: number[][] };
  // todas
  curva_aprendizaje?: { filas: number[]; entrenamiento: number[][]; validacion: number[][] };
  curva_validacion?: { param: string; valores: string[]; entrenamiento?: number[][]; validacion?: number[][]; silhouette?: (number | null)[]; inercia?: (number | null)[] };
  permutacion?: { columnas: string[]; media: number[]; desvio: number[] };
  importancia?: { tipo: 'impureza' | 'coeficientes'; columnas: string[]; valores: number[]; signo?: number[] };
  perdida?: { perdida: number[]; validacion: number[]; iteraciones: number; es_puntaje?: boolean };
  cv_tiempos?: { entrenar: number[]; medir: number[] };
  ejemplos?: { columnas: string[]; filas: MlValor[][] };
}

export interface MlExperimento {
  id: string;
  nombre: string | null;
  creado: string;
  terminado?: string;
  estado: MlExperimentoFila['estado'];
  origen: string;
  editado: boolean;
  receta: MlRevision['receta'] | null;
  huella: string | null;
  motor: MlMotor;
  tarea: MlTarea | null;
  objetivo?: string | null;
  variables?: Record<'numerica' | 'categorica' | 'fecha' | 'texto', string[]>;
  metrica: string | null;
  modelo: { id: string; etiqueta: string; clase: string; params: Record<string, MlValor> } | null;
  datos: (MlDatos & { filas?: number; columnas?: number; hash?: string }) | null;
  filas?: { entrenamiento: number; prueba: number; validacion?: number } | null;
  metricas: Record<string, MlMetricaValores>;
  busqueda?: {
    tipo: string; candidatos: number; mejores_params: Record<string, MlValor>; mejor_puntaje: number;
    resultados: { params: Record<string, MlValor>; media: number | null; desvio: number | null; rango: number; tiempo?: number | null }[];
    rondas?: number; recursos?: number[]; candidatos_por_ronda?: number[];
  } | null;
  tiempos?: Record<string, number>;
  memoria_pico_mb?: number | null;
  modelo_bytes?: number | null;
  modelo_hdfs?: string;
  yarn?: { app_id?: string; memoria_mb?: number };
  artefactos?: string[];
  entorno?: Record<string, string | number>;
  clases?: string[] | null;
  error?: string;
  informe: MlInforme | null;
  /** Id de la corrida si todavía está corriendo */
  corriendo: string | null;
}

export interface MlPrediccion { filas: number; columnas: string[]; muestra: MlValor[][]; archivo?: string }
