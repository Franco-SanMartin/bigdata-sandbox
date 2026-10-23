#!/usr/bin/env bash
# Pruebas del cluster del aula (version empresa), simulado en una sola compu:
# un contenedor maestro y tres "PCs" (pc01..pc03) en una red de Docker. Las
# PCs van de a 2 por fila (PCS_POR_FILA=2): pc01 y pc02 son /fila1, pc03 /fila2.
#   bash pruebas/aula.sh aula         el cluster arma bien y reparte el trabajo
#   bash pruebas/aula.sh aula-caida   se apaga una PC de golpe y vuelve
#   IMAGEN=franki678/bigdata-sandbox:empresa bash pruebas/aula.sh aula
# GitHub Actions la corre con la imagen recien armada (workflow "Empresa").
# Con MEDIDAS=<archivo>, anota ahi la RAM de cada nodo.
set -eu   # sin pipefail: 'docker logs | grep -q' cortaria el pipe y daria error
cd "$(dirname "$0")/.."

IMAGEN=${IMAGEN:-franki678/bigdata-sandbox:empresa}
RED=${RED_PRUEBA:-aula}
PCS=(pc01 pc02 pc03)
NODOS=(maestro "${PCS[@]}")
COMUN=(--network "$RED" -e PCS_POR_FILA=2)
T=$(mktemp -d)   # logs de esta corrida
[ -n "${MEDIDAS:-}" ] && MEDIDAS=$(realpath "$MEDIDAS")

paso()  { echo; echo "=== $* ==="; }
falla() {
  echo "FALLA: $*" >&2
  local n
  for n in "${NODOS[@]}"; do
    echo "----- docker logs $n (ultimas 60 lineas) -----" >&2
    docker logs --tail 60 "$n" 2>&1 || true
  done
  exit 1
}
en()    { local n=$1; shift; docker exec "$n" bash -c "$1"; }

limpiar() {
  docker rm -fv "${NODOS[@]}" > /dev/null 2>&1 || true
  docker network rm "$RED" > /dev/null 2>&1 || true
}
trap 'limpiar; rm -rf "$T"' EXIT

listo() { # $1=nodo $2=cuantos "Cluster LISTO" (1 por arranque) $3=segundos
  local i
  for i in $(seq 1 $(( ${3:-900} / 4 ))); do
    [ "$(docker logs "$1" 2>&1 | grep -cx ' *Cluster LISTO')" -ge "${2:-1}" ] && return 0
    [ "$(docker inspect -f '{{.State.Running}}' "$1")" = true ] || falla "$1 se apago solo"
    sleep 4
  done
  falla "$1 no llego a 'Cluster LISTO'"
}

nn() { # valor $1 del JMX del NameNode (FSNamesystemState)
  en maestro "curl -s 'http://localhost:9870/jmx?qry=Hadoop:service=NameNode,name=FSNamesystemState' \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)[\"beans\"][0][\"$1\"])'"
}

nms() { # NodeManagers activos segun el ResourceManager
  en maestro "curl -s http://localhost:8088/ws/v1/cluster/metrics \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)[\"clusterMetrics\"][\"activeNodes\"])'"
}

esperar() { # $1=segundos $2=descripcion, resto = comando que tiene que dar bien
  local s=$1 d=$2 i; shift 2
  for i in $(seq 1 "$s"); do
    "$@" > /dev/null 2>&1 && return 0
    sleep 1
  done
  falla "$d (despues de $s s)"
}

igual() { [ "$("${@:2}")" = "$1" ]; }   # igual <esperado> comando...

medir() { # $1=momento: RAM de cada nodo
  [ -n "${MEDIDAS:-}" ] || return 0
  docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' "${NODOS[@]}" \
    | while read -r n uso _; do echo "| $ESC | $1 | $n | $uso |" >> "$MEDIDAS"; done
}

armar() { # la red, el maestro y las 3 PCs; espera que todos esten listos
  paso "Armando el aula: maestro + ${PCS[*]} (imagen $IMAGEN)"
  limpiar
  docker network create "$RED" > /dev/null
  docker run -d --name maestro --hostname maestro "${COMUN[@]}" -e ROL=maestro "$IMAGEN" > /dev/null
  local p
  for p in "${PCS[@]}"; do
    docker run -d --name "$p" --hostname "$p" "${COMUN[@]}" -e ROL=trabajador -e MAESTRO=maestro "$IMAGEN" > /dev/null
  done
  local t0=$SECONDS
  listo maestro 1 1200
  for p in "${PCS[@]}"; do listo "$p" 1 600; done
  echo "aula lista en $(( SECONDS - t0 )) s"
  esperar 120 "el NameNode no ve los 4 DataNodes" igual 4 nn NumLiveDataNodes
  esperar 120 "el ResourceManager no ve los 3 NodeManagers" igual 3 nms
  echo "4 DataNodes vivos, 3 NodeManagers activos"
}

