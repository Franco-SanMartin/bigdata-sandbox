/* Estudio de ML en el modo demo (sin contenedor). No hay Python acá: los experimentos, su código y los perfiles
   son los que dejaron corridas de verdad (ui/scripts/estudio_demo.py contra una full). Al "entrenar", la demo
   simula el avance y guarda una copia del experimento real más parecido (mismo modelo, si no misma tarea),
   marcada como tal. La revisión de la receta es una versión chica de la del servidor.
   Lo de HDFS (formatos, perfiles con Spark, la vista previa de la limpieza y su código) sale de ml/datos.json:
   corridas reales sobre ventas_sucias y clientes_senal en HDFS (estudio_demo.py --datos). */
import type {
  ApiEvent, MlBusqueda, MlCatalogo, MlCodigo, MlCorrida, MlDatos, MlExperimento, MlExperimentoFila, MlFuente, MlFuentes, MlIssue,
  MlLimpieza, MlLimpiezaFila, MlLimpiezaGuardada, MlLinea, MlPaso, MlParteCodigo, MlPasoVista, MlPerfil, MlPerfilOpciones, MlReceta,
  MlRevision, MlValor, MlVistaLimpieza,
} from '../types';
import { fail } from '../errors';
import type { DemoEngine } from './engine';

interface Fixture { fila: MlExperimentoFila; experimento: MlExperimento; codigo: string }
interface DatosHdfs {
  hdfs: MlFuente[];
  perfiles: Record<string, MlPerfil>;
  limpieza: { datos: MlDatos; receta: MlLimpieza; vista: MlVistaLimpieza };
  codigo: Record<'perfil' | 'limpieza', MlCodigo>;
}

let fixtures: Promise<{ exps: Fixture[]; perfiles: Record<string, MlPerfil>; cat: MlCatalogo; hdfs: DatosHdfs }> | null = null;
const cargar = () => (fixtures ??= Promise.all([import('./ml/experimentos.json'), import('./ml/perfiles.json'), import('./ml/catalogo.json'), import('./ml/datos.json')])
  .then(([e, p, c, d]) => ({ exps: e.default as unknown as Fixture[], perfiles: p.default as unknown as Record<string, MlPerfil>,
    cat: c.default as unknown as MlCatalogo, hdfs: d.default as unknown as DatosHdfs })));
/** Un paso en texto, con las claves ordenadas (para reconocer los de la receta de ejemplo) */
const firma = (p: MlPaso) => JSON.stringify(Object.keys(p).filter(k => k !== 'activo' && k !== 'nota').sort().map(k => [k, p[k as keyof MlPaso]]));

const SENAL = '/datos/clientes_senal.csv';
const clon = <T>(v: T): T => structuredClone(v);

export class DemoEstudio {
  private exps: Fixture[] | null = null;
  private limpiezas: MlLimpiezaGuardada[] | null = null;
  private corridas = new Map<string, MlCorrida & { lineasTodas: MlLinea[] }>();
  private seq = 0;
  constructor(private e: DemoEngine) {}

  private async base() {
    const f = await cargar();
    if (!this.exps) this.exps = clon(f.exps);
    return { ...f, exps: this.exps };
  }

  async catalog(): Promise<MlCatalogo> { return clon((await this.base()).cat); }

  async sources(): Promise<MlFuentes> {
    return {
      local: [{ origen: 'local', ruta: SENAL, nombre: 'clientes_senal.csv', formato: 'csv', bytes: 681463 }],
      hdfs: clon((await this.base()).hdfs.hdfs),
      hive: [],
      avisos: ['Modo demo: clientes_senal.csv en /datos y ventas_sucias en HDFS (los perfiles y resultados son de corridas reales)'],
    };
  }

  async example(): Promise<MlDatos> { return { origen: 'local', ruta: SENAL, formato: 'csv' }; }

