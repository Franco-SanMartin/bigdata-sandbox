/* Biblioteca de modelos en el modo demo (sin contenedor). Los modelos, sus versiones, los lotes con su deriva, el
   código del lote y algunas predicciones salen de corridas de verdad (ui/scripts/estudio_demo.py --biblioteca contra
   una full). Promover, archivar, volver atrás y guardar experimentos se hacen en memoria, con las mismas reglas que
   sandbox_ml/biblioteca.py. Un lote nuevo repite el resumen de un lote real del mismo modelo, marcado como tal. */
import type {
  MlComparacionVersiones, MlCorrida, MlLote, MlModeloBiblioteca, MlModeloFila, MlPedidoLote, MlPrediccion, MlVersion,
} from '../types';
import { fail } from '../errors';
import type { DemoEngine } from './engine';
import type { DemoEstudio } from './estudio';

interface Fixture {
  modelos: MlModeloBiblioteca[];
  lotes: MlLote[];
  /** `${nombre}-v${version}` → el script del lote */
  codigo: Record<string, { codigo: string; comando: string }>;
  /** `${nombre}-v${version}` → una predicción al instante de verdad */
  predicciones: Record<string, MlPrediccion & { filas_pedidas?: Record<string, unknown>[] }>;
}

const clon = <T,>(v: T): T => structuredClone(v);
const NOMBRE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const valor = (x: MlVersion) => { const m = x.metricas[x.metrica ?? ''] ?? {}; return m.prueba ?? m.cv ?? null; };

export class DemoBiblioteca {
  private f: Fixture | null = null;
  private seq = 0;
  constructor(private e: DemoEngine, private est: DemoEstudio) {}

  private async base(): Promise<Fixture> {
    if (!this.f) this.f = clon((await import('./ml/biblioteca.json')).default as unknown as Fixture);
    return this.f;
  }
  private ahora() { return new Date(this.e.now()).toISOString().slice(0, 19); }
  private async leer(nombre: string): Promise<MlModeloBiblioteca> {
    const m = (await this.base()).modelos.find(x => x.nombre === nombre);
    if (!m) fail('not_found', `No hay un modelo ${nombre} en la biblioteca`);
    return m;
  }
  private version(m: MlModeloBiblioteca, v: unknown): MlVersion {
    const x = m.versiones.find(y => y.version === Number(v));
    if (!x) fail('invalid', `${m.nombre} no tiene la versión ${v}`);
    return x;
  }
  private evento(m: MlModeloBiblioteca, accion: MlModeloBiblioteca['historial'][number]['accion'], version: number, nota = '', detalle = '') {
    m.historial.push({ cuando: this.ahora(), accion, version, nota, detalle });
    m.actualizado = this.ahora();
  }
  private async conLotes(m: MlModeloBiblioteca): Promise<MlModeloBiblioteca> {
    return clon({ ...m, lotes: (await this.base()).lotes.filter(l => l.modelo === m.nombre).slice(0, 20) });
  }

  async lista(): Promise<MlModeloFila[]> {
    const { modelos } = await this.base();
    return modelos.map(m => {
      const p = m.versiones.find(x => x.estado === 'produccion');
      const u = p ?? m.versiones[m.versiones.length - 1];
      return {
        nombre: m.nombre, descripcion: m.descripcion, tarea: m.tarea, objetivo: m.objetivo, metrica: m.metrica, versiones: m.versiones.length,
        produccion: p?.version ?? null, valor: p ? valor(p) : null, motor: u?.motor ?? null, modeloEtiqueta: u?.modelo.etiqueta ?? null,
        candidatas: m.versiones.filter(x => x.estado === 'candidato').length, creado: m.creado, actualizado: m.actualizado,
      };
    }).sort((a, b) => b.actualizado.localeCompare(a.actualizado));
  }

  async modelo(nombre: string): Promise<MlModeloBiblioteca> { return this.conLotes(await this.leer(nombre)); }

