#!/usr/bin/env bash
# Escenarios que probar.sh no cubre: reinicios, alta disponibilidad, cada
# valor de SERVICIOS, cambiar parametros sobre un volumen que ya existe,
# parametros invalidos, volumenes de versiones anteriores, un primer
# arranque cortado a la mitad, MongoDB y la version ml. Corre en la compu
# (necesita docker), con la imagen ya bajada o armada:
#   bash pruebas/escenarios.sh <escenario>      (sin argumento: los lista)
#   IMAGEN=franki678/bigdata-sandbox:ml bash pruebas/escenarios.sh ml
# En Windows, desde Git Bash: MSYS_NO_PATHCONV=1 bash pruebas/escenarios.sh ...
# GitHub Actions la corre con la imagen publicada (workflow "Escenarios").
set -eu   # sin pipefail: 'docker logs | grep -q' cortaria el pipe y daria error
cd "$(dirname "$0")/.."

IMAGEN=${IMAGEN:-franki678/bigdata-sandbox}
# Contenedor y volumen de prueba. Para correr varios escenarios a la vez en la
# misma compu, cada uno con otro nombre: C=prueba2 bash pruebas/escenarios.sh ha
C=${C:-bigdata-prueba}
V=${V:-$C-vol}
CHICO=(-e DATANODES=2 -e REPLICATION=2 -e BLOCK_SIZE=1m)
T=$(mktemp -d)   # logs de esta corrida
# Version de la imagen (base, ml...). Vacia: la imagen de antes de las
# versiones (sin MONGODB ni JUPYTER)
VERSION=$(docker image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$IMAGEN" \
          | sed -n 's/^SANDBOX_VERSION=//p')

paso()  { echo; echo "=== $* ==="; }
falla() { echo "FALLA: $*" >&2; docker logs --tail 80 "$C" 2>&1 || true; exit 1; }
en()    { docker exec "$C" bash -c "$1"; }

limpiar() { docker rm -f "$C" > /dev/null 2>&1 || true; docker volume rm -f "$V" > /dev/null 2>&1 || true; }
trap 'limpiar; rm -rf "$T"' EXIT

prender() { # crea el contenedor con el volumen de prueba; args = -e ...
  docker rm -f "$C" > /dev/null 2>&1 || true
  docker run -d --name "$C" -v "$V:/hadoop" "$@" "$IMAGEN" > /dev/null
}

listo() { # espera el "Cluster LISTO" numero $1 en el log (1 por arranque)
  local n=$1 i
  for i in $(seq 1 150); do
    [ "$(docker logs "$C" 2>&1 | grep -c 'Cluster LISTO')" -ge "$n" ] && return 0
    [ "$(docker inspect -f '{{.State.Running}}' "$C")" = true ] || falla "el contenedor se apago solo"
    sleep 4
  done
  falla "no llego a 'Cluster LISTO' en 10 minutos"
}

esperar_log() { # espera que aparezca $1 en el log (para cortar en ese momento)
  local i
  for i in $(seq 1 1200); do
    docker logs "$C" 2>&1 | grep -q "$1" && return 0
    sleep 0.5
  done
  falla "no aparecio en el log: $1"
}

probar() { # $1=prueba de pruebas/ (por defecto probar.sh)
  local p=${1:-probar.sh}
  docker cp "pruebas/$p" "$C":/tmp/"$p"
  en "bash /tmp/$p" > "$T/$p.log" 2>&1 || { tail -80 "$T/$p.log"; falla "$p"; }
  tail -3 "$T/$p.log"
}

archivo_de() { # $1=archivo adentro del contenedor (aunque este apagado) -> stdout
  docker cp "$C:$1" - | tar -xO
}

leer_ok() { # el archivo de ventas se lee entero
  en "hdfs dfs -cat /user/root/ventas/ventas_grandes.csv | md5sum" | grep -q 2a5af82c1a6e8a4385b86a144f5a5589 \
    || falla "no se pudo leer bien /user/root/ventas/ventas_grandes.csv"
}

subir_ventas() {
  en "cd /datos && python3 ejemplos/generar_ventas.py > /dev/null && hdfs dfs -mkdir -p /user/root/ventas \
      && hdfs dfs -put -f ventas_grandes.csv /user/root/ventas/"
}

apagar_bien() { # docker stop: tiene que apagar todo en orden antes de que Docker corte (10 s de fabrica, 3 en algunos Docker Desktop)
  local t0 t
  t0=$(date +%s)
  docker stop "$C" > /dev/null
  t=$(( $(date +%s) - t0 ))
  echo "docker stop tardo $t s, codigo de salida $(docker inspect -f '{{.State.ExitCode}}' "$C")"
  docker logs "$C" 2>&1 | grep -q 'Apagando el cluster' || falla "docker stop no paso por el apagado ordenado"
  [ "$(docker inspect -f '{{.State.ExitCode}}' "$C")" = 0 ] || falla "docker stop termino matando procesos"
  if archivo_de /var/log/mysql/error.log > "$T"/mysql-error.log 2> /dev/null; then
    tail -3 "$T"/mysql-error.log
    tail -5 "$T"/mysql-error.log | grep -q 'Shutdown complete' || falla "MySQL no se apago en orden"
  fi
  if archivo_de /var/log/mongodb/mongod.log > "$T"/mongod.log 2> /dev/null; then
    tail -1 "$T"/mongod.log
    tail -5 "$T"/mongod.log | grep -q '"Shutting down","attr":{"exitCode":0}' || falla "MongoDB no se apago en orden"
  fi
}

hive_sql() { en "beeline -u jdbc:hive2://localhost:10000 --silent=true --outputformat=csv2 -e \"$1\" 2>/dev/null"; }

# ---------------------------------------------------------------------------
reinicio() {
  paso "Arranque + prueba completa"
  prender "${CHICO[@]}"; listo 1
  probar
  en "ls /datos" | grep -q derby.log && falla "quedo un derby.log en /datos"

  paso "docker stop / docker start"
  apagar_bien
  docker start "$C" > /dev/null; listo 2
  docker logs "$C" 2>&1 | sed -n '/Cluster LISTO/,$p' | grep 'Primer arranque' && falla "repitio un primer arranque"

  paso "Todo sigue ahi"
  leer_ok
  hive_sql "SHOW TABLES" | grep -qx tienda_ventas || falla "se perdio la tabla de Hive"
  en "mysql -N -B -e 'SELECT COUNT(*) FROM tienda.resumen_categoria'" | grep -qx 4 \
    || falla "se perdio lo exportado a MySQL"

  paso "Prueba completa despues de reiniciar"
  probar

  paso "docker restart"
  docker restart "$C" > /dev/null; listo 3
  leer_ok
}

# ---------------------------------------------------------------------------
ha() {
  paso "Arranque con 2 NameNodes (HA) + prueba completa"
  prender -e NAMENODES=2 -e DATANODES=3 -e REPLICATION=2 -e BLOCK_SIZE=1m; listo 1
  en namenode
  probar

  paso "Se cae el NameNode activo"
  local activo otro i
  activo=$(en namenode | awk '/active/ {print $2}')
  [ -n "$activo" ] || falla "no hay NameNode activo"
  otro=$((3 - activo))
  en "namenode stop $activo"
  for i in $(seq 1 30); do
    en namenode | grep -q "NameNode $otro .*active" && break
    sleep 2
  done
  en namenode
  en namenode | grep -q "NameNode $otro .*active" || falla "el NameNode $otro no tomo el control"
  leer_ok
  hive_sql "SELECT COUNT(*) FROM ventas" | grep -qx 200000 || falla "Hive no anda despues del failover"

  paso "Vuelve el caido: queda standby"
  en "namenode start $activo"
  sleep 15
  en namenode
  en namenode | grep -q "NameNode $activo .*standby" || falla "el NameNode $activo no volvio como standby"

  paso "Reinicio con HA"
  apagar_bien
  docker start "$C" > /dev/null; listo 2
  en namenode
  [ "$(en namenode | grep -c active)" = 1 ] || falla "despues de reiniciar no hay un (solo un) activo"
  leer_ok
}

# ---------------------------------------------------------------------------
servicios() {
  paso "SERVICIOS=hdfs (y JUPYTER=si: en la version ml prende, en las otras avisa)"
  prender "${CHICO[@]}" -e SERVICIOS=hdfs -e JUPYTER=si; listo 1
  en estado
  en "netstat -tln" | grep -qE ':(8088|3306|10000|27017) ' && falla "con SERVICIOS=hdfs hay servicios de mas prendidos"
  case "$VERSION" in
    ml) en "netstat -tln" | grep -q ':8888 ' || falla "JupyterLab no prendio con SERVICIOS=hdfs" ;;
    "") ;;   # imagen de antes de las versiones: no sabe de JUPYTER
    *) docker logs "$C" 2>&1 | grep -q 'no trae JupyterLab' || falla "no aviso que esta version no trae JupyterLab" ;;
  esac
  subir_ventas; leer_ok
  en "pig -x local -param entrada=/datos/ejemplos/texto.txt /datos/ejemplos/wordcount.pig 2>/dev/null" \
    | grep -q '^(datos,3)$' || falla "pig -x local con SERVICIOS=hdfs"

  paso "SERVICIOS=mapreduce, mismo volumen (MySQL se crea recien ahora)"
  prender "${CHICO[@]}" -e SERVICIOS=mapreduce; listo 1
  en estado
  en "netstat -tln" | grep -q ':10000 ' && falla "con SERVICIOS=mapreduce Hive esta prendido"
  leer_ok
  en "cd /datos && bash ejemplos/sqoop.sh" > "$T"/sqoop-mr.log 2>&1 || { tail -40 "$T"/sqoop-mr.log; falla "sqoop.sh con SERVICIOS=mapreduce"; }
  grep -q 'Hive no esta prendido' "$T"/sqoop-mr.log || falla "sqoop.sh no aviso que falta Hive"
  [ "$(en "hdfs dfs -ls /user/root/tienda/ventas" | grep -c part-m-)" = 4 ] || falla "sqoop import con SERVICIOS=mapreduce"
  en "cd /datos && pig ejemplos/ventas.pig > /dev/null 2>&1" || falla "pig con SERVICIOS=mapreduce"

  paso "SERVICIOS=todo, mismo volumen (Hive y Spark se preparan recien ahora)"
  prender "${CHICO[@]}"; listo 1
  probar
}

