/* Guía 10: MongoDB. Documentos, find, aggregate e índices. */
import { rowsCheck, runQuery } from './comun';
import type { Practice } from './tipos';

export const MONGO_FINDONE = 'db.productos.findOne({ _id: "termo" })';
export const MONGO_FIND = 'db.productos.find({ categoria: "accesorios" }, { precio: 1 })';
export const MONGO_COUNT = 'db.pedidos.countDocuments()';
export const MONGO_AGG = `db.pedidos.aggregate([
  { $group: { _id: "$canal", pedidos: { $sum: 1 }, facturado: { $sum: "$total" } } },
  { $sort: { facturado: -1 } }
])`;
export const MONGO_IX = 'db.pedidos.find({ cliente_id: 42 }).explain("executionStats")';
export const MONGO_SCAN = 'db.pedidos.find({ canal: "telefono" }).explain("executionStats")';

const EN = 'En mongosh (mongosh tienda)';
const sh = (js: string) => `mongosh tienda --eval '${js}'`;
const CONT = 'MongoDB guarda la base tienda en el contenedor (en /data/db): no está en HDFS';

export const mongodb: Practice = {
  id: 'mongodb', guide: '10', guideFile: '10-mongodb.md',
  title: 'MongoDB: documentos e índices',
  summary: 'Leés un documento entero, filtrás con find, agrupás con aggregate y comparás una búsqueda con índice y sin índice.',
  minutes: 15, cap: 'mongodb',
  learn: ['Un documento guarda listas y subdocumentos adentro: no hace falta un JOIN', 'aggregate es un pipeline de etapas: $match, $group, $sort', 'Con índice lee solo lo que coincide (IXSCAN); sin índice recorre todo (COLLSCAN)'],
  steps: [
    {
      id: 'findone', title: 'Un documento entero',
      command: sh(MONGO_FINDONE), input: 'La colección productos',
      does: 'Trae el documento del termo con sus colores y reseñas adentro.', expect: 'El termo con sus reseñas',
      pregunta: {
        enunciado: 'Ahora queremos traer el documento entero del termo (su _id es "termo") de la colección productos. ¿Cuál es el comando correcto?',
        opciones: [
          { cmd: sh(MONGO_FINDONE), correcta: true, porque: 'mongosh tienda entra a la base tienda y --eval corre el código: findOne({ _id: "termo" }) trae el primer documento que coincide con ese filtro.' },
          { cmd: `mongosh --eval '${MONGO_FINDONE}'`, porque: 'Sin tienda, mongosh entra a la base test, donde no hay productos: devuelve null.' },
          { cmd: sh('db.productos.findOne(_id: "termo")'), porque: 'El filtro va entre llaves: es un documento { campo: valor }. Sin llaves es un error de sintaxis de JavaScript.' },
          { cmd: sh('SELECT * FROM productos WHERE _id = "termo"'), porque: 'MongoDB no habla SQL: mongosh espera JavaScript, con db.colección.método(…).' },
        ],
      },
      donde: { contenedor: CONT, compu: 'El documento, acá abajo: las listas y subdocumentos vienen adentro' },
      run: async c => {
        const r = await runQuery(c, 'mongodb', MONGO_FINDONE);
        return { ...r, out: { kind: 'text', text: r.rows.map(x => String(x[0])).join('\n') }, vars: { findone: rowsCheck(r.rows, { has: 'termo' }).ok ? '1' : '' } };
      },
      verify: async c => (c.vars.findone ? { ok: true, detail: 'Vino el termo' } : rowsCheck((await c.api.query('mongodb', MONGO_FINDONE)).rows, { has: 'termo' })),
    },
    {
      id: 'find', title: 'Filtrar con find',
      command: sh(MONGO_FIND), input: 'productos de la categoría accesorios',
      does: 'Filtra por categoría y devuelve solo el precio (y el _id, que viene siempre).', expect: 'mate, bombilla y termo',
      pregunta: {
        enunciado: 'Ahora queremos los productos de la categoría accesorios, pero solo con su precio. ¿Cuál es el comando correcto?',
        opciones: [
          { cmd: sh(MONGO_FIND), correcta: true, porque: 'find recibe primero el filtro ({ categoria: "accesorios" }) y después la proyección ({ precio: 1 }): qué campos devolver. El _id viene siempre.' },
          { cmd: sh('db.productos.find({ precio: 1 }, { categoria: "accesorios" })'), porque: 'Los argumentos están al revés: el primero es el filtro. Así busca productos con precio 1, y no hay ninguno.' },
          { cmd: sh('db.productos.find({ categoria: accesorios }, { precio: 1 })'), porque: 'Sin comillas, accesorios es una variable de JavaScript que no existe: ReferenceError.' },
          { cmd: sh('db.productos.find({ categoria: "accesorios", precio: 1 })'), porque: 'Todo en un solo documento es un filtro con dos condiciones: accesorios Y precio igual a 1. No trae nada.' },
        ],
      },
      donde: { contenedor: CONT, compu: 'Los accesorios con su precio, acá abajo' },
      run: async c => {
        const r = await runQuery(c, 'mongodb', MONGO_FIND);
        return { ...r, vars: { find: String(r.rows.length) } };
      },
      verify: async c => {
        const n = Number(c.vars.find ?? (await c.api.query('mongodb', MONGO_FIND)).rows.length);
        return n > 0 ? { ok: true, detail: `${n} accesorio(s)` } : { ok: false, detail: 'No vino ningún accesorio' };
      },
    },
    {
      id: 'contar', title: 'Contar los pedidos',
      command: sh(MONGO_COUNT), input: 'La colección pedidos',
      pregunta: {
        enunciado: 'Ahora queremos saber cuántos documentos tiene la colección pedidos. ¿Cuál es el comando correcto?',
        opciones: [
          { cmd: sh(MONGO_COUNT), correcta: true, porque: 'countDocuments() es un método de la colección: sin filtro, cuenta todos sus documentos.' },
          { cmd: sh('db.pedido.countDocuments()'), porque: 'La colección se llama pedidos: pedido no existe, y MongoDB contesta 0 sin quejarse (una colección que no existe está vacía).' },
          { cmd: sh('db.countDocuments("pedidos")'), porque: 'countDocuments es de la colección, no de la base: db.countDocuments no existe (TypeError).' },
          { cmd: sh('db.pedidos.countDocuments'), porque: 'Sin paréntesis no se llama a la función: mongosh te muestra la función en vez del número.' },
        ],
      },
      donde: { contenedor: CONT, compu: 'El total, acá abajo' },
      does: 'Cuenta los documentos de la colección.', expect: '20.000 pedidos',
      run: async c => {
        const r = await runQuery(c, 'mongodb', MONGO_COUNT);
        return { ...r, summary: `${r.rows[0]?.[0] ?? '?'} pedidos`, vars: { count: String(r.rows[0]?.[0] ?? '') } };
      },
      verify: async c => (Number(c.vars.count) > 0 ? { ok: true, detail: `${c.vars.count} pedidos` } : rowsCheck((await c.api.query('mongodb', MONGO_COUNT)).rows)),
    },
    {
      id: 'aggregate', title: 'Agrupar por canal con aggregate',
      command: MONGO_AGG, en: EN, input: '20.000 pedidos',
      pregunta: {
        enunciado: 'Ahora queremos, por canal, cuántos pedidos hubo y cuánto se facturó, del canal que más facturó al que menos. ¿Cuál es el pipeline correcto?',
        opciones: [
          { cmd: MONGO_AGG, correcta: true, porque: '$group junta por _id: "$canal" (el $ dice que es un campo), $sum: 1 cuenta y $sum: "$total" suma. Después $sort con -1 ordena de mayor a menor.' },
          { cmd: MONGO_AGG.replace('_id: "$canal"', 'canal: "$canal"'), porque: '$group necesita la clave en _id: sin _id da error (a group specification must include an _id).' },
          { cmd: MONGO_AGG.replace('_id: "$canal"', '_id: "canal"'), porque: 'Sin el $, "canal" es un texto fijo y no el campo: todos los pedidos caen en un solo grupo.' },
          { cmd: MONGO_AGG.replace('facturado: -1', 'facturado: 1'), porque: 'Con 1 ordena de menor a mayor: arriba queda el canal que menos facturó.' },
        ],
      },
      donde: { contenedor: 'Todo corre adentro de MongoDB, etapa por etapa: no pasa por YARN', compu: 'Una fila por canal, acá abajo' },
      does: '$group junta los pedidos por canal y suma; $sort los ordena por facturado.', expect: 'Una fila por canal con pedidos y facturado',
      run: async c => {
        const r = await runQuery(c, 'mongodb', MONGO_AGG);
        return { ...r, vars: { agg: r.rows.length ? '1' : c.api.mode === 'demo' ? 'demo' : '' } };
      },
      verify: async c => {
        if (c.vars.agg === '1') return { ok: true, detail: 'Vino una fila por canal' };
        if (c.vars.agg === 'demo') return { ok: true, detail: 'En el modo demo esta consulta no trae filas; con el cluster real da una por canal' };
        return rowsCheck((await c.api.query('mongodb', MONGO_AGG)).rows);
      },
    },
    {
      id: 'indice', title: 'Con índice y sin índice',
      command: `${MONGO_IX}\n${MONGO_SCAN}`, en: EN, input: 'Dos búsquedas en pedidos',
      pregunta: {
        enunciado: 'Ahora queremos comparar cómo busca MongoDB por cliente_id (que tiene índice) y por canal (que no), y cuántos documentos lee en cada caso. ¿Cuál es el correcto?',
        opciones: [
          { cmd: `${MONGO_IX}\n${MONGO_SCAN}`, correcta: true, porque: 'explain("executionStats") muestra el plan que eligió (IXSCAN o COLLSCAN) y lo que pasó de verdad: totalDocsExamined dice cuántos documentos leyó.' },
          { cmd: `${MONGO_IX.replace('"executionStats"', '')}\n${MONGO_SCAN.replace('"executionStats"', '')}`, porque: 'Sin executionStats, explain muestra el plan elegido pero no cuántos documentos leyó: no se ve la diferencia de trabajo.' },
          { cmd: 'db.pedidos.find({ cliente_id: 42 }).count()\ndb.pedidos.find({ canal: "telefono" }).count()', porque: 'count dice cuántos coinciden, no cómo los buscó: para ver IXSCAN o COLLSCAN hace falta explain.' },
          { cmd: `db.pedidos.createIndex({ canal: 1 })\n${MONGO_SCAN}`, porque: 'createIndex agrega un índice por canal: cambia la base y después las dos búsquedas usan índice, así que no hay nada que comparar.' },
        ],
      },
      donde: { contenedor: 'Los índices viven en MongoDB, al lado de la colección: cliente_id_1 está; por canal no hay', compu: 'Los dos planes, acá abajo' },
      does: 'Por cliente_id usa el índice cliente_id_1; por canal no hay índice y recorre la colección.', expect: 'IXSCAN en la primera, COLLSCAN en la segunda',
      run: async c => {
        const a = await c.api.explain('mongodb', MONGO_IX);
        const b = await c.api.explain('mongodb', MONGO_SCAN);
        const ix = a.raw.join('\n'); const scan = b.raw.join('\n');
        const ok = /IXSCAN/.test(ix) && /COLLSCAN/.test(scan);
        return { summary: ok ? 'cliente_id usa el índice; canal recorre todo' : 'Los planes no son los esperados', out: { kind: 'text', text: `// por cliente_id\n${ix}\n\n// por canal\n${scan}` }, vars: { ix: ok ? '1' : '' } };
      },
      verify: async c => (c.vars.ix ? { ok: true, detail: 'IXSCAN y COLLSCAN' } : { ok: false, detail: 'No dio IXSCAN para cliente_id y COLLSCAN para canal' }),
      tip: 'Un índice acelera las lecturas y hace un poco más lentas las escrituras: no conviene indexar todo.',
    },
  ],
};