  async registrar(req: { nombre: string; experimento: string; nota?: string; descripcion?: string }): Promise<MlModeloBiblioteca> {
    if (!NOMBRE.test(req.nombre ?? '')) fail('invalid', 'El nombre va en minúsculas, con números, - o _ (hasta 48 letras), por ejemplo churn o gasto-v2');
    const exp = await this.est.experiment(req.experimento);
    if (exp.estado !== 'listo' || !exp.tarea || !exp.modelo) fail('invalid', 'Ese experimento no terminó bien: solo se guardan los que están listos');
    const f = await this.base();
    let m = f.modelos.find(x => x.nombre === req.nombre);
    if (m && (m.tarea !== exp.tarea || (m.objetivo ?? null) !== (exp.objetivo ?? null))) fail('invalid', `${m.nombre} predice otra cosa: guardalo con otro nombre`);
    if (m?.versiones.some(x => x.experimento === exp.id)) fail('invalid', 'Ese experimento ya está en ese modelo');
    if (!m) {
      m = { nombre: req.nombre, descripcion: req.descripcion ?? '', creado: this.ahora(), actualizado: this.ahora(), tarea: exp.tarea, objetivo: exp.objetivo ?? null,
        metrica: exp.metrica, versiones: [], historial: [], lotes: [] };
      f.modelos.push(m);
    }
    const n = Math.max(0, ...m.versiones.map(x => x.version)) + 1;
    m.versiones.push({
      version: n, estado: 'candidato', creado: this.ahora(), nota: req.nota ?? '', experimento: exp.id, motor: exp.motor, tarea: exp.tarea,
      objetivo: exp.objetivo ?? null, metrica: exp.metrica, modelo: exp.modelo, metricas: exp.metricas, umbral: exp.umbral ?? null, clases: exp.clases ?? null,
      entrada: exp.entrada ?? null, deriva: !!exp.entrada,
      artefacto: exp.motor === 'spark' ? `/user/root/ml/biblioteca/${m.nombre}/v${n}` : `/hadoop/ml/biblioteca/${m.nombre}/v${n}/modelo.joblib`,
      modelo_bytes: exp.modelo_bytes ?? null,
      linaje: {
        experimento: exp.id, nombre_experimento: exp.nombre ?? null, entrenado: exp.terminado ?? null, datos: exp.datos, filas: exp.filas ?? null,
        limpieza: null, huella_receta: exp.huella, objetivo: exp.objetivo ?? null, variables: exp.variables ?? null,
        validacion: { ...(exp.receta?.validacion ?? {}) } as MlVersion['linaje']['validacion'],
        busqueda: exp.busqueda ? { tipo: exp.busqueda.tipo, candidatos: exp.busqueda.candidatos, mejores_params: exp.busqueda.mejores_params } : null,
        yarn: exp.yarn?.app_id ?? null, recursos: exp.recursos ?? null, entorno: exp.entorno ?? null, editado: exp.editado,
      },
    });
    this.evento(m, 'registrar', n, req.nota ?? '', `desde ${exp.id} (demo)`);
    return this.conLotes(m);
  }

