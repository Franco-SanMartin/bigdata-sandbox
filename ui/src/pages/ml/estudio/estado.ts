/* Estado del estudio de ML: la receta en borrador, el paso en el que estás y lo último que corrió.
   La receta es la misma que entiende sandbox_ml (ml/sandbox_ml/receta.py): el servidor la completa y la
   valida (POST /api/ml/check) y genera el código con ella (POST /api/ml/code). Se guarda en el navegador
   para que no se pierda al recargar. */
import { useSyncExternalStore } from 'react';
import type { MlCatalogo, MlModelo, MlParam, MlPerfil, MlReceta, MlRol, MlTarea, MlValor } from '../../../api/types';

export const PASOS = ['datos', 'objetivo', 'preproceso', 'modelo', 'validacion', 'entrenar', 'resultados', 'codigo'] as const;
export type Paso = typeof PASOS[number];
export const PASO_LABEL: Record<Paso, string> = {
  datos: 'Datos', objetivo: 'Objetivo y variables', preproceso: 'Preprocesamiento', modelo: 'Modelo e hiperparámetros',
  validacion: 'Validación y búsqueda', entrenar: 'Entrenar', resultados: 'Resultados', codigo: 'Código',
};

export interface EstudioEstado {
  paso: Paso;
  receta: MlReceta;
  /** La última corrida lanzada desde el estudio (para seguirla) y su experimento */
  corrida: string | null;
  experimento: string | null;
  /** Código editado a mano (null = el generado de la receta) */
  codigo: string | null;
}

const CLAVE = 'bds.ml.estudio.v1';

export const RECETA_INICIAL: MlReceta = {
  datos: { origen: 'local', ruta: '/datos/clientes_senal.csv' },
  tarea: 'clasificacion',
  objetivo: 'vuelve',
  columnas: {},
  preproceso: {},
  validacion: {},
  modelo: { id: 'bosque_clf', params: {} },
  busqueda: { tipo: 'ninguna' },
  informe: {},
};

function cargar(): EstudioEstado {
  const base: EstudioEstado = { paso: 'datos', receta: RECETA_INICIAL, corrida: null, experimento: null, codigo: null };
  try {
    const raw = localStorage.getItem(CLAVE);
    if (!raw) return base;
    const v = JSON.parse(raw) as Partial<EstudioEstado>;
    return { ...base, ...v, paso: PASOS.includes(v.paso as Paso) ? v.paso as Paso : 'datos' };
  } catch { return base; }
}

let estado = cargar();
const subs = new Set<() => void>();

export function getEstudio(): EstudioEstado { return estado; }

export function setEstudio(f: (e: EstudioEstado) => EstudioEstado) {
  estado = f(estado);
  try { localStorage.setItem(CLAVE, JSON.stringify(estado)); } catch { /* modo privado: sin guardar */ }
  subs.forEach(s => s());
}

export const useEstudio = () => useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, () => estado);

export const irA = (paso: Paso) => setEstudio(e => ({ ...e, paso }));

/** Cambia la receta (y descarta el código editado: ya no es el de esta receta) */
export function editar(f: (r: MlReceta) => MlReceta) {
  setEstudio(e => ({ ...e, receta: f(e.receta), codigo: null }));
}

/* ---------- helpers de la receta ---------- */

export function modeloDe(cat: MlCatalogo | undefined, id: string): MlModelo | undefined {
  return cat?.modelos.find(m => m.id === id);
}

/** El modelo recomendado para empezar en cada tarea y motor */
export const MODELO_INICIAL: Record<'sklearn' | 'spark', Record<MlTarea, string>> = {
  sklearn: { regresion: 'hgb_reg', clasificacion: 'bosque_clf', clustering: 'kmeans', reduccion: 'pca' },
  spark: { regresion: 'bosque_reg_spark', clasificacion: 'bosque_clf_spark', clustering: 'kmeans_spark', reduccion: 'pca_spark' },
};

export function iguales(a: MlValor | undefined, b: MlValor | undefined): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  return a === b;
}

/** Si un parámetro se usa con los valores de los otros (campo 'si' del catálogo) */
export function activo(p: MlParam, valores: Record<string, MlValor>): boolean {
  return Object.entries(p.si ?? {}).every(([otro, vals]) => {
    const v = valores[otro];
    return vals === 'no_nulo' ? v != null : vals.some(x => iguales(x, v));
  });
}

/** Los valores efectivos: los defaults del catálogo pisados por los de la receta */
export function valoresDe(m: MlModelo, params: Record<string, MlValor>): Record<string, MlValor> {
  const out: Record<string, MlValor> = {};
  for (const p of m.params) out[p.nombre] = p.nombre in params ? params[p.nombre] : p.defecto;
  return out;
}

export function textoValor(p: MlParam | undefined, v: MlValor | undefined): string {
  if (v === undefined) return '—';
  if (v === null) return p?.nulo ?? 'None';
  const o = p?.opciones?.find(x => iguales(x.valor, v));
  if (o) return o.etiqueta;
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  return String(v);
}

/** Roles sugeridos por el perfil, con el objetivo afuera */
export function rolesSugeridos(perfil: MlPerfil, objetivo: string | null): Record<string, MlRol> {
  const out: Record<string, MlRol> = {};
  for (const c of perfil.columnas) out[c.nombre] = c.nombre === objetivo ? 'ignorar' : c.rol;
  return out;
}

/** Al elegir otros datos: roles del perfil y un objetivo razonable (la última columna con pocas clases, o la última numérica) */
export function recetaParaDatos(r: MlReceta, perfil: MlPerfil): MlReceta {
  const nombres = perfil.columnas.map(c => c.nombre);
  const objetivo = r.objetivo && nombres.includes(r.objetivo) ? r.objetivo : null;
  return { ...r, objetivo, referencia: r.referencia && nombres.includes(r.referencia) ? r.referencia : null,
           columnas: rolesSugeridos(perfil, objetivo),
           validacion: { ...r.validacion, columna_tiempo: null } };
}

export const ROL_LABEL: Record<MlRol, string> = {
  numerica: 'numérica', categorica: 'categórica', fecha: 'fecha', texto: 'texto', id: 'id', ignorar: 'ignorar',
};

/** Formato de una métrica: porcentajes con 1 decimal salvo los errores, que van en la unidad del objetivo */
export function fmtMetrica(v: number | null | undefined, digits = 4): string {
  if (v == null || Number.isNaN(v)) return '—';
  if (Math.abs(v) >= 1000) return v.toLocaleString('es-AR', { maximumFractionDigits: 0 });
  if (Math.abs(v) >= 100) return v.toLocaleString('es-AR', { maximumFractionDigits: 1 });
  return v.toLocaleString('es-AR', { minimumFractionDigits: Math.min(digits, 3), maximumFractionDigits: digits });
}

export const fmtSeg = (s?: number | null) => (s == null ? '—' : s < 1 ? `${Math.round(s * 1000)} ms` : s < 120 ? `${s.toFixed(1).replace('.', ',')} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);
export const fmtBytes = (b?: number | null) => (b == null ? '—' : b < 1024 ? `${b} B` : b < 1024 ** 2 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 ** 2).toFixed(1).replace('.', ',')} MB`);
export const fmtMb = (mb?: number | null) => (mb == null ? '—' : mb >= 1024 ? `${(mb / 1024).toFixed(1).replace('.', ',')} GB` : `${Math.round(mb)} MB`);
