// Consultas de ejemplo sobre la base "tienda" de MongoDB (tienda_mongo.js).
//
// Uso (adentro del contenedor, parado en /datos, con MONGODB=si):
//   mongosh --quiet tienda ejemplos/consultas_mongo.js
// o abrir la consola (mongosh tienda) y copiar las consultas de a una: ahi no
// hacen falta el printjson ni el .toArray(), la consola muestra el resultado.
//
// Al lado de cada una, como seria en SQL (en la base MySQL "tienda").

function titulo(t) { print("\n=== " + t + " ==="); }

titulo("1. Un documento entero: el termo, con sus colores y resenas adentro");
// SQL: SELECT * FROM productos WHERE producto = 'termo'  (+ JOIN a resenas)
printjson(db.productos.findOne({ _id: "termo" }));

titulo("2. Solo algunos campos: nombre y precio de los accesorios");
// SQL: SELECT producto, precio FROM productos WHERE categoria = 'accesorios'
printjson(db.productos.find({ categoria: "accesorios" }, { precio: 1 }).toArray());

titulo("3. Campos que solo algunos documentos tienen ($exists)");
// En MySQL seria "WHERE email IS NOT NULL", si existiera la columna email
print("clientes con email:     " + db.clientes.countDocuments({ email: { $exists: true } }));
print("clientes con telefono:  " + db.clientes.countDocuments({ telefono: { $exists: true } }));
print("clientes sin ninguno:   " + db.clientes.countDocuments({
  email: { $exists: false }, telefono: { $exists: false } }));
print("clientes mayoristas:    " + db.clientes.countDocuments({ mayorista: { $exists: true } }));

titulo("4. Buscar adentro de un subdocumento y de un array");
// Campo de un subdocumento: con punto. Array: busca en cualquiera de sus elementos
print("mayoristas con 15% de descuento: " +
      db.clientes.countDocuments({ "mayorista.descuento_pct": 15 }));
print("clientes con alguna direccion en Quilmes: " +
      db.clientes.countDocuments({ "direcciones.ciudad": "Quilmes" }));
print("productos que vienen en color negro: " +
      db.productos.find({ colores: "negro" }, { _id: 1 }).toArray().map(p => p._id).join(", "));

titulo("5. Agregacion: unidades y facturado por producto ($unwind + $group)");
// $unwind abre cada pedido en un documento por item: es el JOIN de SQL al reves.
// SQL: SELECT producto, SUM(cantidad), SUM(cantidad*precio) FROM items_pedido
//      GROUP BY producto ORDER BY 3 DESC
printjson(db.pedidos.aggregate([
  { $unwind: "$items" },
  { $group: { _id: "$items.producto",
              unidades: { $sum: "$items.cantidad" },
              facturado: { $sum: { $multiply: ["$items.cantidad", "$items.precio"] } } } },
  { $sort: { facturado: -1 } }
]).toArray());

titulo("6. Agregacion: pedidos y ticket promedio por canal y forma de entrega");
printjson(db.pedidos.aggregate([
  { $group: { _id: { canal: "$canal", entrega: "$entrega.tipo" },
              pedidos: { $sum: 1 }, ticket_promedio: { $avg: "$total" } } },
  { $project: { pedidos: 1, ticket_promedio: { $round: ["$ticket_promedio", 0] } } },
  { $sort: { pedidos: -1 } }
]).toArray());

titulo("7. JOIN con $lookup: los 3 mejores clientes, con su nombre");
// SQL: SELECT c.nombre, SUM(p.total) FROM pedidos p JOIN clientes c ...
printjson(db.pedidos.aggregate([
  { $group: { _id: "$cliente_id", gastado: { $sum: "$total" }, pedidos: { $sum: 1 } } },
  { $sort: { gastado: -1 } },
  { $limit: 3 },
  { $lookup: { from: "clientes", localField: "_id", foreignField: "_id", as: "cliente" } },
  { $project: { gastado: 1, pedidos: 1, nombre: { $first: "$cliente.nombre" } } }
]).toArray());

titulo("8. Indices: la busqueda por cliente usa el indice (IXSCAN), no recorre todo");
// Sin indice diria COLLSCAN: lee los 20.000 pedidos para encontrar unos pocos
const plan = db.pedidos.find({ cliente_id: 42 }).explain("executionStats");
print("etapa: " + plan.queryPlanner.winningPlan.inputStage.stage +
      " | documentos leidos: " + plan.executionStats.totalDocsExamined +
      " | devueltos: " + plan.executionStats.nReturned);

titulo("9. Modificar: agregar un campo a UN documento, sin cambiar los demas");
// En SQL habria que hacer ALTER TABLE productos ADD COLUMN ... (para todas las filas)
db.productos.updateOne({ _id: "mate" }, { $set: { en_oferta: true }, $push: { colores: "rojo" } });
printjson(db.productos.findOne({ _id: "mate" }));
db.productos.updateOne({ _id: "mate" }, { $unset: { en_oferta: "" }, $pull: { colores: "rojo" } });
