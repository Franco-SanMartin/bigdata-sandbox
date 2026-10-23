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

export const mongodb: Practice = {
  id: 'mongodb', guide: '10', guideFile: '10-mongodb.md',
  title: 'MongoDB: documentos e índices',
  summary: 'Leés un documento entero, filtrás con find, agrupás con aggregate y comparás una búsqueda con índice y sin índice.',
  minutes: 15, cap: 'mongodb',
  learn: ['Un documento guarda listas y subdocumentos adentro: no hace falta un JOIN', 'aggregate es un pipeline de etapas: $match, $group, $sort', 'Con índice lee solo lo que coincide (IXSCAN); sin índice recorre todo (COLLSCAN)'],
  steps: [
    {
      id: 'findone', title: 'Un documento entero',
      command: `mongosh tienda --eval '${MONGO_FINDONE}'`, input: 'La colección productos',
      does: 'Trae el documento del termo con sus colores y reseñas adentro.', expect: 'El termo con sus reseñas',
      run: async c => {
        const r = await runQuery(c, 'mongodb', MONGO_FINDONE);
        return { ...r, out: { kind: 'text', text: r.rows.map(x => String(x[0])).join('\n') }, vars: { findone: rowsCheck(r.rows, { has: 'termo' }).ok ? '1' : '' } };
      },
      verify: async c => (c.vars.findone ? { ok: true, detail: 'Vino el termo' } : rowsCheck((await c.api.query('mongodb', MONGO_FINDONE)).rows, { has: 'termo' })),
    },
    {
      id: 'find', title: 'Filtrar con find',
      command: `mongosh tienda --eval '${MONGO_FIND}'`, input: 'productos de la categoría accesorios',
      does: 'Filtra por categoría y devuelve solo el precio (y el _id, que viene siempre).', expect: 'mate, bombilla y termo',
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
      command: `mongosh tienda --eval '${MONGO_COUNT}'`, input: 'La colección pedidos',
      does: 'Cuenta los documentos de la colección.', expect: '20.000 pedidos',
      run: async c => {
        const r = await runQuery(c, 'mongodb', MONGO_COUNT);
        return { ...r, summary: `${r.rows[0]?.[0] ?? '?'} pedidos`, vars: { count: String(r.rows[0]?.[0] ?? '') } };
      },
      verify: async c => (Number(c.vars.count) > 0 ? { ok: true, detail: `${c.vars.count} pedidos` } : rowsCheck((await c.api.query('mongodb', MONGO_COUNT)).rows)),
    },
    {
      id: 'aggregate', title: 'Agrupar por canal con aggregate',
      command: MONGO_AGG, input: '20.000 pedidos',
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
      command: `${MONGO_IX}\n${MONGO_SCAN}`, input: 'Dos búsquedas en pedidos',
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