  async profile(datos: MlDatos, objetivo?: string | null, op?: MlPerfilOpciones): Promise<MlPerfil> {
    const { perfiles, hdfs } = await this.base();
    if (datos.origen === 'hdfs') {
      const p = hdfs.perfiles[datos.ruta ?? ''];
      if (!p) fail('not_found', 'En el modo demo están perfilados con Spark los datos de HDFS de la lista: con el contenedor, cualquier ruta');
      if (op?.motor === 'pandas') fail('invalid', `Con pandas no: ${datos.formato === 'csv' ? 'perfilalo con Spark (en la demo está precalculado con Spark)' : `${datos.formato} se lee con Spark`}`);
      return { ...clon(p), datos };
    }
    if (op?.motor === 'spark') fail('unsupported', 'En el modo demo el perfil con Spark está precalculado para los datos de HDFS: elegí una fuente de HDFS (o «auto» para este CSV)');
    if (!(datos.ruta ?? '').endsWith('clientes_senal.csv')) fail('not_found', 'En el modo demo solo está clientes_senal.csv: con el contenedor, cualquier CSV, Parquet o tabla de Hive');
    const p = perfiles[objetivo ?? ''] ?? perfiles[''];
    return { ...clon(p), datos };
  }

  async check(receta: MlReceta): Promise<MlRevision> {
    const { cat } = await this.base();
    const errores: MlIssue[] = [], avisos: MlIssue[] = [];
    const m = cat.modelos.find(x => x.id === receta.modelo.id);
    if (!m) { errores.push({ campo: 'modelo.id', mensaje: `no existe el modelo ${receta.modelo.id}` }); }
    const sup = receta.tarea === 'regresion' || receta.tarea === 'clasificacion';
    if (sup && !receta.objetivo) errores.push({ campo: 'objetivo', mensaje: 'elegí la columna que querés predecir' });
    if (m && m.tarea !== receta.tarea) errores.push({ campo: 'modelo.id', mensaje: `${m.etiqueta} es para ${cat.tareas[m.tarea].etiqueta.toLowerCase()}` });
    const vars = Object.entries(receta.columnas).filter(([c, r]) => c !== receta.objetivo && !['id', 'ignorar'].includes(r));
    if (!vars.length) errores.push({ campo: 'columnas', mensaje: 'marcá al menos una columna como variable' });
    const motor = m?.motor ?? 'sklearn';
    const params: Record<string, MlValor> = {};
    for (const p of m?.params ?? []) params[p.nombre] = p.nombre in receta.modelo.params ? receta.modelo.params[p.nombre] : p.defecto;
    const val = {
      particion: receta.tarea === 'clasificacion' && motor === 'sklearn' ? 'estratificada' : 'aleatoria', prueba: 0.2, validacion: 0,
      columna_tiempo: null, cv: sup ? (receta.tarea === 'clasificacion' && motor === 'sklearn' ? 'estratificada' : 'kfold') : 'ninguna',
      k: 5, repeticiones: 2, semilla: 42, metrica: cat.metricaDefecto[motor][receta.tarea],
      ...Object.fromEntries(Object.entries(receta.validacion).filter(([, v]) => v !== undefined)),
    } as MlRevision['receta']['validacion'];
    const bus = { tipo: 'ninguna', espacio: {}, iteraciones: 20, factor: 3, max_minutos: 15, n_jobs: 1,
      ...Object.fromEntries(Object.entries(receta.busqueda).filter(([, v]) => v !== undefined)) } as MlBusqueda;
    if (bus.tipo !== 'ninguna') {
      const listas = Object.values(bus.espacio);
      const combos = listas.reduce((a, v) => a * (Array.isArray(v) ? Math.max(1, v.length) : 1), 1);
      const cand = bus.tipo.includes('random') ? Math.min(bus.iteraciones, listas.some(v => !Array.isArray(v)) ? bus.iteraciones : combos) : combos;
      const part = bus.tipo === 'tvs' ? 1 : val.cv === 'repetida' ? val.k * val.repeticiones : val.k;
      bus.candidatos = cand; bus.ajustes = cand * part;
      if (!listas.length) errores.push({ campo: 'busqueda.espacio', mensaje: 'elegí al menos un hiperparámetro con sus valores para buscar' });
      if (bus.ajustes > cat.limites.max_ajustes) errores.push({ campo: 'busqueda.espacio', mensaje: `son ${bus.ajustes} entrenamientos: el máximo es ${cat.limites.max_ajustes}` });
    }
    avisos.push({ campo: 'datos', mensaje: 'Modo demo: la revisión completa (fugas, tipos, clases) la hace el servidor del contenedor', tipo: 'info' });
    const r = { ...receta, motor, validacion: val, busqueda: bus, modelo: { id: receta.modelo.id, params },
      preproceso: { ...cat.preprocesoDefecto, ...receta.preproceso }, informe: { curva_aprendizaje: motor === 'sklearn' && sup, curva_validacion: null, permutacion: motor === 'sklearn' && sup, ...receta.informe } } as MlRevision['receta'];
    return { receta: r, errores, avisos, conPerfil: false, huella: errores.length ? null : huella(JSON.stringify(r)) };
  }

