/* Datos reales de los ejemplos del sandbox, para el modo demo. Salen de correr los scripts de
   datos/ejemplos (generar_ventas.py, ml/generar_sucios.py, ml/etl_pandas.py, ml/generar_senal.py,
   ml/modelos_sklearn.py) con sus semillas fijas: dan lo mismo en cualquier compu. */
import type { CatalogEntry, ModelRun, QueryResult } from '../types';

type Row = (string | number | null)[];

export const VENTAS_HEAD: Row[] = [['2026-01-31', 'Sur', 'azucar', 5, 1200], ['2026-06-15', 'Centro', 'bombilla', 5, 3000], ['2026-06-09', 'Oeste', 'galletitas', 5, 1800], ['2026-05-06', 'Oeste', 'yerba', 5, 2500], ['2026-01-21', 'Centro', 'yerba', 1, 2500]];
export const POR_PRODUCTO: Row[] = [['yerba', 179512, 448780000], ['termo', 11793, 412755000], ['mate', 48154, 385232000], ['cafe', 29471, 191561500], ['galletitas', 82979, 149362200], ['facturas', 121087, 108978300], ['bombilla', 36281, 108843000], ['azucar', 89796, 107755200]];
export const POR_SUCURSAL: Row[] = [['Oeste', 50155, 480328000], ['Norte', 50062, 480187600], ['Sur', 49932, 476986200], ['Centro', 49851, 475765400]];
export const POR_CATEGORIA: Row[] = [['accesorios', 96228, 906830000], ['infusiones', 208983, 640341500], ['almacen', 172775, 257117400], ['panaderia', 121087, 108978300]];

/* ventas_sucias.csv → ventas_limpias.parquet (etl_pandas.py) */
export const SUCIAS_HEAD: Row[] = [[52515, '20260623', 'Oeste', 'yerba', '2', '2898', 'Débito'], [51694, '04/01/2026', 'Sur', 'Facturas', '2', '900,00', 'efectivo'], [61265, '01/01/2026', 'Centro', 'FACTURAS', '5', '900', 'Qr'], [40762, '04/01/2026', 'Sur', 'azucar', '300', '1200', 'efectivo'], [76331, '2026-04-30', 'Centro', 'yerba', '4', '273200', 'QR']];
export const LIMPIAS_HEAD: Row[] = [[1, '2026-01-31', 'centro', 'facturas', 2, 900, 1800, 'qr'], [2, '2026-05-27', 'oeste', 'azucar', 5, 1351, 6755, 'qr'], [3, '2026-03-03', 'centro', 'yerba', 1, 2652, 2652, 'credito'], [4, '2026-01-26', 'oeste', 'facturas', 3, 900, 2700, 'debito'], [6, '2026-03-29', 'sur', 'yerba', 3, 2652, 7956, 'qr']];
export const ETL_RESUMEN: [string, string][] = [
  ['Filas leídas', '103.000'], ['Duplicados eliminados', '3.000'], ['Fechas dd/mm/aaaa convertidas', '35.070'], ['Fechas "todo junto" convertidas', '10.025'],
  ['Precios con formato 2.575,00', '14.866'], ['Sin cantidad (fuera)', '2.000'], ['Cantidad imposible (fuera)', '800'], ['Precio sin la coma (÷100)', '500'],
  ['Sin precio (→ mediana del producto)', '1.000'], ['Sin medio de pago (→ desconocido)', '5.000'], ['Filas limpias', '97.200'], ['Facturado total', '$ 1.003.117.916'],
];
export const LIMPIAS_POR_SUCURSAL: Row[] = [['centro', 24544, 254283835], ['oeste', 24404, 252528388], ['norte', 24146, 248494598], ['sur', 24106, 247811095]];
export const LIMPIAS_POR_PRODUCTO: Row[] = [['yerba', 87404, 235500228], ['termo', 5823, 219337638], ['mate', 23063, 198971888], ['cafe', 14308, 100374344], ['galletitas', 40754, 79163393], ['facturas', 58795, 57030104], ['bombilla', 17485, 56593661], ['azucar', 43382, 56146660]];
export const LIMPIAS_POR_MES: Row[] = [['enero', 162480598], ['febrero', 149898814], ['marzo', 170926068], ['abril', 163573436], ['mayo', 177521703], ['junio', 178717297]];
export const LIMPIAS_POR_PAGO: Row[] = [['debito', 23010, 241682974], ['credito', 23185, 240465391], ['efectivo', 23023, 235164334], ['qr', 22982, 234478919], ['desconocido', 5000, 51326298]];

