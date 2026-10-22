# Funciones compartidas por el entrypoint y los comandos 'estado', 'datanode'
# y 'namenode'. La arquitectura sale de las variables del 'docker run'
# (-e DATANODES=3 ...); lo que no se especifica vale 1.

RUN_DIR=/opt/sandbox/run            # conf generada para cada proceso
NN_FILE=/hadoop/namenodes           # NAMENODES elegido al crear el volumen
JOURNALNODES=3                      # quorum de edits en modo HA (siempre impar)

DATANODES=${DATANODES:-1}
REPLICATION=${REPLICATION:-1}
BLOCK_SIZE=${BLOCK_SIZE:-128m}
# NAMENODES queda fijo al crear el volumen: pasar de 1 a 2 cambia el formato
# de los metadatos. Si ya hay uno grabado, manda ese.
NAMENODES_PEDIDO=${NAMENODES:-1}
NAMENODES=$(cat "$NN_FILE" 2>/dev/null || echo "$NAMENODES_PEDIDO")
# Que se prende ademas de HDFS: hdfs (nada), mapreduce (YARN + MapReduce) o todo
SERVICIOS=${SERVICIOS:-todo}
# Servicios aparte de Hadoop, que se prenden o no con cualquier SERVICIOS: si o
# no (tambien vale "sí" o "SI"). JupyterLab viene solo en la version ml de la
# imagen: en las demas no hay nada que prender.
MONGODB=${MONGODB:-no};  MONGODB=${MONGODB,,};  MONGODB=${MONGODB//í/i}
JUPYTER_PEDIDO=${JUPYTER:-}   # para avisar si se pidio en una version sin Jupyter
JUPYTER=${JUPYTER:-si};  JUPYTER=${JUPYTER,,};  JUPYTER=${JUPYTER//í/i}
# Version de la imagen (base, ml...): la graba el Dockerfile
SANDBOX_VERSION=${SANDBOX_VERSION:-base}

export HADOOP_CLASSPATH="${TEZ_HOME}/*:${TEZ_HOME}/lib/*:${HADOOP_CLASSPATH}"
# Muchos procesos Java conviven en el mismo contenedor: a cada daemon un tope
# de memoria chico y una JVM liviana (un solo hilo de GC y solo el compilador
# rapido C1). Arrancan antes y ocupan menos; para aprender no se nota.
# Los trabajos (MapReduce, Tez, Spark) corren en contenedores de YARN aparte,
# con la JVM normal.
JVM_LIVIANA="-XX:+UseSerialGC -XX:TieredStopAtLevel=1"
export HDFS_NAMENODE_OPTS="-Xmx384m $JVM_LIVIANA" \
       HDFS_DATANODE_OPTS="-Xmx256m $JVM_LIVIANA" \
       HDFS_SECONDARYNAMENODE_OPTS="-Xmx256m $JVM_LIVIANA" \
       HDFS_JOURNALNODE_OPTS="-Xmx128m $JVM_LIVIANA" \
       HDFS_ZKFC_OPTS="-Xmx128m $JVM_LIVIANA" \
       YARN_RESOURCEMANAGER_OPTS="-Xmx384m $JVM_LIVIANA" \
       YARN_NODEMANAGER_OPTS="-Xmx256m $JVM_LIVIANA" \
       MAPRED_HISTORYSERVER_OPTS="-Xmx256m $JVM_LIVIANA" \
       SERVER_JVMFLAGS="-XX:+UseSerialGC" \
       SPARK_DAEMON_MEMORY=256m \
       SPARK_DAEMON_JAVA_OPTS="$JVM_LIVIANA"

ha() { [ "$NAMENODES" -gt 1 ]; }
con_yarn() { [ "$SERVICIOS" != hdfs ]; }
con_hive_spark() { [ "$SERVICIOS" = todo ]; }
con_mongodb() { [ "$MONGODB" = si ]; }
hay_jupyter() { command -v jupyter-lab > /dev/null; }
con_jupyter() { [ "$JUPYTER" = si ] && hay_jupyter; }
fs_uri() { if ha; then echo hdfs://sandbox; else echo hdfs://localhost:9000; fi; }

# Puertos de cada instancia (N = numero de nodo)
nn_rpc()    { echo $((8999 + $1)); }   # NameNode:     9000, 9001, 9002
nn_http()   { echo $((9869 + $1)); }   # NameNode UI:  9870, 9871, 9872
dn_http()   { echo $((9900 + $1)); }   # DataNode UI:  9901 ... 9909
dn_data()   { echo $((9910 + $1)); }   # DataNode transferencia de bloques
dn_ipc()    { echo $((9920 + $1)); }
jn_rpc()    { echo $((8484 + $1)); }   # JournalNode:  8485, 8486, 8487
jn_http()   { echo $((8479 + $1)); }   # JournalNode UI: 8480, 8481, 8482
zkfc_port() { echo $((8018 + $1)); }   # ZKFC:         8019, 8020, 8021
SNN_HTTP=9868
ZK_PORT=2181
MONGODB_PORT=27017
JUPYTER_PORT=8888

# --- Generacion de configuracion ---------------------------------------------

xml_conf() { # $1=archivo, resto = pares nombre valor
  local f=$1; shift
  {
    echo '<?xml version="1.0"?>'
    echo '<!-- Generado en cada arranque por /opt/sandbox/lib.sh a partir de las'
    echo '     variables del docker run. Editarlo a mano no sirve: se pisa. -->'
    echo '<configuration>'
    while [ $# -ge 2 ]; do
      printf '  <property>\n    <name>%s</name>\n    <value>%s</value>\n  </property>\n' "$1" "$2"
      shift 2
    done
    echo '</configuration>'
  } > "$f"
}

hdfs_base() { # deja en HDFS_BASE las propiedades comunes a todos los procesos
  HDFS_BASE=(
    dfs.replication "$REPLICATION"
    dfs.blocksize "$BLOCK_SIZE"
    dfs.webhdfs.enabled true
    # Sandbox de aprendizaje: sin chequeo de permisos para no renegar
    dfs.permissions.enabled false
    # Un DataNode caido se da por muerto a los ~40 s (de fabrica: 10,5 min)
    # y el NameNode empieza a re-replicar sus bloques
    dfs.heartbeat.interval 3
    dfs.namenode.heartbeat.recheck-interval 5000
    # Al reiniciar, safe mode termina 5 s despues de ver todos los bloques
    # (de fabrica: 30 s)
    dfs.namenode.safemode.extension 5000
  )
  if ha; then
    local ids="" j
    for j in $(seq 1 "$NAMENODES"); do
      ids+="${ids:+,}nn$j"
      HDFS_BASE+=(
        dfs.namenode.rpc-address.sandbox.nn$j "localhost:$(nn_rpc "$j")"
        dfs.namenode.http-address.sandbox.nn$j "localhost:$(nn_http "$j")"
        dfs.ha.zkfc.port.sandbox.nn$j "$(zkfc_port "$j")"
      )
    done
    local jns="" k
    for k in $(seq 1 "$JOURNALNODES"); do jns+="${jns:+;}localhost:$(jn_rpc "$k")"; done
    HDFS_BASE+=(
      dfs.nameservices sandbox
      dfs.ha.namenodes.sandbox "$ids"
      dfs.namenode.http-bind-host 0.0.0.0
      dfs.namenode.shared.edits.dir "qjournal://$jns/sandbox"
      dfs.client.failover.proxy.provider.sandbox org.apache.hadoop.hdfs.server.namenode.ha.ConfiguredFailoverProxyProvider
      # Todos los NameNodes estan en la misma maquina: no hace falta "cercar" al caido
      dfs.ha.fencing.methods "shell(/bin/true)"
      dfs.ha.automatic-failover.enabled true
    )
  else
    HDFS_BASE+=(
      dfs.namenode.name.dir /hadoop/dfs/name
      dfs.namenode.http-address 0.0.0.0:9870
      dfs.namenode.secondary.http-address 0.0.0.0:$SNN_HTTP
      dfs.namenode.checkpoint.dir /hadoop/dfs/secondary
      # Checkpoint cada 5 min (de fabrica: 1 h) para verlo en la UI
      dfs.namenode.checkpoint.period 300
    )
  fi
}

generar_conf() { # conf base, la que usan los clientes (hdfs, hive, spark...)
  local fs; fs=$(fs_uri)
  mkdir -p "$RUN_DIR"
  sed "s#@FS@#$fs#g" /opt/sandbox/templates/core-site.xml     > "$HADOOP_CONF_DIR/core-site.xml"
  sed "s#@FS@#$fs#g" /opt/sandbox/templates/tez-site.xml      > "$HADOOP_CONF_DIR/tez-site.xml"
  sed "s#@FS@#$fs#g" /opt/sandbox/templates/spark-defaults.conf > "$SPARK_HOME/conf/spark-defaults.conf"
  hdfs_base
  xml_conf "$HADOOP_CONF_DIR/hdfs-site.xml" "${HDFS_BASE[@]}"
}

conf_instancia() { # $1=instancia, resto=pares propios de ese proceso -> imprime el dir
  local dir="$RUN_DIR/$1"; shift
  rm -rf "$dir" && cp -r "$HADOOP_CONF_DIR" "$dir"
  hdfs_base
  xml_conf "$dir/hdfs-site.xml" "${HDFS_BASE[@]}" "$@"
  echo "$dir"
}

dn_conf() {
  conf_instancia "dn$1" \
    dfs.datanode.data.dir "/hadoop/dfs/dn$1" \
    dfs.datanode.address "0.0.0.0:$(dn_data "$1")" \
    dfs.datanode.ipc.address "0.0.0.0:$(dn_ipc "$1")" \
    dfs.datanode.http.address "0.0.0.0:$(dn_http "$1")" \
    dfs.datanode.hostname localhost
}

nn_conf() {
  if ha; then
    conf_instancia "nn$1" dfs.ha.namenode.id "nn$1" dfs.namenode.name.dir "/hadoop/dfs/nn$1"
  else
    echo "$HADOOP_CONF_DIR"
  fi
}

jn_conf() {
  conf_instancia "jn$1" \
    dfs.journalnode.rpc-address "0.0.0.0:$(jn_rpc "$1")" \
    dfs.journalnode.http-address "0.0.0.0:$(jn_http "$1")" \
    dfs.journalnode.edits.dir "/hadoop/dfs/jn$1"
}

# --- Procesos -----------------------------------------------------------------
# Cada instancia lleva su propio "ident" (dn2, nn1, jn3...): asi tiene su
# propio PID (/tmp/hadoop-dn2-datanode.pid) y log
# ($HADOOP_HOME/logs/hadoop-dn2-datanode-*.log).

corriendo() { # $1=instancia $2=servicio
  local f="/tmp/hadoop-$1-$2.pid" st
  [ -f "$f" ] || return 1
  st=$(ps -o stat= -p "$(cat "$f")" 2>/dev/null) || return 1
  [[ "$st" != Z* ]]   # un zombie ya murio, solo falta que lo recojan
}

hdfs_daemon() { # $1=start|stop $2=instancia $3=servicio [$4=dir de conf]
  if [ "$1" = start ] && corriendo "$2" "$3"; then return 0; fi
  if [ "$1" = stop ] && ! corriendo "$2" "$3"; then return 0; fi
  HADOOP_CONF_DIR="${4:-$HADOOP_CONF_DIR}" HADOOP_IDENT_STRING="$2" hdfs --daemon "$1" "$3"
}

datanode_start() { hdfs_daemon start "dn$1" datanode "$(dn_conf "$1")"; }
datanode_stop()  { hdfs_daemon stop  "dn$1" datanode; }

namenode_start() {
  local c; c=$(nn_conf "$1")
  hdfs_daemon start "nn$1" namenode "$c"
  # En HA, cada NameNode tiene su ZKFC que lo vigila y pide el "active" a ZooKeeper
  if ha; then hdfs_daemon start "nn$1" zkfc "$c"; fi
}
namenode_stop() { hdfs_daemon stop "nn$1" namenode; }

journalnode_start() { hdfs_daemon start "jn$1" journalnode "$(jn_conf "$1")"; }

zookeeper_start() {
  mkdir -p /hadoop/zookeeper
  rm -f /hadoop/zookeeper/zookeeper_server.pid
  ZOO_LOG_DIR="$ZK_HOME/logs" ZK_SERVER_HEAP=128 zkServer.sh start > /dev/null
}

# --- Consultas ----------------------------------------------------------------

escuchando() { netstat -tln 2>/dev/null | grep -q ":$1 "; }

esperar_puerto() { # $1=puerto [$2=segundos]
  local _
  for _ in $(seq 1 "${2:-60}"); do escuchando "$1" && return 0; sleep 1; done
  return 1
}

jmx() { # $1=puerto $2=consulta -> JSON
  curl -s --max-time 3 "http://localhost:$1/jmx?qry=$2"
}

jmx_valor() { # lee de stdin el JSON de jmx y devuelve el valor de $1
  grep -o "\"$1\" : [^,}]*" | head -1 | sed 's/.*: //; s/"//g'
}

nn_estado() { # active / standby / (vacio si esta caido)
  jmx "$(nn_http "$1")" "Hadoop:service=NameNode,name=NameNodeStatus" | jmx_valor State
}

nn_activo() { # numero del NameNode activo (vacio si no hay)
  local j
  for j in $(seq 1 "$NAMENODES"); do
    [ "$(nn_estado "$j")" = active ] && { echo "$j"; return 0; }
  done
  return 1
}

# --- Apagado --------------------------------------------------------------------

# Apaga todo en orden. La usan el trap del entrypoint (docker stop) y el
# servidor de la version full (boton Apagar, o apagar en medio del arranque),
# asi el orden esta en un solo lugar.
# Docker espera unos segundos antes de matar todo (10 de fabrica, 3 en algunos
# Docker Desktop): hay que apagar rapido y en orden.
# 1. Lo que usa HDFS (Hive y el historial de Spark), mientras HDFS sigue
#    arriba: con HDFS ya apagado, HiveServer2 se queda reintentando
#    conectarse a los NameNodes y no termina. A la vez, las bases de datos,
#    que no dependen de nada (mysqld: en MariaDB 10.5 o mas nuevo se llama
#    mariadbd), y JupyterLab (que cierra sus notebooks abiertos).
# 2. El resto: YARN, HDFS y ZooKeeper.
# Termina cuando ya no queda ninguno (o a los ~10 s, lo que pase primero).
apagar_en_orden() {
  local usan_hdfs='org.apache.hive.service.server.HiveServer2|hive.metastore.HiveMetaStore|spark.deploy.history.HistoryServer'
  local jupyter='/jupyter-lab|jupyter lab'
  local _
  pkill -TERM -f "$usan_hdfs" || true
  pkill -TERM -x 'mysqld|mariadbd|mongod' || true
  pkill -TERM -f "$jupyter" || true
  for _ in $(seq 1 10); do
    pgrep -f "$usan_hdfs" > /dev/null || break
    sleep 0.25
  done
  pkill -TERM -x java || true
  for _ in $(seq 1 32); do
    pgrep -x 'java|mysqld|mariadbd|mongod' > /dev/null || pgrep -f "$jupyter" > /dev/null || break
    sleep 0.25
  done
  return 0
}