# ---------------------------------------------------------------------------
parametros() {
  paso "Parametros invalidos: el contenedor avisa y se apaga"
  local p
  local invalidos=(DATANODES=0 DATANODES=10 NAMENODES=4 REPLICATION=x BLOCK_SIZE=1k BLOCK_SIZE=0m SERVICIOS=spark)
  [ -n "$VERSION" ] && invalidos+=(MONGODB=quizas JUPYTER=1)
  for p in "${invalidos[@]}"; do
    docker rm -f "$C" > /dev/null 2>&1 || true
    if timeout 120 docker run --rm --name "$C" -e "$p" "$IMAGEN" > "$T"/param.log 2>&1; then
      falla "$p arranco igual"
    fi
    grep -q "ERROR:.* ${p%%=*}=" "$T"/param.log || { cat "$T"/param.log; falla "$p sin mensaje claro"; }
    echo "$p -> $(grep 'ERROR' "$T"/param.log)"
  done
  docker rm -f "$C" > /dev/null 2>&1 || true

  paso "Bajar DATANODES con replicacion completa: arranca sin perder nada"
  prender -e DATANODES=3 -e REPLICATION=3 -e BLOCK_SIZE=1m -e SERVICIOS=hdfs; listo 1
  subir_ventas
  prender -e DATANODES=1 -e REPLICATION=3 -e BLOCK_SIZE=1m -e SERVICIOS=hdfs; listo 1
  leer_ok
  en estado

  paso "Subir DATANODES y sumar uno a mano"
  prender -e DATANODES=3 -e REPLICATION=3 -e BLOCK_SIZE=1m -e SERVICIOS=hdfs; listo 1
  en "datanode start 4" ; en datanode
  en datanode | grep -q 'DataNode 4 .*arriba' || falla "datanode start 4"
  # el 4 no esta en DATANODES: apagado ya no se lista
  en "datanode stop 4" ; en datanode | grep -q 'DataNode 4 .*arriba' && falla "datanode stop 4"
  en "datanode stop 3" ; en datanode | grep -q 'DataNode 3 .*APAGADO' || falla "datanode stop 3"
  en "datanode start 3"; en datanode | grep -q 'DataNode 3 .*arriba' || falla "datanode start 3"
  leer_ok

  paso "Bajar DATANODES perdiendo bloques: avisa y arranca igual"
  limpiar
  prender -e DATANODES=3 -e REPLICATION=1 -e BLOCK_SIZE=1m -e SERVICIOS=hdfs; listo 1
  subir_ventas
  prender -e DATANODES=1 -e REPLICATION=1 -e BLOCK_SIZE=1m -e SERVICIOS=hdfs; listo 1
  docker logs "$C" 2>&1 | grep -q 'AVISO: HDFS no salio solo de safe mode' || falla "no aviso de los bloques perdidos"
  en "hdfs dfs -mkdir /user/root/escribe-igual" || falla "HDFS quedo en safe mode"
  en estado

  paso "Cambiar NAMENODES sobre un volumen existente: avisa y sigue con el del volumen"
  prender -e NAMENODES=2 -e DATANODES=1 -e SERVICIOS=hdfs; listo 1
  docker logs "$C" 2>&1 | grep -q 'este volumen se creo con 1 NameNode' || falla "no aviso del cambio de NAMENODES"
  en namenode | grep -q 'sin HA' || falla "cambio a HA sobre un volumen de 1 NameNode"
}