/* clientes_senal.csv (generar_senal.py) */
export const CLIENTES_HEAD: Row[] = [[50, 4, 9131, 1, 76, 'frecuente', 18441, 1], [20, 3, 4645, 2, 51, 'ocasional', 9650, 0], [43, 9, 10329, 0, 31, 'frecuente', 28233, 1], [19, 6, 9472, 1, 68, 'frecuente', 22120, 1], [32, 3, 5619, 0, 38, 'ocasional', 13626, 0]];
export const CLIENTES_COLS = ['antiguedad_meses', 'visitas_mes', 'ticket_promedio', 'reclamos', 'edad', 'segmento_real', 'gasto_mes_siguiente', 'vuelve'];

/* Resultados de modelos_sklearn.py: 16.000 filas para entrenar y 4.000 para probar */
type ModelResult = Pick<ModelRun, 'metrics' | 'seconds' | 'memoryMb' | 'learned'>;
export const SKLEARN: Record<string, ModelResult> = {
  'regresion:lineal': { metrics: { r2: 0.983, error_medio: 1617, cv: 0.982 }, seconds: 0.017, memoryMb: 1.5, learned: [{ title: 'Coeficientes aprendidos contra la regla real', rows: [['(constante)', '4.972,4', '5.000'], ['antiguedad_meses', '50,24', '50'], ['visitas_mes', '1.507,16', '1.500'], ['ticket_promedio', '0,80', '0,8'], ['reclamos', '−1.503,02', '−1.500'], ['edad', '0,16', '0 (no influye)']] }] },
  'clasificacion:tonto': { metrics: { aciertos: 0.573, cv: 0.5765 }, seconds: 0.002, memoryMb: 0.6 },
  'clasificacion:arbol': { metrics: { aciertos: 0.909, cv: 0.900 }, seconds: 0.051, memoryMb: 1.2, learned: [
    { title: 'Importancia de cada columna', rows: [['antiguedad_meses', '0,477'], ['visitas_mes', '0,423'], ['reclamos', '0,100'], ['ticket_promedio', '0,001'], ['edad', '0,000']] },
    { title: 'Lo que aprendió el árbol contra la regla real', rows: [['antiguedad_meses > 35,5', 'vuelve', 'antiguedad_meses ≥ 36'], ['visitas_mes > 3,5 y reclamos ≤ 1,5', 'vuelve', 'visitas_mes ≥ 4 y reclamos ≤ 1'], ['el resto', 'no vuelve', '']] }] },
  'clasificacion:logistica': { metrics: { aciertos: 0.817, cv: 0.810 }, seconds: 0.044, memoryMb: 1.8 },
  'clasificacion:mlp': { metrics: { aciertos: 0.906, cv: 0.898 }, seconds: 8.135, memoryMb: 2.1 },
  'clustering:kmeans': { metrics: { rand_ajustado: 0.827, rand_sin_escalar: 0.300, silhouette_k3: 0.634 }, seconds: 0.197, memoryMb: 2.2, learned: [
    { title: 'Grupos encontrados contra los segmentos reales', rows: [['grupo 0', '1.991 mayoristas', '19 frecuentes · 1 ocasional'], ['grupo 1', '11.938 ocasionales', '1.008 frecuentes'], ['grupo 2', '5.043 frecuentes', '—']] },
    { title: 'Cuántos grupos elegir (silhouette, más alto es mejor)', rows: [['k = 2', '0,539'], ['k = 3', '0,634 ← el mejor'], ['k = 4', '0,501'], ['k = 5', '0,399']] }] },
};
/* Spark MLlib: valores de referencia (medirlos con modelos_spark.py en el sandbox). Sesión de Spark en YARN incluida */
export const MLLIB: Record<string, ModelResult> = {
  'regresion:lineal': { metrics: { r2: 0.983, error_medio: 1619 }, seconds: 19, memoryMb: 3072 },
  'clasificacion:arbol': { metrics: { aciertos: 0.908 }, seconds: 23, memoryMb: 3072 },
  'clasificacion:logistica': { metrics: { aciertos: 0.816 }, seconds: 22, memoryMb: 3072 },
  'clasificacion:mlp': { metrics: { aciertos: 0.903 }, seconds: 41, memoryMb: 3072 },
  'clustering:kmeans': { metrics: { rand_ajustado: 0.82 }, seconds: 24, memoryMb: 3072 },
};