  async estado(nombre: string, req: { accion: 'promover' | 'archivar' | 'volver'; version?: number; nota?: string }): Promise<MlModeloBiblioteca> {
    const m = await this.leer(nombre);
    const actual = m.versiones.find(x => x.estado === 'produccion');
    if (req.accion === 'promover') {
      const x = this.version(m, req.version);
      if (x.estado === 'produccion') fail('invalid', `La versión ${x.version} ya está en producción`);
      if (actual) { actual.estado = 'archivado'; this.evento(m, 'archivar', actual.version, '', `la reemplazó la versión ${x.version}`); }
      x.estado = 'produccion'; x.promovida = this.ahora();
      this.evento(m, 'promover', x.version, req.nota, actual ? `antes estaba la versión ${actual.version}` : 'primera en producción');
    } else if (req.accion === 'archivar') {
      const x = this.version(m, req.version);
      if (x.estado === 'archivado') fail('invalid', `La versión ${x.version} ya está archivada`);
      const era = x.estado;
      x.estado = 'archivado';
      this.evento(m, 'archivar', x.version, req.nota, era === 'produccion' ? 'estaba en producción: el modelo queda sin versión en producción' : '');
    } else if (req.accion === 'volver') {
      const previa = [...m.historial].reverse().find(h => (h.accion === 'promover' || h.accion === 'volver') && h.version !== actual?.version)?.version;
      if (previa == null) fail('invalid', 'No hay una versión anterior en producción a la que volver');
      if (actual) { actual.estado = 'archivado'; this.evento(m, 'archivar', actual.version, '', `volver atrás a la versión ${previa}`); }
      const x = this.version(m, previa);
      x.estado = 'produccion'; x.promovida = this.ahora();
      this.evento(m, 'volver', previa, req.nota, actual ? `desde la versión ${actual.version}` : '');
    } else fail('invalid', 'accion es promover, archivar o volver');
    return this.conLotes(m);
  }

  async describir(nombre: string, descripcion: string): Promise<MlModeloBiblioteca> {
    const m = await this.leer(nombre);
    m.descripcion = descripcion.slice(0, 500);
    m.actualizado = this.ahora();
    return this.conLotes(m);
  }

  async comparar(nombre: string, versiones: number[]): Promise<MlComparacionVersiones> {
    const m = await this.leer(nombre);
    const cat = await this.est.catalog();
    const xs = versiones.length ? versiones.map(v => this.version(m, v)) : m.versiones;
    const nombres = [...new Set(xs.flatMap(x => Object.keys(x.metricas)))].sort((a, b) => Number(a !== m.metrica) - Number(b !== m.metrica) || a.localeCompare(b));
    return {
      nombre, metrica: m.metrica,
      versiones: xs.map(x => ({ version: x.version, estado: x.estado, motor: x.motor, modelo: x.modelo.etiqueta, experimento: x.experimento, creado: x.creado, umbral: x.umbral })),
      metricas: nombres.map(k => {
        const info = cat.metricas[k];
        const vals = xs.map(x => x.metricas[k]?.prueba ?? x.metricas[k]?.cv ?? null);
        const hay = vals.filter((v): v is number => v != null);
        const obj = hay.length ? (info?.mayor_mejor ?? true ? Math.max(...hay) : Math.min(...hay)) : null;
        return { metrica: k, etiqueta: info?.etiqueta ?? k, mayor_mejor: info?.mayor_mejor ?? true, valores: vals,
          mejor: obj == null ? null : xs.filter((_, i) => vals[i] === obj).map(x => x.version), principal: k === m.metrica };
      }),
      params: [...new Set(xs.flatMap(x => Object.keys(x.modelo.params ?? {})))].sort().map(p => {
        const vals = xs.map(x => x.modelo.params?.[p] ?? null);
        return { param: p, valores: vals, cambia: new Set(vals.map(v => JSON.stringify(v))).size > 1 };
      }),
      datos: xs.map(x => ({ version: x.version, fuente: x.linaje.datos?.ruta ?? x.linaje.datos?.tabla ?? null, filas: x.linaje.filas, huella: x.linaje.huella_receta, limpieza: x.linaje.limpieza })),
    };
  }

