/* La misma tabla de ventas en tres formatos: el CSV que ya está en HDFS (la tabla externa ventas) y dos
   copias que arma Hive, en Parquet y en ORC, cada una en su carpeta. Lo que se mide sale de HDFS (tamaño,
   archivos, bloques) y de Hive (cuánto tarda la misma consulta en cada una). */
import type { CatalogEntry, HdfsEntry } from '../api/types';

export type FormatoId = 'csv' | 'parquet' | 'orc';
export interface Formato { id: FormatoId; nombre: string; tabla: string; carpeta: string; stored?: 'PARQUET' | 'ORC'; como: string }

export const FORMATOS: Formato[] = [
  { id: 'csv', nombre: 'Texto (CSV)', tabla: 'default.ventas', carpeta: '/user/root/ventas', como: 'Una línea por venta, los campos separados por coma. Se lee entera, de punta a punta.' },
  { id: 'parquet', nombre: 'Parquet', tabla: 'default.ventas_parquet', carpeta: '/user/root/formatos/parquet', stored: 'PARQUET', como: 'Por columnas, comprimidas y con su tipo. El formato de Spark.' },
  { id: 'orc', nombre: 'ORC', tabla: 'default.ventas_orc', carpeta: '/user/root/formatos/orc', stored: 'ORC', como: 'Por columnas, con índices livianos por bloque. El formato de Hive.' },
];

const corto = (t: string) => t.replace(/^default\./, '');

/** Lo que corre Hive para armar una copia: la tabla externa en su carpeta y el INSERT que la llena desde
    ventas (el CSV). Van por separado: cada sentencia muestra su resultado */
export function crearCopia(f: Formato, columnas: { name: string; type: string }[]): [string, string] {
  if (!f.stored) throw new Error('El CSV no se copia: es la tabla ventas');
  const cols = columnas.map(c => `  ${c.name} ${c.type.toUpperCase()}`).join(',\n');
  return [
    `CREATE EXTERNAL TABLE IF NOT EXISTS ${corto(f.tabla)} (\n${cols}\n)\nSTORED AS ${f.stored}\nLOCATION '${f.carpeta}';`,
    `INSERT OVERWRITE TABLE ${corto(f.tabla)}\nSELECT * FROM ventas;`,
  ];
}

/** La misma consulta para las tres: usa 3 de las 5 columnas (producto, cantidad y precio) */
export const consulta = (tabla: string) =>
  `SELECT producto, SUM(cantidad) AS unidades, SUM(CAST(cantidad AS BIGINT) * precio) AS facturado\nFROM ${corto(tabla)}\nGROUP BY producto;`;
export const COLUMNAS_USADAS = ['producto', 'cantidad', 'precio'];

export interface Medida { mb: number; archivos: number; bloques: number }

/** Lo que ocupa una carpeta de una tabla: los archivos de datos, sin los de control (_SUCCESS, .hive-staging…) */
export function medir(entries: HdfsEntry[]): Medida {
  const datos = entries.filter(e => e.type === 'file' && !/^[._]/.test(e.name));
  return {
    mb: datos.reduce((x, e) => x + (e.sizeMb ?? 0), 0),
    archivos: datos.length,
    bloques: datos.reduce((x, e) => x + (e.blocks ?? 0), 0),
  };
}

/** Las tablas de los tres formatos que ya existen, con la carpeta que anotó el Metastore */
export function existentes(catalogo: CatalogEntry[]): Partial<Record<FormatoId, CatalogEntry>> {
  const out: Partial<Record<FormatoId, CatalogEntry>> = {};
  for (const f of FORMATOS) {
    const t = catalogo.find(c => c.source === 'hive' && c.name === f.tabla);
    if (t) out[f.id] = t;
  }
  return out;
}

/** Unas filas de ventas para el dibujo de fila contra columna (las primeras de ventas_grandes.csv) */
export const MUESTRA = {
  columnas: ['fecha', 'sucursal', 'producto', 'cantidad', 'precio'],
  filas: [
    ['2026-01-31', 'Sur', 'azucar', '5', '1200'],
    ['2026-06-15', 'Centro', 'bombilla', '5', '3000'],
    ['2026-06-09', 'Oeste', 'galletitas', '5', '1800'],
    ['2026-05-06', 'Oeste', 'yerba', '5', '2500'],
  ],
};