/* ---------- Catálogo y consultas ---------- */
export const MYSQL_TABLES: CatalogEntry[] = [
  { source: 'mysql', name: 'tienda.productos', kind: 'tabla', rows: 8, columns: [{ name: 'producto', type: 'VARCHAR(20) PK' }, { name: 'categoria', type: 'VARCHAR(20)' }, { name: 'precio', type: 'INT' }] },
  { source: 'mysql', name: 'tienda.sucursales', kind: 'tabla', rows: 4, columns: [{ name: 'sucursal', type: 'VARCHAR(20) PK' }, { name: 'encargado', type: 'VARCHAR(30)' }, { name: 'apertura', type: 'DATE' }] },
  { source: 'mysql', name: 'tienda.ventas', kind: 'tabla', rows: 200000, columns: [{ name: 'id', type: 'INT PK' }, { name: 'fecha', type: 'DATE' }, { name: 'sucursal', type: 'VARCHAR(20)' }, { name: 'producto', type: 'VARCHAR(20)' }, { name: 'cantidad', type: 'INT' }, { name: 'precio', type: 'INT' }] },
  { source: 'mysql', name: 'tienda.resumen_categoria', kind: 'tabla', rows: 0, columns: [{ name: 'categoria', type: 'VARCHAR(20) PK' }, { name: 'unidades', type: 'INT' }, { name: 'facturado', type: 'BIGINT' }] },
];
export const MONGO_COLLECTIONS: CatalogEntry[] = [
  { source: 'mongodb', name: 'tienda.productos', kind: 'colección', rows: 9, columns: [{ name: '_id', type: 'string' }, { name: 'categoria', type: 'string' }, { name: 'precio', type: 'int' }, { name: '… y los suyos', type: 'cada uno distinto' }] },
  { source: 'mongodb', name: 'tienda.clientes', kind: 'colección', rows: 2000, columns: [{ name: '_id', type: 'int' }, { name: 'nombre', type: 'string' }, { name: 'email / telefono', type: 'solo algunos' }, { name: 'mayorista', type: 'subdocumento, a veces' }] },
  { source: 'mongodb', name: 'tienda.pedidos', kind: 'colección', rows: 20000, columns: [{ name: '_id', type: 'int' }, { name: 'cliente_id', type: 'int' }, { name: 'fecha', type: 'date' }, { name: 'items', type: 'array de subdocumentos' }, { name: 'entrega / cupon', type: 'subdocumento, a veces' }] },
];

const money = (n: number) => n;
export const EXAMPLES: Record<string, { label: string; text: string }[]> = {
  hive: [
    { label: 'Ventas por producto', text: 'SELECT producto, SUM(cantidad) AS unidades,\n       SUM(CAST(cantidad AS BIGINT) * precio) AS facturado\nFROM ventas\nGROUP BY producto\nORDER BY facturado DESC;' },
    { label: 'Ventas por sucursal', text: 'SELECT sucursal, COUNT(*) AS tickets,\n       SUM(CAST(cantidad AS BIGINT) * precio) AS facturado\nFROM ventas\nGROUP BY sucursal\nORDER BY facturado DESC;' },
    { label: 'Primeras filas', text: 'SELECT * FROM ventas LIMIT 5;' },
  ],
  mysql: [
    { label: 'Productos', text: 'SELECT * FROM productos;' },
    { label: 'Sucursales', text: 'SELECT * FROM sucursales;' },
    { label: 'Facturación por categoría (JOIN)', text: 'SELECT p.categoria, SUM(v.cantidad) AS unidades,\n       SUM(v.cantidad * v.precio) AS facturado\nFROM ventas v JOIN productos p ON v.producto = p.producto\nGROUP BY p.categoria\nORDER BY facturado DESC;' },
  ],
  mongodb: [
    { label: 'Un documento entero', text: 'db.productos.findOne({ _id: "termo" })' },
    { label: 'Accesorios y su precio', text: 'db.productos.find({ categoria: "accesorios" }, { precio: 1 })' },
    { label: 'Contar pedidos', text: 'db.pedidos.countDocuments()' },
  ],
};

