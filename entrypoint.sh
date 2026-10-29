#!/usr/bin/env bash
# Arranca TODOS los daemons del cluster dentro de este contenedor, con la
# arquitectura pedida en el docker run (DATANODES, NAMENODES, REPLICATION,
# BLOCK_SIZE) y los servicios pedidos (SERVICIOS, MONGODB, JUPYTER), y mantiene
# el proceso vivo tail-eando logs.
set -e
. /opt/sandbox/lib.sh

log()   { echo -e "\n\033[1;36m[sandbox]\033[0m $*"; }
error() { echo -e "\n\033[1;31m[sandbox] ERROR:\033[0m $*" >&2; exit 1; }
entre() { [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge "$2" ] && [ "$1" -le "$3" ]; }

paralelo() { # $1=funcion, resto=argumentos: la corre con todos a la vez
  local f=$1 a p pids=() r=0; shift
  for a in "$@"; do "$f" "$a" & pids+=("$!"); done
  for p in "${pids[@]}"; do wait "$p" || r=1; done
  return "$r"
}

# ---------------------------------------------------------------------------
# 0) Parametros
# ---------------------------------------------------------------------------
entre "$DATANODES" 1 9        || error "DATANODES=$DATANODES: tiene que ser un numero de 1 a 9"
entre "$NAMENODES_PEDIDO" 1 3 || error "NAMENODES=$NAMENODES_PEDIDO: tiene que ser un numero de 1 a 3"
entre "$REPLICATION" 1 9      || error "REPLICATION=$REPLICATION: tiene que ser un numero de 1 a 9"
[[ "$BLOCK_SIZE" =~ ^[1-9][0-9]*[mMgG]$ ]] \
  || error "BLOCK_SIZE=$BLOCK_SIZE: numero + m o g (ej. 1m, 32m, 128m, 1g). Minimo 1m"
[[ "$SERVICIOS" =~ ^(hdfs|mapreduce|todo)$ ]] \
  || error "SERVICIOS=$SERVICIOS: tiene que ser hdfs, mapreduce o todo"
[[ "$MONGODB" =~ ^(si|no)$ ]] || error "MONGODB=$MONGODB: tiene que ser si o no"
[[ "$JUPYTER" =~ ^(si|no)$ ]] || error "JUPYTER=$JUPYTER: tiene que ser si o no"
[[ "$ROL" =~ ^(solo|maestro|trabajador)$ ]] || error "ROL=$ROL: tiene que ser solo, maestro o trabajador"
if en_aula; then
  [[ "$RED" =~ ^(docker|wireguard)$ ]] \
    || error "RED=$RED: tiene que ser docker (los nodos en una red de Docker) o wireguard (las PCs del aula)"
  if con_tunel && ! ip link show wg0 > /dev/null 2>&1; then
    error "RED=wireguard sin el tunel del aula (wg0): lo arma arranque-empresa.sh antes de este paso"
  fi
  [ -z "$TRABAJADOR_CORES" ] || entre "$TRABAJADOR_CORES" 1 256 \
    || error "TRABAJADOR_CORES=$TRABAJADOR_CORES: cores para trabajos, de 1 a 256"
  [ "$NAMENODES_PEDIDO" = 1 ] \
    || error "NAMENODES=$NAMENODES_PEDIDO: con ROL=$ROL hay un solo NameNode (la alta disponibilidad se ve con ROL=solo)"
  [[ "$PCS_POR_FILA" =~ ^[1-9][0-9]*$ ]] || error "PCS_POR_FILA=$PCS_POR_FILA: tiene que ser un numero de 1 en adelante"
  entre "$TRABAJADOR_RAM" 1024 65536 || error "TRABAJADOR_RAM=$TRABAJADOR_RAM: MB, de 1024 a 65536"
  [[ "$MAESTRO_NM" =~ ^(si|no)$ ]] || error "MAESTRO_NM=$MAESTRO_NM: tiene que ser si o no"
  if [ -n "$DATANODES_PEDIDO" ] && [ "$DATANODES_PEDIDO" != 1 ]; then
    log "AVISO: DATANODES no se usa con ROL=$ROL: cada nodo tiene 1 DataNode"
  fi
fi

# Espera a que $1:$2 acepte conexiones (hasta $3 segundos)
esperar_en() {
  local _
  for _ in $(seq 1 "$3"); do
    timeout 2 bash -c ">/dev/tcp/$1/$2" 2> /dev/null && return 0
    sleep 1
  done
  return 1
}

