# Funciones compartidas por el entrypoint y los comandos 'estado', 'datanode'
# y 'namenode'. La arquitectura sale de las variables del 'docker run'
# (-e DATANODES=3 ...); lo que no se especifica vale 1.

RUN_DIR=/opt/sandbox/run            # conf generada para cada proceso
NN_FILE=/hadoop/namenodes           # NAMENODES elegido al crear el volumen
JOURNALNODES=3                      # quorum de edits en modo HA (siempre impar)

# Rol del contenedor (version empresa: el cluster del aula, un nodo por PC):
#   solo        todo el cluster en este contenedor (lo de siempre, por defecto)
#   maestro     la PC del profe: NameNode, ResourceManager, JobHistory, Hive,
#               historial de Spark y un DataNode "archivo" (guarda una copia
#               de todo, para que no se pierda nada al apagar el aula)
#   trabajador  cada PC de alumno: 1 DataNode + 1 NodeManager, contra el maestro
# RED dice como se ven los nodos:
#   docker     una red de Docker (varios contenedores en la misma compu, o el CI)
#   wireguard  las PCs del aula de verdad: un tunel WireGuard con hub en el
#              maestro. Cada PC se inscribe con el codigo de la clase, recibe
#              su IP del tunel (10.13.0.x) y su nombre (pcNN), y solo hace
#              conexiones salientes: no publica puertos (empresa/aula/red.sh)
ROL=${ROL:-solo};  ROL=${ROL,,}
RED=${RED:-docker};  RED=${RED,,}
AULA_DIR=/hadoop/aula                   # RED=wireguard: claves, codigo de la clase y PCs inscriptas
RED_TUNEL=10.13.0                       # el maestro es .1 y la PC N es .(10+N): pc03 = 10.13.0.13
HUB_IP=$RED_TUNEL.1
P_WG=51820                              # UDP: WireGuard (el hub, en el maestro)
P_INSCRIPCION=8099                      # TCP: inscripcion de las PCs (en el maestro)
# 1500 de la red del aula, menos 80 de WireGuard (sobre IPv6, el peor caso) y
# 40 de margen por si Docker Desktop o la red agregan algo
WG_MTU=${WG_MTU:-1380}
if [ "$RED" = wireguard ]; then
  # En una PC, MAESTRO es la IP de la PC del profe en el aula: por ahi sale el
  # tunel. Adentro del cluster el maestro se llama "maestro" (10.13.0.1).
  if [ "$ROL" = trabajador ]; then HUB=${HUB:-${MAESTRO:-}}; fi
  if [ "$ROL" = maestro ]; then NODO=maestro; fi
  MAESTRO=maestro
  # Lo que le toco a esta PC al inscribirse (NODO) y lo que decide el maestro
  # para toda la clase (REPLICATION, BLOCK_SIZE, SERVICIOS, PCS_POR_FILA)
  if [ "$ROL" = trabajador ] && [ -r "$AULA_DIR/nodo.env" ]; then . "$AULA_DIR/nodo.env"; fi