/** Resultado de las consultas de ejemplo; otra consulta devuelve una nota */
export function answer(source: string, text: string): Omit<QueryResult, 'ms' | 'appId'> {
  const q = text.toLowerCase().replace(/\s+/g, ' ');
  if (source === 'mysql') {
    if (/join/.test(q) && /categoria/.test(q)) return { columns: ['categoria', 'unidades', 'facturado'], rows: POR_CATEGORIA };
    if (/from productos/.test(q)) return { columns: ['producto', 'categoria', 'precio'], rows: [['yerba', 'infusiones', 2500], ['cafe', 'infusiones', 6500], ['mate', 'accesorios', 8000], ['bombilla', 'accesorios', 3000], ['termo', 'accesorios', 35000], ['azucar', 'almacen', 1200], ['galletitas', 'almacen', 1800], ['facturas', 'panaderia', 900]] };
    if (/from sucursales/.test(q)) return { columns: ['sucursal', 'encargado', 'apertura'], rows: [['Centro', 'Laura Gomez', '2015-03-01'], ['Norte', 'Martin Diaz', '2018-08-15'], ['Sur', 'Sofia Perez', '2020-02-10'], ['Oeste', 'Diego Romero', '2022-11-05']] };
    if (/group by sucursal/.test(q)) return { columns: ['sucursal', 'tickets', 'facturado'], rows: POR_SUCURSAL };
    if (/from ventas/.test(q) && /limit/.test(q)) return { columns: ['id', 'fecha', 'sucursal', 'producto', 'cantidad', 'precio'], rows: VENTAS_HEAD.map((r, i) => [i + 1, ...r]) };
    if (/show tables/.test(q)) return { columns: ['Tables_in_tienda'], rows: [['productos'], ['resumen_categoria'], ['sucursales'], ['ventas']] };
  }
  if (source === 'hive') {
    if (/group by producto/.test(q)) return { columns: ['producto', 'unidades', 'facturado'], rows: POR_PRODUCTO.map(r => [r[0], r[1], money(r[2] as number)]) };
    if (/group by sucursal/.test(q)) return { columns: ['sucursal', 'tickets', 'facturado'], rows: POR_SUCURSAL };
    if (/from ventas/.test(q) && /limit/.test(q)) return { columns: ['fecha', 'sucursal', 'producto', 'cantidad', 'precio'], rows: VENTAS_HEAD };
    if (/show tables/.test(q)) return { columns: ['tab_name'], rows: [['ventas']] };
  }
  if (source === 'mongodb') {
    if (/findone/.test(q) && /termo/.test(q)) return { columns: ['documento'], rows: [['{ _id: "termo", categoria: "accesorios", precio: 35000,\n  capacidad_l: 1, material: "acero inoxidable", garantia_meses: 24,\n  colores: ["negro", "verde", "rojo"],\n  resenas: [\n    { cliente_id: 12, estrellas: 5, texto: "Mantiene el agua caliente todo el dia" },\n    { cliente_id: 87, estrellas: 4, texto: "Muy bueno, un poco pesado" },\n    { cliente_id: 301, estrellas: 2, texto: "Llego con un golpe" } ] }']] };
    if (/accesorios/.test(q)) return { columns: ['documento'], rows: [['{ _id: "mate", precio: 8000 }'], ['{ _id: "bombilla", precio: 3000 }'], ['{ _id: "termo", precio: 35000 }']] };
    if (/pedidos.countdocuments/.test(q)) return { columns: ['resultado'], rows: [[20000]] };
    if (/clientes.countdocuments/.test(q)) return { columns: ['resultado'], rows: [[2000]] };
    if (/show collections/.test(q)) return { columns: ['colección'], rows: [['clientes'], ['pedidos'], ['productos']] };
  }
  return { columns: [], rows: [], note: 'En modo demo solo corren las consultas de ejemplo. Con el cluster real, esta consulta va directo al motor.' };
}
