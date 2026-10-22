/* Valores por defecto de Machine Learning: los usan la pantalla y el modo demo, y son los mismos del backend
   (server/sandbox_server/ml.py). */

/** Hiperparámetros de modelos_sklearn.py */
export const DEFAULT_PARAMS: Record<string, Record<string, number | string>> = {
  lineal: {}, tonto: { strategy: 'most_frequent' }, arbol: { max_depth: 3 }, logistica: { C: 1 },
  mlp: { hidden_layer_sizes: '16,8', max_iter: 500 }, kmeans: { n_clusters: 3, n_init: 10 },
};

/** Columnas de entrada de clustering por defecto: con estas dos generar_senal.py arma los segmentos; las demás los mezclan */
export const CLUSTER_FEATURES = ['visitas_mes', 'ticket_promedio'];