  private parecido(exps: Fixture[], receta: MlReceta): Fixture {
    return exps.find(f => f.experimento.modelo?.id === receta.modelo.id && f.experimento.objetivo === receta.objetivo)
      ?? exps.find(f => f.experimento.modelo?.id === receta.modelo.id)
      ?? exps.find(f => f.experimento.tarea === receta.tarea && f.experimento.motor === (receta.modelo.id.endsWith('_spark') ? 'spark' : 'sklearn'))
      ?? exps.find(f => f.experimento.tarea === receta.tarea) ?? exps[0];
  }

  async code(receta: MlReceta, parte: MlParteCodigo = 'entrenamiento'): Promise<MlCodigo> {
    if (parte !== 'entrenamiento') {
      const { hdfs } = await this.base();
      const c = clon(hdfs.codigo[parte]);
      const igual = parte === 'perfil' ? receta.datos.ruta === hdfs.limpieza.datos.ruta
        : JSON.stringify((receta.limpieza?.pasos ?? []).map(firma)) === JSON.stringify(hdfs.limpieza.receta.pasos.map(firma));
      if (!igual) c.codigo = `# Modo demo: este es el código real ${parte === 'perfil' ? 'del perfil' : 'de la receta de limpieza de ejemplo'} de ${hdfs.limpieza.datos.ruta}.\n# Con el contenedor, el estudio arma el de TUS datos y TU receta.\n\n` + c.codigo;
      return c;
    }
    const { exps } = await this.base();
    const f = this.parecido(exps, receta);
    const igual = f.experimento.modelo?.id === receta.modelo.id;
    const nota = `# Modo demo: este es el código real de la corrida ${f.experimento.id} (${f.experimento.modelo?.etiqueta}).\n` +
      (igual ? '' : `# Con el contenedor, el estudio arma el script de TU receta (${receta.modelo.id}).\n`) + '\n';
    return { codigo: nota + f.codigo, archivo: `${f.experimento.id}.py`, motor: f.experimento.motor, huella: f.experimento.huella ?? '', comando: f.experimento.motor === 'spark' ? `spark-submit --master yarn ${f.experimento.id}.py` : `python3 ${f.experimento.id}.py` };
  }

  private nuevaCorrida(titulo: string, motor: 'sklearn' | 'spark', exp: string): MlCorrida & { lineasTodas: MlLinea[] } {
    const id = `d${++this.seq}`;
    const c = { id, experimento: exp, estado: 'corriendo' as const, progreso: 0, mensaje: 'Arrancando', motor, titulo, origen: 'estudio',
      inicio: Date.now(), ajustes: null, limites: { minutos: 15, memoriaMb: 4096 }, memoriaMb: 0, lineasTodas: [] as MlLinea[] };
    this.corridas.set(id, c);
    return c;
  }

  private emitir(c: MlCorrida & { lineasTodas: MlLinea[] }) {
    const { lineasTodas: _l, ...run } = c;
    void _l;
    this.e.emit({ type: 'mlrun', run: clon(run) } as ApiEvent);
  }

  private linea(c: MlCorrida & { lineasTodas: MlLinea[] }, texto: string, stream: 'out' | 'err' = 'out') {
    c.lineasTodas.push({ n: c.lineasTodas.length, stream, texto });
  }

