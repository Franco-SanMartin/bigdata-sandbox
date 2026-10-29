/* La receta de limpieza en la pantalla: las mismas fases y columnas creadas que sandbox_ml/limpieza.py
   (server/tests/test_estudio_datos.py prueba el lado de Python), y la vista previa del modo demo. */
import { describe, expect, it } from 'vitest';
import type { MlPaso, MlPerfil } from '../../../api/types';
import { DemoEstudio } from '../../../api/demo/estudio';
import { conLimpieza, creadasPor, creadasPorLimpieza, faseDe } from './estado';

const PASOS: MlPaso[] = [
  { tipo: 'regex', columna: 'precio', patron: '[$.]', reemplazo: '' },
  { tipo: 'nulos', columna: 'precio', estrategia: 'mediana', indicador: true },
  { tipo: 'fecha', columna: 'fecha', formato: 'dd/MM/yyyy', partes: ['anio', 'mes'] },
  { tipo: 'derivada', nombre: 'total', expresion: 'precio * cantidad', rol: 'numerica' },
  { tipo: 'regex', columna: 'dir', patron: '(\\d+)', modo: 'extraer', grupo: 1, destino: 'altura' },
  { tipo: 'mapeo', columna: 'compra', mapa: { Sí: 'si' } },
  { tipo: 'duplicados', columnas: ['id'] },
  { tipo: 'filtro', condicion: 'cantidad > 0' },
  { tipo: 'nulos', columna: 'cantidad', estrategia: 'eliminar' },
  { tipo: 'outliers', columna: 'precio', metodo: 'iqr', factor: 3, accion: 'eliminar' },
  { tipo: 'derivada', nombre: 'apagada', expresion: '1', activo: false },
];

describe('receta de limpieza', () => {
  it('separa lo de entrenamiento de lo que va adentro del modelo (el objetivo, siempre entrenamiento)', () => {
    expect(PASOS.map(p => faseDe(p, 'compra'))).toEqual([
      'modelo', 'modelo', 'modelo', 'modelo', 'modelo', 'entrenamiento', 'entrenamiento', 'entrenamiento', 'entrenamiento', 'entrenamiento', 'modelo',
    ]);
    expect(faseDe(PASOS[5], null)).toBe('modelo');
  });

  it('sabe qué columnas crea cada paso (y las apagadas no cuentan)', () => {
    expect(creadasPor(PASOS[1])).toEqual({ precio_nulo: 'numerica' });
    expect(creadasPor(PASOS[2])).toEqual({ fecha_anio: 'numerica', fecha_mes: 'numerica' });
    expect(creadasPor(PASOS[4])).toEqual({ altura: 'categorica' });
    expect(creadasPor(PASOS[10])).toEqual({});
    expect(Object.keys(creadasPorLimpieza({ pasos: PASOS }))).toEqual(['precio_nulo', 'fecha_anio', 'fecha_mes', 'total', 'altura']);
  });

  it('suma al perfil las columnas creadas, para elegirles el rol', () => {
    const p = { columnas: [{ nombre: 'precio' }, { nombre: 'total' }] } as unknown as MlPerfil;
    const con = conLimpieza(p, { pasos: PASOS });
    expect(con.columnas.map(c => c.nombre)).toEqual(['precio', 'total', 'precio_nulo', 'fecha_anio', 'fecha_mes', 'altura']);
    expect(con.columnas[2]).toMatchObject({ rol: 'numerica', dtype: 'limpieza' });
    expect(conLimpieza(p, undefined)).toBe(p);
  });
});

describe('modo demo: la limpieza precalculada', () => {
  const demo = () => new DemoEstudio({} as never);

  it('la receta de ejemplo está guardada y su vista previa es la de la corrida real', async () => {
    const d = demo();
    const [fila] = await d.cleanings();
    expect(fila).toMatchObject({ nombre: 'ventas', version: 1 });
    const { versiones: [v] } = await d.cleaning('ventas');
    const fuentes = await d.sources();
    const gz = fuentes.hdfs.find(f => f.compresion === 'gzip')!;
    const vista = await d.cleaningPreview({ origen: 'hdfs', ruta: gz.ruta, formato: 'csv' }, v.limpieza);
    expect(vista.pasos).toHaveLength(v.limpieza.pasos.length);
    expect(vista.pasos.every(p => p.ok)).toBe(true);
    expect(vista.filas.entrenamiento).toBeLessThan(vista.filas.leidas);
    // Un paso que no está precalculado: avisa, no inventa
    const otra = await d.cleaningPreview({ origen: 'hdfs', ruta: gz.ruta }, { pasos: [{ tipo: 'filtro', condicion: 'precio > 0' }] });
    expect(otra.pasos[0].ok).toBe(false);
    await expect(d.cleaningPreview({ origen: 'local', ruta: '/datos/clientes_senal.csv' }, v.limpieza)).rejects.toThrow(/precalculada/);
  });

  it('las versiones se guardan en memoria y guardar lo mismo no repite', async () => {
    const d = demo();
    const pasos = { pasos: [{ tipo: 'duplicados', columnas: [] } as MlPaso] };
    expect((await d.saveCleaning('mia', pasos)).version).toBe(1);
    expect((await d.saveCleaning('mia', pasos)).nueva).toBe(false);
    expect((await d.saveCleaning('mia', { pasos: [...pasos.pasos, { tipo: 'filtro', condicion: 'x > 1' }] })).version).toBe(2);
    expect((await d.cleanings()).find(f => f.nombre === 'mia')?.versiones).toBe(2);
  });

  it('los datos de HDFS tienen su perfil con Spark (formato, compresión y particiones)', async () => {
    const d = demo();
    const part = (await d.sources()).hdfs.find(f => f.particiones)!;
    const p = await d.profile({ origen: 'hdfs', ruta: part.ruta, formato: 'parquet' }, null, { motor: 'spark' });
    expect(p.motor).toBe('spark');
    expect(p.fuente?.particiones?.columnas).toEqual(['anio', 'mes']);
    await expect(d.profile({ origen: 'local', ruta: '/datos/clientes_senal.csv' }, null, { motor: 'spark' })).rejects.toThrow(/HDFS/);
  });
});