# ---------------------------------------------------------------------------
volumen_viejo() {
  paso "Volumen de una version anterior (sin MySQL, sin marcas nuevas, dfs/data)"
  prender -e DATANODES=1 -e REPLICATION=1 -e BLOCK_SIZE=1m; listo 1
  subir_ventas
  hive_sql "CREATE TABLE previa (x INT)" > /dev/null
  docker rm -f "$C" > /dev/null
  docker run --rm -v "$V:/hadoop" --entrypoint bash "$IMAGEN" -c \
    'rm -rf /hadoop/mysql /hadoop/.metastore-listo /hadoop/namenodes && mv /hadoop/dfs/dn1 /hadoop/dfs/data && ls -a /hadoop /hadoop/dfs'
  prender -e DATANODES=1 -e REPLICATION=1 -e BLOCK_SIZE=1m; listo 1
  docker logs "$C" 2>&1 | grep -q 'inicializando schema del Metastore' && falla "rehizo el metastore de un volumen viejo"
  hive_sql "SHOW TABLES" | grep -qx previa || falla "se perdieron las tablas de Hive"
  en "mysql -N -B -e 'SELECT COUNT(*) FROM tienda.ventas'" | grep -qx 200000 || falla "no creo la base MySQL"
  leer_ok
}

# ---------------------------------------------------------------------------
corte() {
  paso "Se corta el primer arranque mientras se crea el metastore"
  prender "${CHICO[@]}"
  esperar_log 'inicializando schema del Metastore'
  sleep 3; docker kill "$C" > /dev/null
  docker start "$C" > /dev/null; listo 1
  hive_sql "SHOW DATABASES" | grep -qx default || falla "Hive no anda despues del corte"

  paso "Se corta mientras se carga la base MySQL"
  limpiar
  prender "${CHICO[@]}"
  esperar_log "cargando la base de ejemplo 'tienda'"
  docker kill "$C" > /dev/null
  docker start "$C" > /dev/null; listo 1
  en "mysql -N -B -e 'SELECT COUNT(*) FROM tienda.ventas'" | grep -qx 200000 || falla "MySQL no se rehizo"

  paso "Se corta el primer arranque con HA, mientras se copian los metadatos"
  limpiar
  prender -e NAMENODES=2 -e SERVICIOS=hdfs
  esperar_log 'copiando los metadatos al NameNode 2'
  docker kill "$C" > /dev/null
  docker start "$C" > /dev/null; listo 1
  en namenode
  [ "$(en namenode | grep -c active)" = 1 ] && [ "$(en namenode | grep -c standby)" = 1 ] \
    || falla "HA no quedo con un activo y un standby"
  subir_ventas; leer_ok
}