  async predecir(nombre: string, req: { filas?: Record<string, unknown>[]; version?: number | null }): Promise<MlPrediccion & { version: number; estado: string }> {
    const m = await this.leer(nombre);
    const x = req.version != null ? this.version(m, req.version) : m.versiones.find(v => v.estado === 'produccion');
    if (!x) fail('invalid', `${nombre} no tiene una versión en producción: elegí una versión o promové una`);
    const faltan = (x.entrada ?? []).map(c => c.columna).filter(c => (req.filas ?? []).some(f => !(c in f)));
    if (faltan.length) fail('invalid', `No se pudo predecir: Faltan columnas: ${faltan.join(', ')}`);
    const p = (await this.base()).predicciones[`${nombre}-v${x.version}`];
    if (!p) fail('unsupported', 'En el modo demo solo hay predicciones guardadas de algunas versiones: con la imagen full predice cualquiera');
    const { filas_pedidas: _f, ...res } = clon(p);
    void _f;
    return { ...res, version: x.version, estado: x.estado };
  }

  async codigo(nombre: string, req: MlPedidoLote): Promise<{ codigo: string; comando: string }> {
    const m = await this.leer(nombre);
    const x = req.version != null ? this.version(m, req.version) : m.versiones.find(v => v.estado === 'produccion') ?? m.versiones[m.versiones.length - 1];
    const f = await this.base();
    const c = f.codigo[`${nombre}-v${x.version}`] ?? Object.values(f.codigo)[0];
    if (!c) fail('unsupported', 'En el modo demo no hay código de lotes guardado');
    return { codigo: `# (demo) el script real de un lote de ${nombre}; con la imagen full se arma con lo que elijas\n${c.codigo}`, comando: c.comando };
  }

  async lote(nombre: string, req: MlPedidoLote): Promise<{ id: string; run: string }> {
    const m = await this.leer(nombre);
    const x = req.version != null ? this.version(m, req.version) : m.versiones.find(v => v.estado === 'produccion');
    if (!x) fail('invalid', `${nombre} no tiene una versión en producción: elegí una versión o promové una`);
    const f = await this.base();
    const real = f.lotes.find(l => l.modelo === nombre && l.resumen) ?? f.lotes.find(l => l.resumen);
    if (!real?.resumen) fail('unsupported', 'En el modo demo no hay lotes guardados: probalo con la imagen full');
    const id = `lote-demo-${++this.seq}`;
    const entrada = req.datos.ruta ?? req.datos.tabla ?? 'datos nuevos';
    const salida = (req.salida.tipo === 'hive'
      ? { tipo: 'hive', tabla: (req.salida as { tabla?: string }).tabla ?? `default.pred_${nombre}_v${x.version}`, modo: req.salida.modo ?? 'overwrite' }
      : { tipo: 'hdfs', ruta: (req.salida as { ruta?: string }).ruta ?? `/user/root/ml/predicciones/${nombre}-v${x.version}`, formato: (req.salida as { formato?: string }).formato ?? 'parquet', modo: req.salida.modo ?? 'overwrite' }) as MlLote['salida'];
    const lote: MlLote = { id, modelo: nombre, version: x.version, estado_version: x.estado, motor_modelo: x.motor, titulo: `${nombre} v${x.version} sobre ${entrada}`,
      datos: req.datos, salida, entrada, estado: 'corriendo', creado: this.ahora() };
    f.lotes.unshift(lote);
    const run = this.est.simularLote(lote.titulo!, { lote: id, modelo: nombre, version: x.version }, (c: MlCorrida) => {
      const r = clon(real.resumen!);
      Object.assign(r, { modelo: nombre, version: x.version, salida, destino: salida.tipo === 'hive' ? salida.tabla : `hdfs://${salida.ruta}`,
        avisos: [`(demo) el resumen de un lote real (${real.id}, ${real.entrada}); con la imagen full se predice sobre ${entrada}`, ...r.avisos] });
      Object.assign(lote, { estado: 'listo', terminado: this.ahora(), resumen: r });
      c.resultado = r;
      c.mensaje = `${r.filas.toLocaleString('es-AR')} predicciones en ${r.destino}`;
    });
    return { id, run };
  }

  async lotes(): Promise<MlLote[]> { return clon((await this.base()).lotes); }
}
