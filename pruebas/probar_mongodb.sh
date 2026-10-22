#!/usr/bin/env bash
# Prueba de MongoDB (contenedor prendido con MONGODB=si): que este arriba con
# la memoria limitada, que la base de ejemplo "tienda" tenga exactamente lo
# esperado, que anden las consultas de ejemplo y que aparezca en 'estado'.
# GitHub Actions la corre antes de publicar la version base.
#
# A mano, con el contenedor prendido y en "Cluster LISTO":
#   docker cp pruebas/probar_mongodb.sh bigdata:/tmp/probar_mongodb.sh
#   docker exec bigdata bash /tmp/probar_mongodb.sh
# Deja la base "tienda" como estaba (crea y borra una coleccion "prueba").
set -euo pipefail
cd /datos

paso() { echo; echo "=== $* ==="; }
falla() { echo "FALLA: $*" >&2; tail -20 /var/log/mongodb/mongod.log >&2 || true; exit 1; }
m() { mongosh --quiet tienda --eval "$1"; }   # resultado de una expresion de mongosh
igual() { # $1=descripcion $2=valor $3=esperado
  echo "$1: $2"
  [ "$2" = "$3" ] || falla "$1 da $2 y tendria que dar $3"
}

paso "MongoDB prendido, como usuario mongodb y con la memoria limitada"
netstat -tln | grep -q ":27017 " || falla "MongoDB no escucha en el puerto 27017"
pgrep -u mongodb -x mongod > /dev/null || falla "mongod no corre como el usuario mongodb"
m 'db.version()'
igual "cache de WiredTiger (bytes)" \
  "$(m 'db.serverStatus().wiredTiger.cache["maximum bytes configured"]')" 268435456
echo "memoria de mongod: $(ps -o rss= -C mongod | awk '{print int($1/1024)}') MB"

paso "Base de ejemplo 'tienda'"
igual "productos" "$(m 'db.productos.countDocuments()')" 9
igual "clientes" "$(m 'db.clientes.countDocuments()')" 2000
igual "pedidos" "$(m 'db.pedidos.countDocuments()')" 20000
# Campos variables: cada producto con los suyos, clientes con lo que dejaron
igual "campos del termo" "$(m 'Object.keys(db.productos.findOne({_id: "termo"})).length')" 8
igual "campos del azucar" "$(m 'Object.keys(db.productos.findOne({_id: "azucar"})).length')" 5
igual "productos con resenas" "$(m 'db.productos.countDocuments({resenas: {$exists: true}})')" 1
igual "clientes con email" "$(m 'db.clientes.countDocuments({email: {$exists: true}})')" 1417
igual "clientes mayoristas" "$(m 'db.clientes.countDocuments({mayorista: {$exists: true}})')" 101
igual "pedidos con cupon" "$(m 'db.pedidos.countDocuments({cupon: {$exists: true}})')" 2014
# Mismos datos en cualquier compu (semilla fija)
igual "suma de los totales de los pedidos" \
  "$(m 'db.pedidos.aggregate([{$group: {_id: null, t: {$sum: "$total"}}}]).toArray()[0].t')" 441242420
igual "unidades de yerba" \
  "$(m 'db.pedidos.aggregate([{$unwind: "$items"}, {$match: {"items.producto": "yerba"}},
        {$group: {_id: null, u: {$sum: "$items.cantidad"}}}]).toArray()[0].u')" 32734
igual "indices de pedidos" "$(m 'db.pedidos.getIndexes().map(i => i.name).sort().join(",")')" \
  "_id_,cliente_id_1,items.producto_1"

paso "Consultas de ejemplo (ejemplos/consultas_mongo.js)"
mongosh --quiet tienda ejemplos/consultas_mongo.js > /tmp/consultas_mongo.txt
cat /tmp/consultas_mongo.txt | head -40
grep -q "etapa: IXSCAN" /tmp/consultas_mongo.txt || falla "la busqueda por cliente no usa el indice"
grep -q "en_oferta: true" /tmp/consultas_mongo.txt || falla "no se vio el campo agregado con updateOne"
igual "el mate quedo como estaba" "$(m 'db.productos.findOne({_id: "mate"}).en_oferta === undefined')" true

paso "Escribir, leer y borrar"
m 'db.prueba.insertMany([{x: 1}, {x: 2, nuevo: "campo"}]).insertedIds.length' > /dev/null
igual "documentos en la coleccion nueva" "$(m 'db.prueba.countDocuments({x: {$gte: 1}})')" 2
m 'db.prueba.drop()' > /dev/null

paso "estado"
estado | tee /tmp/estado.txt
grep -q "MongoDB (base tienda).*arriba" /tmp/estado.txt || falla "estado no muestra MongoDB arriba"

echo
echo "TODO OK: MongoDB con la base de ejemplo"