subir() { # $1=nodo desde donde $2=archivo en HDFS $3=MB: archivo con bloques de 1 MB
  en "$1" "head -c ${3}M /dev/urandom > /tmp/subida && hdfs dfs -D dfs.blocksize=1m -put -f /tmp/subida $2 && rm /tmp/subida"
}

sin_subreplicados() { igual 0 nn UnderReplicatedBlocks; }

fsck_sano() { en maestro "hdfs fsck / 2>/dev/null | grep -q 'is HEALTHY'"; }

# -------------------------------------------------------------------- aula
esc_aula() {
  ESC=aula
  armar
  medir "en reposo"

  paso "Racks: /profe el maestro, de a 2 PCs por fila"
  racks=$(en maestro "hdfs dfsadmin -printTopology 2>/dev/null" | awk '
    /^Rack:/ { r = $2 }
    /\(/     { match($0, /\(([^)]*)\)/); h = substr($0, RSTART + 1, RLENGTH - 2)
               sub(/\..*/, "", h); print r, h }' | sort)   # pc01.aula -> pc01 (el DNS de la red le suma el dominio)
  echo "$racks"
  [ "$racks" = "$(printf '/fila1 pc01\n/fila1 pc02\n/fila2 pc03\n/profe maestro')" ] || falla "racks mal armados"

  paso "Un archivo de 10 MB desde pc01: 3 replicas y siempre una en el maestro (ARCHIVE)"
  subir pc01 /aula/prueba.bin 10
  esperar 120 "quedaron bloques sub-replicados" sin_subreplicados
  en maestro "hdfs fsck /aula/prueba.bin -files -blocks -locations 2>/dev/null" > "$T/fsck.txt"
  bloques=$(grep -c 'blk_' "$T/fsck.txt" || true)
  bien=$(grep 'blk_' "$T/fsck.txt" | grep 'Live_repl=3' | awk '{ print gsub(/ARCHIVE/, "") }' | grep -cx 1 || true)
  echo "bloques $bloques, con 3 replicas y una en ARCHIVE: $bien"
  [ "$bloques" -eq 10 ] && [ "$bien" -eq 10 ] || { cat "$T/fsck.txt"; falla "replicas mal ubicadas"; }

  paso "wordcount desde pc01: los maps corren en mas de una PC"
  en maestro "python3 -c 'import random
p = [\"hdfs\", \"yarn\", \"hive\", \"spark\", \"bloque\", \"rack\", \"fila\", \"profe\"]
r = random.Random(1)
with open(\"/tmp/texto.txt\", \"w\") as f:
    while f.tell() < 8 * 1024 * 1024:
        f.write(\" \".join(r.choice(p) for _ in range(12)) + \"\\n\")' \
    && hdfs dfs -D dfs.blocksize=1m -put -f /tmp/texto.txt /aula/texto.txt && rm /tmp/texto.txt"
  en pc01 'hdfs dfs -rm -r -f -skipTrash /aula/conteo > /dev/null 2>&1; yarn jar "$HADOOP_HOME"/share/hadoop/mapreduce/hadoop-mapreduce-examples-*.jar \
    wordcount /aula/texto.txt /aula/conteo' > "$T/wordcount.log" 2>&1 || { tail -40 "$T/wordcount.log"; falla "wordcount"; }
  trabajo=$(grep -o 'job_[0-9]*_[0-9]*' "$T/wordcount.log" | head -1)
  [ -n "$trabajo" ] || { tail -40 "$T/wordcount.log"; falla "no se encontro el id del trabajo"; }
  en pc01 "hdfs dfs -cat /aula/conteo/part-r-* | grep -qw hdfs" || falla "wordcount sin resultado"
  maquinas=""
  for _ in $(seq 1 30); do
    maquinas=$(docker exec -i maestro python3 - "$trabajo" <<'PY' 2>/dev/null || true
import json, sys, urllib.request
base = "http://localhost:19888/ws/v1/history/mapreduce/jobs/" + sys.argv[1]
def leer(u):
    return json.load(urllib.request.urlopen(base + u, timeout=10))
nodos = set()
for t in leer("/tasks?type=m")["tasks"]["task"]:
    for a in leer("/tasks/" + t["id"] + "/attempts")["taskAttempts"]["taskAttempt"]:
        nodos.add(a["nodeHttpAddress"].split(":")[0])
print(" ".join(sorted(nodos)))
PY
)
    [ -n "$maquinas" ] && break
    sleep 2
  done
  echo "maps de $trabajo en: ${maquinas:-?}"
  n=$(wc -w <<<"$maquinas")
  [ "$n" -ge 2 ] || falla "los maps no se repartieron entre las PCs ($maquinas)"
  grep -qw maestro <<<"$maquinas" && falla "corrieron maps en el maestro (sin NodeManager)"
  medir "despues de wordcount"

  paso "Hive (Metastore en MariaDB del maestro) desde pc02"
  en pc02 "beeline -u jdbc:hive2://maestro:10000 -n root --silent=true -e \"
    CREATE TABLE IF NOT EXISTS aula_prueba (n INT);
    INSERT INTO aula_prueba VALUES (1), (2), (3);
    SELECT 'filas', COUNT(*) FROM aula_prueba;\"" > "$T/hive.log" 2>&1 || { tail -40 "$T/hive.log"; falla "beeline"; }
  grep -q 'filas.*3' "$T/hive.log" || { tail -40 "$T/hive.log"; falla "Hive no devolvio las 3 filas"; }
  tablas=$(en maestro "mysql -N -e \"SELECT COUNT(*) FROM metastore.TBLS WHERE TBL_NAME = 'aula_prueba'\"")
  [ "$tablas" = 1 ] || falla "la tabla no esta en el Metastore de MariaDB ($tablas)"
  echo "Hive ok: 3 filas, tabla anotada en metastore.TBLS"

  paso "Spark (SparkPi) desde pc03"
  en pc03 'spark-submit --master yarn --class org.apache.spark.examples.SparkPi "$SPARK_HOME"/examples/jars/spark-examples_*.jar 20' \
    > "$T/spark.log" 2>&1 || { tail -40 "$T/spark.log"; falla "SparkPi"; }
  grep 'Pi is roughly' "$T/spark.log" || falla "SparkPi sin resultado"
  medir "despues de Hive y Spark"

  en pc02 estado > /dev/null || falla "estado en una PC"
  en maestro estado > /dev/null || falla "estado en el maestro"
  echo; echo "OK aula"
}

# -------------------------------------------------------------- aula-caida
esc_aula_caida() {
  ESC=aula-caida
  armar
  subir pc01 /aula/caida.bin 10
  esperar 120 "quedaron bloques sub-replicados antes de la caida" sin_subreplicados

  paso "pc02 se apaga de golpe (docker kill)"
  docker kill pc02 > /dev/null
  t0=$SECONDS
  esperar 120 "el NameNode no marco muerta a pc02" igual 1 nn NumDeadDataNodes
  muerta=$(( SECONDS - t0 ))
  echo "pc02 marcada muerta a los $muerta s"
  [ "$muerta" -le 60 ] || falla "tardo $muerta s en darla por muerta (maximo 60)"
  medir "con pc02 caida"

  paso "Re-replicacion en las PCs que quedan"
  t0=$SECONDS
  esperar 300 "siguen bloques sub-replicados sin pc02" sin_subreplicados
  echo "sin bloques sub-replicados a los $(( SECONDS - t0 )) s"
  esperar 60 "fsck no da HEALTHY sin pc02" fsck_sano
  en pc01 "hdfs dfs -cat /aula/caida.bin | wc -c" | grep -qx 10485760 || falla "no se lee el archivo sin pc02"

  paso "pc02 vuelve: sus copias de mas se borran"
  docker start pc02 > /dev/null
  listo pc02 2 600
  esperar 120 "el NameNode no ve otra vez los 4 DataNodes" igual 4 nn NumLiveDataNodes
  sobran() { en maestro "hdfs fsck / 2>/dev/null | grep -Eq 'Over-replicated blocks:[[:space:]]+0 '"; }
  t0=$SECONDS
  esperar 300 "quedaron bloques sobre-replicados" sobran
  echo "sin copias de mas a los $(( SECONDS - t0 )) s"
  fsck_sano || falla "fsck no da HEALTHY con pc02 de vuelta"
  echo; echo "OK aula-caida"
}

case "${1:-}" in
  aula)       esc_aula ;;
  aula-caida) esc_aula_caida ;;
  *) echo "Uso: bash pruebas/aula.sh aula|aula-caida" >&2; exit 2 ;;
esac