  async train(receta: MlReceta): Promise<{ id: string; run: string }> {
    const { exps } = await this.base();
    if ([...this.corridas.values()].some(c => c.estado === 'corriendo')) fail('busy', 'Ya hay una corrida de ML en curso: esperá a que termine o cancelala');
    const rev = await this.check(receta);
    if (rev.errores.length) fail('invalid', `${rev.errores[0].campo}: ${rev.errores[0].mensaje}`);
    const f = this.parecido(exps, receta);
    const id = `exp-${new Date(this.e.now()).toISOString().replace(/[-:T]/g, '').slice(0, 14).replace(/^(\d{8})/, '$1-')}-${(1000 + this.seq).toString(16).slice(-4)}`;
    const c = this.nuevaCorrida(`${f.experimento.modelo?.etiqueta ?? 'Modelo'} (${f.experimento.motor === 'spark' ? 'Spark MLlib' : 'scikit-learn'})`, f.experimento.motor, id);
    const pasos: [number, string][] = [[5, 'Leyendo los datos'], [15, 'Buscando hiperparámetros'], [45, 'Validación cruzada'], [70, 'Entrenando'], [80, 'Probando con datos que no vio'], [85, 'Curvas e importancia'], [95, 'Guardando el modelo'], [100, 'Listo']];
    this.linea(c, `(demo) ${f.experimento.motor === 'spark' ? 'spark-submit --master yarn' : 'python3'} ${id}.py`);
    if (f.experimento.busqueda) c.ajustes = { hechos: 0, total: f.experimento.busqueda.candidatos * 5, candidatos: f.experimento.busqueda.candidatos, particiones: 5 };
    pasos.forEach(([p, msg], i) => this.e.at((i + 1) * (f.experimento.motor === 'spark' ? 6 : 2.5), () => {
      if (c.estado !== 'corriendo') return;
      this.linea(c, `[${String(p).padStart(3)}%] ${msg}`);
      if (p === 15 && c.ajustes) { c.ajustes.hechos = c.ajustes.total; this.linea(c, `Fitting 5 folds for each of ${c.ajustes.candidatos} candidates, totalling ${c.ajustes.total} fits`); }
      c.progreso = p / 100; c.mensaje = msg; c.memoriaMb = 180 + 30 * i; c.memoriaPicoMb = c.memoriaMb;
      if (p === 100) {
        c.estado = 'listo'; c.fin = Date.now();
        const exp = clon(f.experimento);
        Object.assign(exp, { id, nombre: `demo: copia del resultado real de ${f.experimento.id}`, creado: new Date(this.e.now()).toISOString().slice(0, 19), origen: 'estudio', receta: rev.receta });
        const fila = { ...clon(f.fila), id, nombre: exp.nombre, creado: exp.creado };
        this.exps!.unshift({ fila, experimento: exp, codigo: f.codigo });
        this.linea(c, `Experimento ${id} registrado (demo: copia de ${f.experimento.id})`);
        this.e.act('ML', 'ok', `${c.titulo}: listo (demo)`);
      }
      this.emitir(c);
    }));
    this.emitir(c);
    return { id, run: c.id };
  }

  async runCode(): Promise<{ id: string; run: string }> {
    const id = `exp-demo-${++this.seq}`;
    const c = this.nuevaCorrida('Código editado (scikit-learn)', 'sklearn', id);
    this.linea(c, '(demo) En el contenedor, esto corre tu código con python3 o spark-submit, con límite de tiempo y memoria.');
    this.e.at(2, () => { this.linea(c, 'En el modo demo no hay Python: probalo con la imagen full.'); c.estado = 'falló'; c.error = 'Modo demo: no se puede correr código'; c.mensaje = c.error; c.fin = Date.now(); this.emitir(c); });
    this.emitir(c);
    return { id, run: c.id };
  }

  runs(): MlCorrida[] { return [...this.corridas.values()].reverse().map(({ lineasTodas: _l, ...c }) => { void _l; return clon(c); }); }

  run(id: string, desde = 0): MlCorrida {
    const c = this.corridas.get(id);
    if (!c) fail('not_found', 'No existe esa corrida');
    const { lineasTodas, ...resto } = c;
    return { ...clon(resto), lineas: lineasTodas.filter(l => l.n >= desde), total: lineasTodas.length };
  }

  cancel(id: string): MlCorrida {
    const c = this.corridas.get(id);
    if (!c) fail('not_found', 'No existe esa corrida');
    if (c.estado === 'corriendo') { c.estado = 'falló'; c.error = 'cancelado desde la interfaz'; c.mensaje = c.error; c.fin = Date.now(); this.emitir(c); }
    return this.run(id);
  }

  /* ---------- receta de limpieza: la vista previa precalculada y las versiones en memoria ---------- */