# La cantidad de NameNodes se graba en el volumen la primera vez
if [ ! -f "$NN_FILE" ]; then
  # Volumen de la version anterior de la imagen (siempre fue 1 NameNode)
  if [ -d /hadoop/dfs/name/current ]; then echo 1; else echo "$NAMENODES_PEDIDO"; fi > "$NN_FILE"
fi
NAMENODES=$(cat "$NN_FILE")
if [ "$NAMENODES" != "$NAMENODES_PEDIDO" ]; then
  log "AVISO: este volumen se creo con $NAMENODES NameNode(s) y ahora NAMENODES vale" \
      "$NAMENODES_PEDIDO: se usan $NAMENODES. Para cambiarlo hay que empezar de cero (borrar el volumen)."
fi

# PIDs de un arranque anterior (docker restart): si un proceso nuevo reusa ese
# numero, Hadoop cree que el daemon ya corre y no lo levanta.
rm -f /tmp/*.pid

# Volumen de la version anterior: el unico DataNode guardaba en dfs/data
if [ -d /hadoop/dfs/data ] && [ ! -e /hadoop/dfs/dn1 ]; then
  mv /hadoop/dfs/data /hadoop/dfs/dn1
fi

# Ejemplos en /datos/ejemplos, sin pisar los que ya esten (si editaste uno, queda
# tu version; para recuperar el original, borralo y reinicia el contenedor)
mkdir -p /datos/ejemplos && cp -rn /opt/sandbox/ejemplos/. /datos/ejemplos/ 2>/dev/null || true

generar_conf

# ---------------------------------------------------------------------------
# 1) HDFS
# ---------------------------------------------------------------------------
if es_trabajador; then
  # El NameNode esta en el maestro: este nodo solo suma su DataNode
  log "Trabajador $NODO: esperando al NameNode del maestro ($MAESTRO:9000)..."
  esperar_en "$MAESTRO" 9000 600 || error "el NameNode del maestro ($MAESTRO:9000) no contesta despues de 10 minutos"
elif ha; then
  log "HDFS en alta disponibilidad: ZooKeeper + $JOURNALNODES JournalNodes + $NAMENODES NameNodes..."
  zookeeper_start
  paralelo journalnode_start $(seq 1 "$JOURNALNODES")
  for k in $(seq 1 "$JOURNALNODES"); do esperar_puerto "$(jn_rpc "$k")"; done

  if [ ! -d /hadoop/dfs/nn1/current ]; then
    log "Primer arranque: formateando el NameNode 1 y los JournalNodes..."
    HADOOP_CONF_DIR=$(nn_conf 1) hdfs namenode -format -force -nonInteractive
    rm -f /hadoop/.zk-listo
  fi
  # Los demas NameNodes copian los metadatos del 1 (tambien si un primer
  # arranque se corto antes de llegar a copiarlos)
  for j in $(seq 2 "$NAMENODES"); do
    ls /hadoop/dfs/nn"$j"/current/fsimage_* > /dev/null 2>&1 && continue
    hdfs_daemon start nn1 namenode "$(nn_conf 1)"
    esperar_puerto "$(nn_http 1)" 120
    log "Primer arranque: copiando los metadatos al NameNode $j (bootstrapStandby)..."
    HADOOP_CONF_DIR=$(nn_conf "$j") hdfs namenode -bootstrapStandby -force -nonInteractive
  done
  if [ ! -f /hadoop/.zk-listo ]; then
    log "Primer arranque: preparando ZooKeeper para la eleccion del NameNode activo..."
    HADOOP_CONF_DIR=$(nn_conf 1) hdfs zkfc -formatZK -force
    touch /hadoop/.zk-listo
  fi
  paralelo namenode_start $(seq 1 "$NAMENODES")

  log "Esperando que ZooKeeper elija el NameNode activo..."
  for _ in $(seq 1 60); do nn_activo > /dev/null && break; sleep 2; done
else
  if [ ! -d /hadoop/dfs/name/current ]; then
    log "Primer arranque: formateando NameNode..."
    hdfs namenode -format -force -nonInteractive
  fi
  log "Arrancando NameNode + Secondary NameNode..."
  namenode_start 1
  hdfs_daemon start snn secondarynamenode
fi

log "Arrancando $DATANODES DataNode(s)..."
paralelo datanode_start $(seq 1 "$DATANODES")

# (un trabajador no decide por el NameNode: eso lo hace el maestro)
if ! es_trabajador; then
  log "Esperando a que HDFS salga de safe mode (en reinicios tarda unos segundos)..."
  if ! timeout 120 hdfs dfsadmin -safemode wait > /dev/null; then
    log "AVISO: HDFS no salio solo de safe mode: faltan bloques (bajaste DATANODES?)." \
        "Se fuerza la salida. Revisa que se perdio con: hdfs fsck /"
    hdfs dfsadmin -safemode leave
  fi
fi

# Que todos los DataNodes ya esten anotados en el NameNode: si no, un archivo
# subido apenas aparece "LISTO" queda con menos replicas que REPLICATION
dn_vivos() {
  local a=1
  if ha; then a=$(nn_activo) || return 0; fi
  jmx "$(nn_http "$a")" "Hadoop:service=NameNode,name=FSNamesystemState" | jmx_valor NumLiveDataNodes
}
dn_anotado() { # el NameNode del maestro ya tiene a este DataNode entre los vivos
  curl -s --max-time 3 "http://$MAESTRO:9870/jmx?qry=Hadoop:service=NameNode,name=NameNodeInfo" \
    | grep -q "$NODO:9866"
}
for _ in $(seq 1 60); do
  if es_trabajador; then
    dn_anotado && break
  else
    [ "$(dn_vivos)" -ge "$DATANODES" ] 2>/dev/null && break
  fi
  sleep 1
done

# ---------------------------------------------------------------------------
# 2) Directorios en HDFS (solo la primera vez: cada comando hdfs es una JVM
#    nueva y tarda en arrancar). En el aula los prepara el maestro.
# ---------------------------------------------------------------------------
if ! es_trabajador && [ ! -f /hadoop/.dirs-hdfs ]; then
  if es_maestro; then
    # Politica WARM en todo HDFS: 1 replica en disco comun (las PCs de los
    # alumnos) y el resto en ARCHIVE, que es solo el DataNode del maestro.
    # Asi el profe guarda una copia de cada bloque y se puede apagar toda el
    # aula sin perder nada. /aula: la carpeta de la clase.
    log "Primer arranque: politica WARM (una copia de todo en el maestro)..."
    hdfs storagepolicies -setStoragePolicy -path / -policy WARM
    hdfs dfs -mkdir -p /aula
    hdfs dfs -chmod 1777 /aula
  fi
  log "Preparando directorios en HDFS..."
  hdfs dfs -mkdir -p /tmp /user/hive/warehouse /user/root /apps/tez /apps/spark /spark-logs
  hdfs dfs -chmod -R 1777 /tmp
  hdfs dfs -chmod -R 777 /user/hive/warehouse /spark-logs
  touch /hadoop/.dirs-hdfs
fi

# ---------------------------------------------------------------------------
# 3) YARN + MapReduce JobHistory (SERVICIOS=mapreduce o todo)
# ---------------------------------------------------------------------------
yarn_daemon() {
  if [ "$1" = historyserver ]; then mapred --daemon start "$1"; else yarn --daemon start "$1"; fi
}
if con_yarn && es_trabajador; then
  log "Esperando al ResourceManager del maestro ($MAESTRO:8031)..."
  esperar_en "$MAESTRO" 8031 600 || error "el ResourceManager del maestro ($MAESTRO:8031) no contesta despues de 10 minutos"
  log "Arrancando NodeManager ($TRABAJADOR_RAM MB para trabajos)..."
  yarn_daemon nodemanager
elif con_yarn && es_maestro; then
  # Los trabajos corren en las PCs de los alumnos; el maestro solo si MAESTRO_NM=si
  if [ "$MAESTRO_NM" = si ]; then
    log "Arrancando YARN (ResourceManager + NodeManager) y MapReduce JobHistory..."
    paralelo yarn_daemon resourcemanager nodemanager historyserver
  else
    log "Arrancando YARN (ResourceManager) y MapReduce JobHistory..."
    paralelo yarn_daemon resourcemanager historyserver
  fi
elif con_yarn; then
  log "Arrancando YARN (ResourceManager + NodeManager) y MapReduce JobHistory..."
  paralelo yarn_daemon resourcemanager nodemanager historyserver
fi

# ---------------------------------------------------------------------------
# 3b) MySQL con la base de ejemplo "tienda", para Sqoop (SERVICIOS=mapreduce o
#     todo: Sqoop copia con trabajos MapReduce). Vive en el volumen.
# ---------------------------------------------------------------------------
mysql_cortado() {
  log "MySQL NO ARRANCO: este volumen es de la imagen anterior (Ubuntu 20.04," \
      "MariaDB 10.3) y la ultima vez se apago de golpe (sin 'docker stop')." \
      "\n  El MariaDB de esta imagen (10.11) no puede abrir una base que quedo asi." \
      "\n  Si lo que habia en MySQL no importa: docker exec <contenedor> rm -rf /hadoop/mysql" \
      "\n  y docker restart <contenedor>: se crea de cero con la base de ejemplo 'tienda'." \
      "\n  Para no perder nada, la tiene que cerrar bien la imagen que la creo:" \
      "\n    1. docker rm -f <contenedor>          (el volumen queda)" \
      "\n    2. el mismo docker run de siempre (mismo -v ...:/hadoop), pero con la imagen" \
      "\n       franki678/bigdata-sandbox@sha256:ec227d9e0559b4294a708a73a91f0e2218871ab0c2ffc3a4f77f347c10f67ce1" \
      "\n    3. cuando termine de arrancar (el cartel del final): docker stop -t 20 <contenedor>" \
      "\n    4. docker rm <contenedor> y volver a crearlo con esta imagen: MySQL se" \
      "\n       pone al dia solo." \
      "\n  Mientras tanto, todo lo demas (HDFS, YARN, Hive, Spark) anda; Sqoop no."
}
mysql_start() {
  # mysqld corre como el usuario 'mysql' (no como root): sus carpetas son de el
  mkdir -p /run/mysqld /var/log/mysql /hadoop/mysql
  chown -R mysql:mysql /run/mysqld /var/log/mysql /hadoop/mysql
  # La primera vez (o si un primer arranque se corto a la mitad): de cero
  if [ ! -f /hadoop/mysql/.sandbox-listo ]; then
    log "Primer arranque: creando la base MySQL..."
    find /hadoop/mysql -mindepth 1 -delete
    mysql_install_db --user=mysql --datadir=/hadoop/mysql > /tmp/mysql_install_db.log 2>&1 \
      || { cat /tmp/mysql_install_db.log; return 1; }
  fi
  log "Arrancando MySQL (base de ejemplo para Sqoop)..."
  mysqld > /dev/null 2>&1 &
  local pid=$! _
  for _ in $(seq 1 60); do
    mysqladmin --silent ping > /dev/null 2>&1 && break
    kill -0 "$pid" 2> /dev/null || break   # mysqld ya se cerro: no esperar de mas
    sleep 1
  done
  if ! mysqladmin --silent ping > /dev/null 2>&1; then
    # Volumen de la imagen anterior (MariaDB 10.3) que se apago de golpe: el
    # MariaDB de esta imagen no sabe terminar lo que quedo a medias en ese
    # formato viejo. No hay arreglo automatico seguro: lo tiene que cerrar
    # bien el MariaDB que lo creo (la imagen anterior, por digest).
    if grep -q 'Upgrade after a crash is not supported' /var/log/mysql/error.log 2> /dev/null; then
      mysql_cortado
    fi
    return 1
  fi
  # Pone al dia las tablas internas de MySQL si la base la creo un MariaDB mas
  # viejo (el volumen de la imagen anterior, con Ubuntu 20.04, trae la 10.3).
  # Tarda ~10 s una sola vez; despues ve que ya esta al dia y no hace nada.
  mariadb-upgrade --silent > /tmp/mariadb-upgrade.log 2>&1 \
    || log "AVISO: mariadb-upgrade fallo (ver /tmp/mariadb-upgrade.log)"

  # Usuario para Sqoop y base "tienda"
  if [ ! -f /hadoop/mysql/.sandbox-listo ]; then
    log "Primer arranque: cargando la base de ejemplo 'tienda' (200.000 ventas)..."
    mysql <<'SQL' || return 1
DELETE FROM mysql.user WHERE User = '';
DROP DATABASE IF EXISTS test;
CREATE OR REPLACE USER 'alumno'@'%' IDENTIFIED BY 'alumno';
CREATE OR REPLACE USER 'alumno'@'localhost' IDENTIFIED BY 'alumno';
GRANT ALL PRIVILEGES ON *.* TO 'alumno'@'%', 'alumno'@'localhost';
FLUSH PRIVILEGES;
SQL
    python3 /opt/sandbox/ejemplos/generar_ventas.py 200000 /tmp/tienda_ventas.csv > /dev/null \
      && mysql < /opt/sandbox/ejemplos/tienda.sql || return 1
    rm -f /tmp/tienda_ventas.csv
    touch /hadoop/mysql/.sandbox-listo
  fi
}
if con_yarn && ! es_trabajador; then
  mysql_start || log "AVISO: MySQL no levanto (Sqoop no va a tener base de ejemplo)." \
                     "Revisar /var/log/mysql/error.log"
fi

# ---------------------------------------------------------------------------
# 3c) MongoDB con la base de ejemplo "tienda" (MONGODB=si). No depende de
#     Hadoop: anda con cualquier SERVICIOS. Vive en el volumen.
# ---------------------------------------------------------------------------
mongodb_start() {
  # MongoDB 5 o mas nuevo necesita un procesador con AVX (en Intel/AMD): sin
  # eso, mongod se cae apenas arranca ("Illegal instruction")
  if [ "$(uname -m)" = x86_64 ] && ! grep -qw avx /proc/cpuinfo; then
    log "AVISO: este procesador no tiene AVX, y MongoDB lo necesita."
    return 1
  fi
  # mongod corre como el usuario 'mongodb' (no como root): sus carpetas son de el
  mkdir -p /hadoop/mongodb /var/log/mongodb
  chown -R mongodb:mongodb /hadoop/mongodb /var/log/mongodb
  log "Arrancando MongoDB..."
  runuser -u mongodb -- mongod --config /etc/mongod.conf > /dev/null 2>&1 &
  esperar_puerto "$MONGODB_PORT" 60 || return 1
  # La primera vez (o si un primer arranque se corto a la mitad: el script
  # borra lo que haya y carga todo de cero)
  if [ ! -f /hadoop/mongodb/.sandbox-listo ]; then
    log "Primer arranque: cargando la base de ejemplo 'tienda' en MongoDB (20.000 pedidos)..."
    mongosh --quiet /opt/sandbox/ejemplos/tienda_mongo.js > /tmp/mongo-carga.log 2>&1 \
      || { cat /tmp/mongo-carga.log; return 1; }
    touch /hadoop/mongodb/.sandbox-listo
  fi
}
if con_mongodb; then
  mongodb_start || log "AVISO: MongoDB no levanto. Revisar /var/log/mongodb/mongod.log"
fi

# ---------------------------------------------------------------------------
# 4) Hive + Spark (SERVICIOS=todo)
# ---------------------------------------------------------------------------
if con_hive_spark && ! es_trabajador; then
  # Librerias de Tez y Spark en HDFS, la primera vez. Van con bloque de 128m
  # aunque BLOCK_SIZE sea chico: con 1m serian cientos de bloques que solo
  # ensucian lo que se quiere mirar.
  # La marca guarda la lista de jars de Spark: si una imagen nueva suma alguno
  # (spark-avro en ml y full), spark-libs.jar se vuelve a armar una vez.
  firma_spark=$(ls "${SPARK_HOME}/jars" | md5sum | cut -c1-12)
  if [ "$(cat /hadoop/.libs-hdfs 2>/dev/null)" != "$firma_spark" ]; then
    if ! hdfs dfs -test -e /apps/tez/tez.tar.gz; then
      log "Subiendo librerias de Tez a HDFS..."
      hdfs dfs -D dfs.blocksize=128m -put "${TEZ_HOME}/share/tez.tar.gz" /apps/tez/tez.tar.gz
    fi
    if ! hdfs dfs -test -e /apps/spark/spark-libs.jar || [ -f /hadoop/.libs-hdfs ]; then
      log "Subiendo librerias de Spark a HDFS..."
      # Todos los jars en un solo archivo
      python3 -c 'import glob, os, sys, zipfile
z = zipfile.ZipFile(sys.argv[2], "w")
for f in sorted(glob.glob(os.path.join(sys.argv[1], "*.jar"))):
    z.write(f, os.path.basename(f))
z.close()' "${SPARK_HOME}/jars" /tmp/spark-libs.jar
      hdfs dfs -D dfs.blocksize=128m -put -f /tmp/spark-libs.jar /apps/spark/spark-libs.jar
      rm -f /tmp/spark-libs.jar
    fi
    echo "$firma_spark" > /hadoop/.libs-hdfs
  fi

  # Metastore de Hive: inicializar el schema la primera vez. Si un primer
  # arranque se corto a la mitad, la base quedo incompleta: se rehace.
  # (Desde /hadoop: Derby deja su derby.log en la carpeta actual, y la de
  # trabajo es /datos, la del alumno.)
  cd /hadoop
  if es_maestro; then
    # En el maestro, sobre MariaDB: el driver JDBC es el mismo que usa Sqoop
    ln -sf "$SQOOP_HOME"/lib/mysql-connector-java-*.jar "$HIVE_HOME/lib/"
    if [ ! -f /hadoop/.metastore-mysql-listo ]; then
      log "Primer arranque: inicializando schema del Metastore (MariaDB)..."
      mysql <<'SQL'
CREATE DATABASE IF NOT EXISTS metastore;
CREATE OR REPLACE USER 'hive'@'%' IDENTIFIED BY 'hive';
CREATE OR REPLACE USER 'hive'@'localhost' IDENTIFIED BY 'hive';
GRANT ALL PRIVILEGES ON metastore.* TO 'hive'@'%', 'hive'@'localhost';
FLUSH PRIVILEGES;
SQL
      if ! schematool -dbType mysql -info > /dev/null 2>&1; then
        mysql -e "DROP DATABASE metastore; CREATE DATABASE metastore"
        schematool -dbType mysql -initSchema
      fi
      touch /hadoop/.metastore-mysql-listo
    fi
  elif [ ! -f /hadoop/.metastore-listo ]; then
    if [ -d /hadoop/metastore_db ] && schematool -dbType derby -info > /dev/null 2>&1; then
      :   # volumen de una version anterior de la imagen: ya estaba listo
    else
      log "Primer arranque: inicializando schema del Metastore (Derby)..."
      rm -rf /hadoop/metastore_db
      schematool -dbType derby -initSchema
    fi
    touch /hadoop/.metastore-listo
  fi

  log "Arrancando Hive Metastore + HiveServer2 + Spark History Server..."
  hive --service metastore > "${HIVE_HOME}/metastore.log" 2>&1 &
  hive --service hiveserver2 > "${HIVE_HOME}/hiveserver2.log" 2>&1 &
  cd /datos
  "${SPARK_HOME}/sbin/start-history-server.sh" > /dev/null

  log "Esperando a que HiveServer2 acepte conexiones (puede tardar ~1 min)..."
  esperar_puerto 10000 180 || log "HiveServer2 no levanto: revisar ${HIVE_HOME}/hiveserver2.log"
fi

# ---------------------------------------------------------------------------
# 4b) JupyterLab: notebooks de Python en el navegador (solo en la version ml
#     de la imagen; JUPYTER=si por defecto). Configuracion en /etc/jupyter.
# ---------------------------------------------------------------------------
if con_jupyter; then
  log "Arrancando JupyterLab..."
  jupyter lab > /var/log/jupyter.log 2>&1 &
  esperar_puerto "$JUPYTER_PORT" 60 || log "AVISO: JupyterLab no levanto: revisar /var/log/jupyter.log"
elif [ "$JUPYTER" = si ] && [ -n "${JUPYTER_PEDIDO:-}" ]; then
  log "AVISO: JUPYTER=si, pero esta version de la imagen ($SANDBOX_VERSION) no trae JupyterLab: viene en la version ml"
fi

echo
echo "  ============================================================"
echo "   Cluster LISTO"
echo "  ============================================================"
estado

# ---------------------------------------------------------------------------
# 5) Mantener el contenedor vivo siguiendo los logs. Con 'docker stop' (o el
#    boton de Docker Desktop) se apaga todo en orden; sin esto Docker mata
#    los procesos de golpe y MySQL, el Metastore y HDFS tienen que
#    recuperarse en el proximo arranque.
# ---------------------------------------------------------------------------
# El orden esta en apagar_en_orden (sandbox/lib.sh): el servidor de la
# version full usa la misma funcion.
apagar() {
  trap - TERM INT
  log "Apagando el cluster..."
  apagar_en_orden
  exit 0
}
trap apagar TERM INT

mkdir -p "${HADOOP_HOME}/logs"
tail -F \
  "${HADOOP_HOME}"/logs/*.log \
  "${HIVE_HOME}"/metastore.log \
  "${HIVE_HOME}"/hiveserver2.log \
  /var/log/mysql/error.log 2>/dev/null &
wait $!