fi
MAESTRO=${MAESTRO:-maestro}             # nombre (o IP) del maestro, para los trabajadores
NODO=${NODO:-$(hostname)}               # nombre con el que este nodo se anuncia
PCS_POR_FILA=${PCS_POR_FILA:-5}         # racks: pc01-pc05 = /fila1, pc06-pc10 = /fila2...
MAESTRO_NM=${MAESTRO_NM:-no};  MAESTRO_NM=${MAESTRO_NM,,};  MAESTRO_NM=${MAESTRO_NM//í/i}
en_aula()       { [ "$ROL" != solo ]; }
es_maestro()    { [ "$ROL" = maestro ]; }
es_trabajador() { [ "$ROL" = trabajador ]; }
con_tunel()     { [ "$RED" = wireguard ]; }

# Lo que Docker le da a este contenedor: el limite del cgroup (docker run
# --memory / --cpus) o, si no hay, lo de la maquina virtual de Docker Desktop
# (en el aula: unos 3,8 GB en las PCs de 8 GB y 7,8 GB en las de 16)
docker_ram_mb() {
  local total lim
  total=$(awk '/^MemTotal:/ { print int($2 / 1024) }' /proc/meminfo)
  lim=$(cat /sys/fs/cgroup/memory.max 2>/dev/null || cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null || echo max)
  if [[ "$lim" =~ ^[0-9]+$ ]] && [ $(( lim / 1048576 )) -lt "$total" ]; then total=$(( lim / 1048576 )); fi
  echo "$total"
}
docker_cores() {
  local n cuota periodo
  n=$(nproc 2>/dev/null || echo 1)
  { read -r cuota periodo < /sys/fs/cgroup/cpu.max; } 2>/dev/null || cuota=max
  if [[ "$cuota" =~ ^[0-9]+$ ]] && [ "${periodo:-0}" -gt 0 ]; then
    cuota=$(( (cuota + periodo - 1) / periodo ))
    [ "$cuota" -lt "$n" ] && n=$cuota
  fi
  echo "$n"
}
# MB para trabajos: dos tercios de lo que tiene Docker, redondeado para abajo
# al GB. El resto queda para el DataNode, el NodeManager y el sistema. Con lo
# que midio la sonda el 27/10: 3863 MB (PCs de 8 GB) -> 2048; 7828 MB (PCs de
# 16 GB) -> 5120.
ram_para_trabajos() {
  local mb=$(( $(docker_ram_mb) * 2 / 3 / 1024 * 1024 ))
  [ "$mb" -lt 1024 ] && mb=1024
  [ "$mb" -gt 65536 ] && mb=65536
  echo "$mb"
}

# MB de YARN y cores para los trabajos en cada nodo. Con RED=wireguard cada
# PC es un trabajador: salen solos de lo que tiene Docker en esa PC (se pisan
# con -e TRABAJADOR_RAM / -e TRABAJADOR_CORES). Con RED=docker los nodos
# comparten la compu: 2048 MB cada uno, y los cores de fabrica de YARN.
TRABAJADOR_RAM_AUTO=no
if con_tunel && es_trabajador && [ -z "${TRABAJADOR_RAM:-}" ]; then
  TRABAJADOR_RAM=$(ram_para_trabajos);  TRABAJADOR_RAM_AUTO=si
fi
TRABAJADOR_RAM=${TRABAJADOR_RAM:-2048}
if con_tunel && es_trabajador; then TRABAJADOR_CORES=${TRABAJADOR_CORES:-$(docker_cores)}; fi
TRABAJADOR_CORES=${TRABAJADOR_CORES:-}

DATANODES_PEDIDO=${DATANODES:-}
if en_aula; then
  # Un DataNode por nodo, con los puertos de fabrica. Replicacion de fabrica:
  # 3 en la red de Docker; 2 en el aula de verdad, donde todo pasa por la PC
  # del profe (unos 50 Mbit/s): una copia en una PC y la otra en el maestro
  DATANODES=1
  if con_tunel; then REPLICATION=${REPLICATION:-2}; else REPLICATION=${REPLICATION:-3}; fi
  # JupyterLab solo si se pide: en el aula cada PC tiene la RAM justa
  JUPYTER=${JUPYTER:-no}
fi
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
fs_uri() {
  if ha; then echo hdfs://sandbox
  elif en_aula; then echo "hdfs://$MAESTRO:9000"
  else echo hdfs://localhost:9000; fi
}

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
  if en_aula; then
    HDFS_BASE+=(
      # El NameNode escucha en todas las interfaces y los demas lo buscan por nombre
      dfs.namenode.rpc-address "$MAESTRO:9000"
      dfs.namenode.rpc-bind-host 0.0.0.0
      # Cada DataNode se anuncia con su nombre (dfs.datanode.hostname); no hace
      # falta que la IP de origen resuelva al revés
      dfs.namenode.datanode.registration.ip-hostname-check false
      # Racks por fila del laboratorio (sandbox/bin/topologia)
      net.topology.script.file.name /opt/sandbox/bin/topologia
    )
  fi
}

# Pone (o reemplaza) propiedades en un XML de Hadoop/Hive ya existente.
# $1=archivo, resto = pares nombre valor
xml_poner() {
  python3 - "$@" <<'PY'
import sys
import xml.etree.ElementTree as ET
f, pares = sys.argv[1], sys.argv[2:]
arbol = ET.parse(f)
raiz = arbol.getroot()
for nombre, valor in zip(pares[0::2], pares[1::2]):
    for p in raiz.findall("property"):
        if p.findtext("name") == nombre:
            p.find("value").text = valor
            break
    else:
        p = ET.SubElement(raiz, "property")
        ET.SubElement(p, "name").text = nombre
        ET.SubElement(p, "value").text = valor
arbol.write(f, encoding="unicode", xml_declaration=True)
PY
}