  async cleaningPreview(datos: MlDatos, limpieza: MlLimpieza): Promise<MlVistaLimpieza> {
    const { hdfs } = await this.base();
    const ej = hdfs.limpieza;
    if (datos.ruta !== ej.datos.ruta) {
      fail('unsupported', `En el modo demo la vista previa está precalculada para ${ej.datos.ruta} con la receta de ejemplo (abrila en «Abrir una guardada»). Con el contenedor, Spark corre cualquier receta sobre cualquier fuente`);
    }
    const porFirma = new Map(ej.receta.pasos.map((p, i) => [firma(p), ej.vista.pasos.find(v => v.paso === i)!]));
    const pasos: MlPasoVista[] = limpieza.pasos.map((p, i) => {
      const v = porFirma.get(firma(p));
      return v ? { ...clon(v), paso: i } : {
        paso: i, tipo: p.tipo, titulo: p.tipo, fase: 'modelo', ok: false,
        error: { mensaje: 'En el modo demo solo están precalculados los pasos de la receta de ejemplo: con el contenedor, Spark corre cualquier paso' },
      } as MlPasoVista;
    });
    return { ...clon(ej.vista), pasos, huella: huella(JSON.stringify(limpieza.pasos)) };
  }

  private async guardadas(): Promise<MlLimpiezaGuardada[]> {
    const { hdfs } = await this.base();
    this.limpiezas ??= [{ nombre: 'ventas', versiones: [{ version: 1, creado: '2026-10-28T22:10:00', huella: huella(JSON.stringify(hdfs.limpieza.receta.pasos)),
      nota: 'la receta de ejemplo de ventas_sucias', limpieza: { ...clon(hdfs.limpieza.receta), version: 1 } }] }];
    return this.limpiezas;
  }

  async cleanings(): Promise<MlLimpiezaFila[]> {
    return (await this.guardadas()).map(d => {
      const v = d.versiones[d.versiones.length - 1];
      return { nombre: d.nombre, versiones: d.versiones.length, version: v.version, creado: v.creado, pasos: v.limpieza.pasos.length, huella: v.huella };
    });
  }

  async cleaning(nombre: string): Promise<MlLimpiezaGuardada> {
    const d = (await this.guardadas()).find(x => x.nombre === nombre);
    if (!d) fail('not_found', `No hay una receta de limpieza que se llame ${nombre}`);
    return clon(d);
  }

  async saveCleaning(nombre: string, limpieza: MlLimpieza, nota?: string | null) {
    if (!/^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,59}$/.test(nombre)) fail('invalid', 'El nombre de la receta de limpieza: letras, números, espacios, punto y guiones (hasta 60)');
    if (!limpieza.pasos.length) fail('invalid', 'La receta de limpieza no tiene pasos');
    const todas = await this.guardadas();
    let d = todas.find(x => x.nombre === nombre);
    if (!d) { d = { nombre, versiones: [] }; todas.push(d); }
    const h = huella(JSON.stringify(limpieza.pasos));
    const ultima = d.versiones[d.versiones.length - 1];
    if (ultima?.huella === h) return { nombre, version: ultima.version, huella: h, creado: ultima.creado, nueva: false };
    const v = { version: (ultima?.version ?? 0) + 1, creado: new Date().toISOString().slice(0, 19), huella: h, nota: nota ?? null,
      limpieza: { nombre, version: (ultima?.version ?? 0) + 1, pasos: clon(limpieza.pasos) } };
    d.versiones.push(v);
    return { nombre, version: v.version, huella: h, creado: v.creado, nueva: true };
  }

  async experiments(): Promise<MlExperimentoFila[]> { return clon((await this.base()).exps.map(f => f.fila)); }

  async experiment(id: string): Promise<MlExperimento> {
    const f = (await this.base()).exps.find(x => x.experimento.id === id);
    if (!f) fail('not_found', `No existe el experimento ${id}`);
    return clon(f.experimento);
  }

  async remove(id: string): Promise<void> { await this.base(); this.exps = this.exps!.filter(f => f.experimento.id !== id); }

  async download(id: string, formato: 'py' | 'ipynb' | 'modelo' | 'log'): Promise<{ url: string; name: string }> {
    const f = (await this.base()).exps.find(x => x.experimento.id === id);
    if (!f) fail('not_found', `No existe el experimento ${id}`);
    if (formato === 'modelo') fail('unsupported', 'En el modo demo no hay modelos guardados: con el contenedor se baja el .joblib');
    const { aNotebook } = await import('../../pages/ml/estudio/comun');
    const texto = formato === 'ipynb' ? aNotebook(f.codigo) : formato === 'log' ? '(demo) la salida queda en salida.log de cada experimento' : f.codigo;
    return { url: `data:text/plain;charset=utf-8,${encodeURIComponent(texto)}`, name: `${id}.${formato}` };
  }
}

function huella(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0') + 'demo';
}