# ---------------------------------------------------------------------------
mongo() { en "mongosh --quiet tienda --eval '$1'"; }

mongodb() {
  [ -n "$VERSION" ] || falla "IMAGEN=$IMAGEN es de antes de las versiones: no trae MongoDB"
  paso "MONGODB=si con todo prendido: prueba completa y prueba de MongoDB"
  prender "${CHICO[@]}" -e MONGODB=si; listo 1
  probar
  probar probar_mongodb.sh
  mongo 'db.propia.insertOne({hola: "mundo"})' > /dev/null

  paso "docker stop / docker start: MongoDB se apaga en orden y no se vuelve a cargar"
  apagar_bien
  docker start "$C" > /dev/null; listo 2
  docker logs "$C" 2>&1 | sed -n '/Cluster LISTO/,$p' | grep 'Primer arranque' && falla "repitio un primer arranque"
  [ "$(mongo 'db.propia.countDocuments()')" = 1 ] || falla "se perdio lo que se escribio en MongoDB"
  [ "$(mongo 'db.pedidos.countDocuments()')" = 20000 ] || falla "se perdieron los pedidos"

  paso "MONGODB=no sobre el mismo volumen: no corre y estado lo dice"
  prender "${CHICO[@]}" -e SERVICIOS=hdfs; listo 1
  en "netstat -tln" | grep -q ':27017 ' && falla "MongoDB prendido con MONGODB=no"
  en estado | grep -q 'MongoDB: apagado' || falla "estado no dice que MongoDB esta apagado"

  paso "MONGODB=si de vuelta: los datos siguen ahi"
  prender "${CHICO[@]}" -e SERVICIOS=hdfs -e MONGODB=sí; listo 1
  docker logs "$C" 2>&1 | grep -q "en MongoDB (20.000" && falla "volvio a cargar la base de ejemplo"
  [ "$(mongo 'db.propia.countDocuments()')" = 1 ] || falla "se perdio lo que se escribio en MongoDB"

  paso "Se corta el primer arranque mientras se carga la base de MongoDB"
  limpiar
  prender "${CHICO[@]}" -e SERVICIOS=hdfs -e MONGODB=si
  esperar_log "cargando la base de ejemplo 'tienda' en MongoDB"
  docker kill "$C" > /dev/null
  docker start "$C" > /dev/null; listo 1
  [ "$(mongo 'db.pedidos.countDocuments()')" = 20000 ] || falla "la base de MongoDB no se rehizo"
  [ "$(mongo 'db.productos.countDocuments()')" = 9 ] || falla "la base de MongoDB no se rehizo"
}

