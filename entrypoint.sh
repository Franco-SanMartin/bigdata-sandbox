#!/usr/bin/env bash
# Arranca TODOS los daemons del cluster dentro de este contenedor, con la
# arquitectura pedida en el docker run (DATANODES, NAMENODES, REPLICATION,
# BLOCK_SIZE) y los servicios pedidos (SERVICIOS), y mantiene el proceso vivo
# tail-eando logs.
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
if ha; then
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

log "Esperando a que HDFS salga de safe mode (en reinicios tarda unos segundos)..."
if ! timeout 120 hdfs dfsadmin -safemode wait > /dev/null; then
  log "AVISO: HDFS no salio solo de safe mode: faltan bloques (bajaste DATANODES?)." \
      "Se fuerza la salida. Revisa que se perdio con: hdfs fsck /"
  hdfs dfsadmin -safemode leave
fi

# Que todos los DataNodes ya esten anotados en el NameNode: si no, un archivo
# subido apenas aparece "LISTO" queda con menos replicas que REPLICATION
dn_vivos() {
  local a=1
  if ha; then a=$(nn_activo) || return 0; fi
  jmx "$(nn_http "$a")" "Hadoop:service=NameNode,name=FSNamesystemState" | jmx_valor NumLiveDataNodes
}
for _ in $(seq 1 60); do
  [ "$(dn_vivos)" -ge "$DATANODES" ] 2>/dev/null && break
  sleep 1
done

# ---------------------------------------------------------------------------
# 2) Directorios en HDFS (solo la primera vez: cada comando hdfs es una JVM
#    nueva y tarda en arrancar)
# ---------------------------------------------------------------------------
if [ ! -f /hadoop/.dirs-hdfs ]; then
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
if con_yarn; then
  log "Arrancando YARN (ResourceManager + NodeManager) y MapReduce JobHistory..."
  paralelo yarn_daemon resourcemanager nodemanager historyserver
fi

# ---------------------------------------------------------------------------
# 3b) MySQL con la base de ejemplo "tienda", para Sqoop (SERVICIOS=mapreduce o
#     todo: Sqoop copia con trabajos MapReduce). Vive en el volumen.
# ---------------------------------------------------------------------------
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
  local _
  for _ in $(seq 1 60); do mysqladmin --silent ping > /dev/null 2>&1 && break; sleep 1; done
  mysqladmin --silent ping > /dev/null 2>&1 || return 1

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
if con_yarn; then
  mysql_start || log "AVISO: MySQL no levanto (Sqoop no va a tener base de ejemplo)." \
                     "Revisar /var/log/mysql/error.log"
fi

# ---------------------------------------------------------------------------
# 4) Hive + Spark (SERVICIOS=todo)
# ---------------------------------------------------------------------------
if con_hive_spark; then
  # Librerias de Tez y Spark en HDFS, la primera vez. Van con bloque de 128m
  # aunque BLOCK_SIZE sea chico: con 1m serian cientos de bloques que solo
  # ensucian lo que se quiere mirar.
  if [ ! -f /hadoop/.libs-hdfs ]; then
    if ! hdfs dfs -test -e /apps/tez/tez.tar.gz; then
      log "Subiendo librerias de Tez a HDFS..."
      hdfs dfs -D dfs.blocksize=128m -put "${TEZ_HOME}/share/tez.tar.gz" /apps/tez/tez.tar.gz
    fi
    if ! hdfs dfs -test -e /apps/spark/spark-libs.jar; then
      log "Subiendo librerias de Spark a HDFS..."
      # Todos los jars en un solo archivo
      python3 -c 'import glob, os, sys, zipfile
z = zipfile.ZipFile(sys.argv[2], "w")
for f in sorted(glob.glob(os.path.join(sys.argv[1], "*.jar"))):
    z.write(f, os.path.basename(f))
z.close()' "${SPARK_HOME}/jars" /tmp/spark-libs.jar
      hdfs dfs -D dfs.blocksize=128m -put /tmp/spark-libs.jar /apps/spark/spark-libs.jar
      rm -f /tmp/spark-libs.jar
    fi
    touch /hadoop/.libs-hdfs
  fi

  # Metastore de Hive: inicializar el schema la primera vez. Si un primer
  # arranque se corto a la mitad, la base quedo incompleta: se rehace.
  # (Desde /hadoop: Derby deja su derby.log en la carpeta actual, y la de
  # trabajo es /datos, la del alumno.)
  cd /hadoop
  if [ ! -f /hadoop/.metastore-listo ]; then
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
apagar() {
  trap - TERM INT
  log "Apagando el cluster..."
  # mysqld: en MariaDB 10.5 o mas nuevo el programa se llama mariadbd
  pkill -TERM -x 'mysqld|mariadbd' || true
  pkill -TERM -x java || true
  local _
  # Docker espera 10 s antes de matar todo
  for _ in $(seq 1 16); do
    pgrep -x 'java|mysqld|mariadbd' > /dev/null || break
    sleep 0.5
  done
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