# Version empresa: YARN, MapReduce, Hive y Spark apuntan al maestro
conf_aula() {
  local ram=$TRABAJADOR_RAM yarn=()
  # Los cores que presta cada nodo (sin TRABAJADOR_CORES, los de fabrica de YARN)
  if [ -n "$TRABAJADOR_CORES" ]; then yarn+=(yarn.nodemanager.resource.cpu-vcores "$TRABAJADOR_CORES"); fi
  # El tope de un contenedor lo pone el ResourceManager (el maestro): alto, y
  # YARN lo baja solo a lo que tiene la PC mas grande que se sumo
  # Una PC que se apaga: YARN la da por perdida (LOST) al minuto, no a los 10
  # de fabrica, y reintenta sus tareas en otras PCs (como HDFS a los 40 s)
  if es_maestro; then
    yarn+=(yarn.scheduler.maximum-allocation-mb 65536 yarn.scheduler.maximum-allocation-vcores 32
           yarn.nm.liveness-monitor.expiry-interval-ms 60000)
  else
    yarn+=(yarn.scheduler.maximum-allocation-mb "$ram")
  fi
  xml_poner "$HADOOP_CONF_DIR/yarn-site.xml" \
    yarn.resourcemanager.hostname "$MAESTRO" \
    yarn.resourcemanager.bind-host 0.0.0.0 \
    yarn.nodemanager.hostname "$NODO" \
    yarn.nodemanager.bind-host 0.0.0.0 \
    yarn.nodemanager.address "$NODO:8041" \
    yarn.nodemanager.resource.memory-mb "$ram" \
    yarn.log.server.url "http://$MAESTRO:19888/jobhistory/logs" \
    "${yarn[@]}"
  # Que YARN reparta por memoria Y por cores: cada PC aporta lo que tiene
  if es_maestro && [ -f "$HADOOP_CONF_DIR/capacity-scheduler.xml" ]; then
    xml_poner "$HADOOP_CONF_DIR/capacity-scheduler.xml" \
      yarn.scheduler.capacity.resource-calculator org.apache.hadoop.yarn.util.resource.DominantResourceCalculator
  fi
  xml_poner "$HADOOP_CONF_DIR/mapred-site.xml" \
    mapreduce.jobhistory.address "$MAESTRO:10020" \
    mapreduce.jobhistory.webapp.address "$MAESTRO:19888" \
    mapreduce.jobhistory.bind-host 0.0.0.0
  # La imagen trabajador no trae Hive ni Spark (le llegan desde HDFS)
  if [ -f "${HIVE_CONF_DIR:-/-}/hive-site.xml" ]; then
    xml_poner "$HIVE_CONF_DIR/hive-site.xml" hive.metastore.uris "thrift://$MAESTRO:9083"
  fi
  if [ -d "${SPARK_HOME:-/-}/conf" ]; then
    xml_poner "$SPARK_HOME/conf/hive-site.xml" hive.metastore.uris "thrift://$MAESTRO:9083"
    sed -i "s#localhost:18080#$MAESTRO:18080#" "$SPARK_HOME/conf/spark-defaults.conf"
  fi
  if es_maestro; then
    # Metastore sobre MariaDB (Derby embebido no aguanta una clase entera)
    xml_poner "$HIVE_CONF_DIR/hive-site.xml" \
      javax.jdo.option.ConnectionURL "jdbc:mysql://localhost:3306/metastore?useSSL=false" \
      javax.jdo.option.ConnectionDriverName com.mysql.jdbc.Driver \
      javax.jdo.option.ConnectionUserName hive \
      javax.jdo.option.ConnectionPassword hive \
      datanucleus.connectionPool.maxPoolSize 5 \
      hive.server2.thrift.bind.host 0.0.0.0
  fi
}

generar_conf() { # conf base, la que usan los clientes (hdfs, hive, spark...)
  local fs; fs=$(fs_uri)
  mkdir -p "$RUN_DIR"
  sed "s#@FS@#$fs#g" /opt/sandbox/templates/core-site.xml     > "$HADOOP_CONF_DIR/core-site.xml"
  # (la imagen trabajador no trae Tez ni Spark: no hay plantilla)
  if [ -f /opt/sandbox/templates/tez-site.xml ]; then
    sed "s#@FS@#$fs#g" /opt/sandbox/templates/tez-site.xml    > "$HADOOP_CONF_DIR/tez-site.xml"
  fi
  if [ -f /opt/sandbox/templates/spark-defaults.conf ]; then
    sed "s#@FS@#$fs#g" /opt/sandbox/templates/spark-defaults.conf > "$SPARK_HOME/conf/spark-defaults.conf"
  fi
  hdfs_base
  xml_conf "$HADOOP_CONF_DIR/hdfs-site.xml" "${HDFS_BASE[@]}"
  if en_aula; then conf_aula; fi
}

conf_instancia() { # $1=instancia, resto=pares propios de ese proceso -> imprime el dir
  local dir="$RUN_DIR/$1"; shift
  rm -rf "$dir" && cp -r "$HADOOP_CONF_DIR" "$dir"
  hdfs_base
  xml_conf "$dir/hdfs-site.xml" "${HDFS_BASE[@]}" "$@"
  echo "$dir"
}

dn_conf() {
  if en_aula; then
    # Puertos de fabrica (uno por nodo). El del maestro es el "archivo": su
    # disco es ARCHIVE y la politica WARM le manda una copia de cada bloque.
    local tipo=DISK
    if es_maestro; then tipo=ARCHIVE; fi
    conf_instancia "dn$1" \
      dfs.datanode.data.dir "[$tipo]/hadoop/dfs/dn$1" \
      dfs.datanode.address 0.0.0.0:9866 \
      dfs.datanode.ipc.address 0.0.0.0:9867 \
      dfs.datanode.http.address 0.0.0.0:9864 \
      dfs.datanode.hostname "$NODO"
    return
  fi
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