# ---------------------------------------------------------------------------
ml() { # IMAGEN tiene que ser la version ml
  paso "Version ml con MongoDB: prueba completa y prueba de ml"
  [ "$VERSION" = ml ] || falla "IMAGEN=$IMAGEN no es la version ml"
  prender "${CHICO[@]}" -e MONGODB=si; listo 1
  probar
  probar probar_ml.sh

  paso "docker stop / docker start: JupyterLab vuelve a prender"
  apagar_bien
  docker start "$C" > /dev/null; listo 2
  en "netstat -tln" | grep -q ':8888 ' || falla "JupyterLab no volvio a prender"

  paso "JUPYTER=no: no corre y estado lo dice"
  prender "${CHICO[@]}" -e SERVICIOS=hdfs -e JUPYTER=no; listo 1
  en "netstat -tln" | grep -q ':8888 ' && falla "JupyterLab prendido con JUPYTER=no"
  en estado | grep -q 'JupyterLab: apagado' || falla "estado no dice que JupyterLab esta apagado"
}

# ---------------------------------------------------------------------------
desde_latest() { # el volumen de un alumno que usaba la imagen de antes de las versiones
  [ -n "$VERSION" ] || falla "IMAGEN=$IMAGEN es la de antes de las versiones: no hay a que pasar"
  local anterior=${IMAGEN_ANTERIOR:-franki678/bigdata-sandbox:latest}
  paso "Volumen creado con $anterior (Ubuntu 20.04, MariaDB 10.3)"
  docker image inspect "$anterior" > /dev/null 2>&1 || docker pull -q "$anterior"
  docker run -d --name "$C" -v "$V:/hadoop" "${CHICO[@]}" "$anterior" > /dev/null; listo 1
  subir_ventas
  hive_sql "CREATE TABLE previa (x INT)" > /dev/null
  apagar_bien

  paso "El mismo volumen con $IMAGEN (Ubuntu 24.04, MariaDB 10.11) y MongoDB"
  prender "${CHICO[@]}" -e MONGODB=si; listo 1
  leer_ok
  hive_sql "SHOW TABLES" | grep -qx previa || falla "se perdieron las tablas de Hive"
  en "cat /hadoop/mysql/mysql_upgrade_info" | grep -q '^10\.11' || falla "no se pusieron al dia las tablas de MySQL"
  probar
  probar probar_mongodb.sh
  if [ "$VERSION" = ml ]; then probar probar_ml.sh; fi

  paso "Reinicio: MySQL arranca sin errores"
  apagar_bien
  docker start "$C" > /dev/null; listo 2
  # El log desde el ultimo apagado (tac lo lee de abajo para arriba)
  en "tac /var/log/mysql/error.log | sed '/Shutdown complete/q'" | grep 'ERROR' && falla "MySQL arranca con errores"
  leer_ok
}

# ---------------------------------------------------------------------------
case "${1:-}" in
  reinicio|ha|servicios|parametros|corte|mongodb|ml) limpiar; "$1" ;;
  volumen-viejo) limpiar; volumen_viejo ;;
  desde-latest) limpiar; desde_latest ;;
  *) echo "Uso: $0 reinicio|ha|servicios|parametros|volumen-viejo|corte|mongodb|ml|desde-latest"; exit 1 ;;
esac
echo; echo "ESCENARIO $1: OK"
