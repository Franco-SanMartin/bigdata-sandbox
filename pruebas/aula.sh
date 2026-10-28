#!/usr/bin/env bash
# Pruebas del cluster del aula (version empresa).
#
# Con RED=docker (el aula simulada en una sola compu): un contenedor maestro y
# tres "PCs" (pc01..pc03) en una red de Docker. Las PCs van de a 2 por fila
# (PCS_POR_FILA=2): pc01 y pc02 son /fila1, pc03 /fila2.
#   bash pruebas/aula.sh aula            el cluster arma bien y reparte el trabajo
#   bash pruebas/aula.sh aula-caida      se apaga una PC de golpe y vuelve
#
# Con RED=wireguard (el aula de verdad), como la sonda en el CI: el maestro
# publica UDP 51820 (el hub) y TCP 8099 (la inscripcion) en el host, y cada
# PC esta en SU red de Docker, sin verse con las otras y sin publicar ningun
# puerto: solo llega a la PC del profe por la IP del host, como las PCs del
# aula llegan a la del profe por la red local. Las PCs usan la imagen
# trabajador, con la RAM que midio la sonda para Docker (3863 y 7828 MB).
#   bash pruebas/aula.sh aula-wg         se suman 3 PCs por el tunel: nombres e
#                                        IPs, MTU, racks, replicas, YARN con PCs
#                                        de distinta RAM, MapReduce, Hive, PySpark
#   bash pruebas/aula.sh aula-wg-caida   una PC se apaga de golpe: re-replicacion,
#                                        YARN la pierde, y vuelve con su IP
#   bash pruebas/aula.sh aula-wg-cero    arranque de cero e idempotencia: codigo
#                                        equivocado, wireguard-go sin modulo,
#                                        reinicios del maestro y de una PC, una PC
#                                        rearmada y un maestro nuevo con la misma PC
#
#   IMAGEN=franki678/bigdata-sandbox:empresa IMAGEN_TRABAJADOR=franki678/bigdata-sandbox:trabajador \
#     bash pruebas/aula.sh aula-wg
# GitHub Actions las corre con las imagenes recien armadas (workflow "Empresa").
# Con MEDIDAS=<archivo>, anota ahi la RAM de cada nodo.
set -eu   # sin pipefail: 'docker logs | grep -q' cortaria el pipe y daria error
cd "$(dirname "$0")/.."

IMAGEN=${IMAGEN:-franki678/bigdata-sandbox:empresa}
IMAGEN_TRABAJADOR=${IMAGEN_TRABAJADOR:-franki678/bigdata-sandbox:trabajador}
RED=${RED_PRUEBA:-aula}
PCS=(pc01 pc02 pc03)
NODOS=(maestro "${PCS[@]}")
COMUN=(--network "$RED" -e PCS_POR_FILA=2)
# Las PCs del aula con el tunel: dos de 8 GB y una de 16, como en el laboratorio
WPCS=(wpc1 wpc2 wpc3)
WNOMBRE=(PC107 PC137 PC180)
WRAM=(3863m 7828m 3863m)     # lo que tenia Docker en cada una (sonda, 27/10)
WCPUS=(0-1 0-3 0-1)          # y menos cores en las viejas
MTU=1380
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
  docker rm -fv maestro "${PCS[@]}" "${WPCS[@]}" intrusa > /dev/null 2>&1 || true
  docker network rm "$RED" aula-wg-profe "${WPCS[@]/#/aula-wg-}" > /dev/null 2>&1 || true
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

# ============================================= red del aula: RED=wireguard
# La "IP de la PC del profe" vista desde las PCs: la del host en la red de
# Docker de fabrica (por ahi llegan a los puertos que publica el maestro)
HUB=${HUB_PRUEBA:-$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || true)}
CODIGO=

logs_dicen() { docker logs "$1" 2>&1 | grep -q "$2"; }   # logs_dicen <contenedor> <texto>

maestro_wg() { # el maestro con el hub (sin interfaz publicada: se la mira desde adentro)
  docker network create aula-wg-profe > /dev/null 2>&1 || true
  docker run -d --name maestro --hostname maestro --network aula-wg-profe \
    --cap-add NET_ADMIN --device /dev/net/tun --sysctl net.ipv4.ip_forward=1 \
    -p 51820:51820/udp -p 8099:8099 \
    -e ROL=maestro -e RED=wireguard -e PCS_POR_FILA=2 -e IP_AULA="$HUB" "$@" "$IMAGEN" > /dev/null
  esperar 120 "el maestro no abrio la inscripcion" en maestro "curl -sf http://localhost:8099/ping"
  CODIGO=$(en maestro "cat /hadoop/aula/codigo")
}

sumar() { # $1=wpcN [opciones de docker run]: una PC en SU red, sin puertos publicados
  local p=$1 i nodo; i=$(( ${1#wpc} - 1 )); shift
  docker network create "aula-wg-$p" > /dev/null 2>&1 || true
  # Como empresa-alumno.cmd: primero reserva el nombre (pcNN) y despues crea
  # el contenedor con ese nombre de maquina
  nodo=$(docker run --rm --network "aula-wg-$p" --entrypoint /opt/sandbox/aula/red.sh \
    -e RED=wireguard -e ROL=trabajador -e MAESTRO="$HUB" -e CODIGO="$CODIGO" -e PC_NOMBRE="${WNOMBRE[$i]}" \
    "$IMAGEN_TRABAJADOR" reservar 2>/dev/null | sed -n 's/^NODO=//p')
  [ -n "$nodo" ] || falla "$p no pudo reservar su nombre en el maestro"
  docker run -d --name "$p" --hostname "$nodo" --network "aula-wg-$p" --cap-add NET_ADMIN --device /dev/net/tun \
    --memory "${WRAM[$i]}" --cpuset-cpus "${WCPUS[$i]}" --stop-timeout 20 \
    -e RED=wireguard -e MAESTRO="$HUB" -e CODIGO="$CODIGO" -e PC_NOMBRE="${WNOMBRE[$i]}" \
    "$@" "$IMAGEN_TRABAJADOR" > /dev/null
  esperar 120 "$p no se sumo por el tunel" logs_dicen "$p" "Esta PC es pc"
}

armar_wg() { # $@ = las PCs (wpc1...): el maestro con el hub y las PCs por el tunel
  paso "Armando el aula con el tunel: maestro + $* (imagenes $IMAGEN y $IMAGEN_TRABAJADOR, profe en $HUB)"
  limpiar
  local t0=$SECONDS p
  maestro_wg
  echo "codigo de la clase: $CODIGO (inscripcion abierta a los $(( SECONDS - t0 )) s)"
  for p in "$@"; do sumar "$p"; done
  listo maestro 1 1200
  for p in "$@"; do listo "$p" 1 600; done
  echo "aula lista en $(( SECONDS - t0 )) s"
  esperar 120 "el NameNode no ve $(( $# + 1 )) DataNodes" igual $(( $# + 1 )) nn NumLiveDataNodes
  esperar 120 "el ResourceManager no ve $# NodeManagers" igual "$#" nms
  echo "$(( $# + 1 )) DataNodes vivos, $# NodeManagers activos"
}

aula_api() { # $1 = expresion de Python sobre a (el JSON de /api/aula); imprime el resultado
  en maestro "curl -s http://localhost:8080/api/aula" | docker exec -i maestro python3 -c "
import json, sys
a = json.load(sys.stdin)
print($1)"
}

recursos_rm() { # "pc01 2048 2" por NodeManager: memoria y cores que presta cada PC
  docker exec -i maestro python3 - <<'PY'
import json, urllib.request
d = json.load(urllib.request.urlopen("http://localhost:8088/ws/v1/cluster/nodes", timeout=10))
for n in sorted(d["nodes"]["node"], key=lambda n: n["nodeHostName"]):
    if n["state"] == "RUNNING":
        t = n["totalResource"]
        print(n["nodeHostName"], t["memory"], t["vCores"])
PY
}

estado_nm() { # $1=pcNN: estado del NodeManager segun el ResourceManager
  docker exec -i maestro python3 - "$1" <<'PY'
import json, sys, urllib.request
d = json.load(urllib.request.urlopen("http://localhost:8088/ws/v1/cluster/nodes", timeout=10))
print(next((n["state"] for n in d["nodes"]["node"] if n["nodeHostName"] == sys.argv[1]), "-"))
PY
}

replicas_wg() { # $1=archivo: cada bloque con REPLICATION copias y una en el maestro (ARCHIVE)
  en maestro "hdfs fsck $1 -files -blocks -locations 2>/dev/null" > "$T/fsck.txt"
  bloques=$(grep -c 'blk_' "$T/fsck.txt" || true)
  bien=$(grep 'blk_' "$T/fsck.txt" | grep "Live_repl=$2" | awk '{ print gsub(/ARCHIVE/, "") }' | grep -cx 1 || true)
  echo "bloques $bloques, con $2 replicas y una en ARCHIVE: $bien"
  [ "$bloques" -gt 0 ] && [ "$bien" -eq "$bloques" ] || { cat "$T/fsck.txt"; falla "replicas mal ubicadas en $1"; }
}

# ------------------------------------------------------------------ aula-wg
esc_aula_wg() {
  ESC=aula-wg
  NODOS=(maestro "${WPCS[@]}")
  armar_wg "${WPCS[@]}"
  medir "en reposo"

  paso "Las PCs no publican puertos ni se ven entre ellas: todo pasa por el tunel"
  for p in "${WPCS[@]}"; do
    [ "$(docker inspect -f '{{json .HostConfig.PortBindings}}' "$p")" = "{}" ] || falla "$p publica puertos"
  done
  ip2=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' wpc2)
  if en wpc1 "ping -c 1 -W 2 $ip2" > /dev/null 2>&1; then falla "wpc1 llega directo a wpc2: las redes no estan aisladas"; fi
  for i in 1 2 3; do
    [ "$(en "wpc$i" '. /hadoop/aula/nodo.env; echo $NODO $IP_TUNEL')" = "pc0$i 10.13.0.1$i" ] \
      || falla "wpc$i no es pc0$i con 10.13.0.1$i"
  done
  en wpc1 "curl -sf -o /dev/null http://pc02:9864/" || falla "pc01 no llega al DataNode de pc02 por el hub"
  echo "pc01 = 10.13.0.11, pc02 = 10.13.0.12, pc03 = 10.13.0.13: pc01 llega a pc02 solo por el hub"

  paso "MTU del tunel: paquetes de $MTU bytes pasan enteros, al maestro y entre PCs (por el hub)"
  en wpc1 "ping -c 2 -W 2 -M do -s $(( MTU - 28 )) maestro && ping -c 2 -W 2 -M do -s $(( MTU - 28 )) pc03" > /dev/null \
    || falla "los paquetes de $MTU bytes no pasan por el tunel"
  if en wpc1 "ping -c 1 -W 2 -M do -s $(( MTU - 27 )) maestro" > /dev/null 2>&1; then falla "el MTU del tunel no es $MTU"; fi
  echo "ok: pasan los de $MTU y no los de $(( MTU + 1 ))"

  paso "HDFS y YARN ven a cada PC por su IP del tunel; racks por fila"
  docker exec -i maestro python3 - > "$T/dns.txt" <<'PY'
import json, urllib.request
b = json.load(urllib.request.urlopen("http://localhost:9870/jmx?qry=Hadoop:service=NameNode,name=NameNodeInfo", timeout=10))
for k, v in sorted(json.loads(b["beans"][0]["LiveNodes"]).items()):
    print(k, v["xferaddr"])
PY
  cat "$T/dns.txt"
  [ "$(cat "$T/dns.txt")" = "$(printf '%s\n' 'maestro:9866 10.13.0.1:9866' 'pc01:9866 10.13.0.11:9866' \
    'pc02:9866 10.13.0.12:9866' 'pc03:9866 10.13.0.13:9866')" ] || falla "los DataNodes no estan con sus IPs del tunel"
  racks=$(en maestro "hdfs dfsadmin -printTopology 2>/dev/null" | awk '
    /^Rack:/ { r = $2 }
    /\(/     { match($0, /\(([^)]*)\)/); print r, substr($0, RSTART + 1, RLENGTH - 2) }' | sort)
  echo "$racks"
  [ "$racks" = "$(printf '/fila1 pc01\n/fila1 pc02\n/fila2 pc03\n/profe maestro')" ] || falla "racks mal armados"

  paso "Cada PC presta lo que tiene: 2/3 de la RAM de Docker y sus cores"
  recursos_rm | tee "$T/rm.txt"
  [ "$(cat "$T/rm.txt")" = "$(printf 'pc01 2048 2\npc02 5120 4\npc03 2048 2')" ] \
    || falla "YARN no ve 2048 MB / 2 cores en las PCs de 8 GB y 5120 MB / 4 cores en la de 16"
  en wpc2 estado | grep -q 'Esta PC presta.*5120 MB y 4 cores' || { en wpc2 estado; falla "estado no dice lo que presta la PC"; }

  paso "Un archivo subido desde el maestro: 2 replicas (la de fabrica del aula) y una en el maestro"
  subir maestro /aula/prueba.bin 10
  esperar 120 "quedaron bloques sub-replicados" sin_subreplicados
  replicas_wg /aula/prueba.bin 2
  esperar 60 "la vista Aula no dice 'ya pueden apagar'" igual True aula_api 'a["apagar"]["listo"]'
  [ "$(aula_api '[(p["nodo"], p["nombre"], p["estado"]) for p in a["pcs"]]')" = \
    "[('pc01', 'PC107', 'arriba'), ('pc02', 'PC137', 'arriba'), ('pc03', 'PC180', 'arriba')]" ] \
    || falla "la vista Aula no muestra las 3 PCs arriba: $(aula_api 'a["pcs"]')"
  [ "$(aula_api '(a["codigo"], a["yarn"]["mb"], a["yarn"]["vcores"])')" = "('$CODIGO', 9216, 8)" ] \
    || falla "la vista Aula: codigo o recursos mal: $(aula_api '(a["codigo"], a["yarn"])')"
  echo "vista Aula: 3 PCs arriba, 9216 MB y 8 cores, ya pueden apagar"

  paso "wordcount desde el maestro: los maps corren en las PCs, nunca en el maestro"
  en maestro "python3 -c 'import random
p = [\"hdfs\", \"yarn\", \"hive\", \"spark\", \"bloque\", \"rack\", \"fila\", \"profe\"]
r = random.Random(1)
with open(\"/tmp/texto.txt\", \"w\") as f:
    while f.tell() < 8 * 1024 * 1024:
        f.write(\" \".join(r.choice(p) for _ in range(12)) + \"\\n\")' \
    && hdfs dfs -D dfs.blocksize=1m -put -f /tmp/texto.txt /aula/texto.txt && rm /tmp/texto.txt"
  en maestro 'yarn jar "$HADOOP_HOME"/share/hadoop/mapreduce/hadoop-mapreduce-examples-*.jar \
    wordcount /aula/texto.txt /aula/conteo' > "$T/wordcount.log" 2>&1 || { tail -40 "$T/wordcount.log"; falla "wordcount"; }
  en maestro "hdfs dfs -cat /aula/conteo/part-r-* | grep -qw hdfs" || falla "wordcount sin resultado"
  trabajo=$(grep -o 'job_[0-9]*_[0-9]*' "$T/wordcount.log" | head -1)
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
  [ "$(wc -w <<<"$maquinas")" -ge 2 ] || falla "los maps no se repartieron entre las PCs ($maquinas)"
  if grep -qw maestro <<<"$maquinas"; then falla "corrieron maps en el maestro"; fi
  medir "despues de wordcount"

  paso "Hive (Tez en las PCs: sus librerias llegan desde HDFS)"
  en maestro "beeline -u jdbc:hive2://localhost:10000 -n root --silent=true -e \"
    CREATE TABLE IF NOT EXISTS aula_prueba (n INT);
    INSERT INTO aula_prueba VALUES (1), (2), (3);
    SELECT 'filas', COUNT(*) FROM aula_prueba;\"" > "$T/hive.log" 2>&1 || { tail -40 "$T/hive.log"; falla "beeline"; }
  grep -q 'filas.*3' "$T/hive.log" || { tail -40 "$T/hive.log"; falla "Hive no devolvio las 3 filas"; }
  echo "Hive ok"

  paso "PySpark con numpy en los executors (Spark llega desde HDFS: spark.yarn.archive)"
  docker exec -i maestro sh -c 'cat > /tmp/aula_numpy.py' <<'PY'
import os
from pyspark.sql import SparkSession
s = SparkSession.builder.appName("aula-numpy").getOrCreate()
def f(i):
    import numpy
    return (os.environ.get("NM_HOST", "?"), numpy.__version__, float(numpy.sqrt(i)) ** 2)
r = s.sparkContext.parallelize(range(1, 2001), 8).map(f).collect()
print("NODOS", " ".join(sorted({x[0] for x in r})))
print("NUMPY", " ".join(sorted({x[1] for x in r})))
print("SUMA", round(sum(x[2] for x in r)))
s.stop()
PY
  en maestro 'spark-submit --master yarn --num-executors 3 /tmp/aula_numpy.py' > "$T/pyspark.log" 2>&1 \
    || { tail -40 "$T/pyspark.log"; falla "PySpark"; }
  grep -E '^(NODOS|NUMPY|SUMA)' "$T/pyspark.log"
  grep -qx 'SUMA 2001000' "$T/pyspark.log" || { tail -40 "$T/pyspark.log"; falla "PySpark sin el resultado"; }
  grep -q '^NODOS pc0' "$T/pyspark.log" || falla "los executors no corrieron en las PCs"
  [ "$(grep '^NUMPY' "$T/pyspark.log")" = "NUMPY $(en maestro "python3 -c 'import numpy; print(numpy.__version__)'")" ] \
    || falla "las PCs tienen otro numpy que el maestro"
  medir "despues de Hive y Spark"

  en wpc1 estado > /dev/null || falla "estado en una PC"
  en maestro estado | grep -q 'Red del aula' || falla "estado en el maestro"
  echo; echo "OK aula-wg"
}

# ------------------------------------------------------------- aula-wg-caida
esc_aula_wg_caida() {
  ESC=aula-wg-caida
  NODOS=(maestro "${WPCS[@]}")
  armar_wg "${WPCS[@]}"
  subir maestro /aula/caida.bin 12
  esperar 120 "quedaron bloques sub-replicados antes de la caida" sin_subreplicados
  replicas_wg /aula/caida.bin 2

  paso "pc02 (PC137) se apaga de golpe (docker kill)"
  docker kill wpc2 > /dev/null
  t0=$SECONDS
  esperar 120 "el NameNode no marco muerta a pc02" igual 1 nn NumDeadDataNodes
  muerta=$(( SECONDS - t0 ))
  echo "pc02 marcada muerta a los $muerta s"
  [ "$muerta" -le 60 ] || falla "tardo $muerta s en darla por muerta (maximo 60)"
  esperar 30 "la vista Aula no la muestra caida" igual caida aula_api 'next(p["estado"] for p in a["pcs"] if p["nodo"] == "pc02")'
  medir "con pc02 caida"

  paso "Re-replicacion: cada bloque vuelve a tener 2 copias, una en el maestro"
  t0=$SECONDS
  esperar 300 "siguen bloques sub-replicados sin pc02" sin_subreplicados
  echo "sin bloques sub-replicados a los $(( SECONDS - t0 )) s"
  esperar 60 "fsck no da HEALTHY sin pc02" fsck_sano
  replicas_wg /aula/caida.bin 2
  en wpc1 "hdfs dfs -cat /aula/caida.bin | wc -c" | grep -qx 12582912 || falla "no se lee el archivo sin pc02"

  paso "YARN la da por perdida al minuto (LOST) y deja de contar su memoria"
  t0=$SECONDS
  esperar 150 "YARN no dio por perdida a pc02" igual LOST estado_nm pc02
  echo "pc02 LOST a los $(( SECONDS - t0 )) s mas"
  esperar 30 "YARN sigue contando la memoria de pc02" igual 4096 aula_api 'a["yarn"]["mb"]'

  paso "pc02 vuelve (docker start): se vuelve a sumar sola, con el mismo nombre y la misma IP"
  docker start wpc2 > /dev/null
  listo wpc2 2 600
  [ "$(en wpc2 '. /hadoop/aula/nodo.env; echo $NODO $IP_TUNEL')" = "pc02 10.13.0.12" ] || falla "pc02 volvio con otro nombre o IP"
  esperar 120 "el NameNode no ve otra vez los 4 DataNodes" igual 4 nn NumLiveDataNodes
  esperar 120 "YARN no ve otra vez los 3 NodeManagers" igual 3 nms
  sobran() { en maestro "hdfs fsck / 2>/dev/null | grep -Eq 'Over-replicated blocks:[[:space:]]+0 '"; }
  t0=$SECONDS
  esperar 300 "quedaron bloques sobre-replicados" sobran
  echo "sin copias de mas a los $(( SECONDS - t0 )) s"
  fsck_sano || falla "fsck no da HEALTHY con pc02 de vuelta"
  echo; echo "OK aula-wg-caida"
}

# -------------------------------------------------------------- aula-wg-cero
esc_aula_wg_cero() {
  ESC=aula-wg-cero
  NODOS=(maestro wpc1 wpc2)
  paso "Arranque de cero: el maestro con el hub y un codigo fijo (CODIGO=AULA)"
  limpiar
  t0=$SECONDS
  maestro_wg -e CODIGO=AULA
  [ "$CODIGO" = AULA ] || falla "el maestro no tomo CODIGO=AULA ($CODIGO)"

  paso "Una PC con el codigo equivocado: no entra, y dice por que"
  docker network create aula-wg-wpc3 > /dev/null 2>&1 || true
  if docker run --name intrusa --network aula-wg-wpc3 --cap-add NET_ADMIN -e RED=wireguard -e MAESTRO="$HUB" \
       -e CODIGO=ZZZZ -e PC_NOMBRE=INTRUSA "$IMAGEN_TRABAJADOR" > "$T/intrusa.log" 2>&1; then
    falla "una PC con otro codigo se sumo igual"
  fi
  grep -q "no es el de esta clase" "$T/intrusa.log" || { cat "$T/intrusa.log"; falla "no dice que el codigo esta mal"; }
  docker rm -f intrusa > /dev/null
  [ "$(en maestro 'ls /hadoop/aula/pcs | wc -l')" = 0 ] || falla "la PC intrusa quedo inscripta"
  echo "rechazada: $(grep -o 'el codigo.*' "$T/intrusa.log" | head -1)"

  paso "pc01 sin el modulo WireGuard (wireguard-go) y pc02 con el del kernel"
  sumar wpc1 -e SIMULAR_SIN_KERNEL=1
  sumar wpc2
  en wpc1 "cat /hadoop/aula/modo" | grep -qx go || falla "pc01 no uso wireguard-go"
  en wpc2 "cat /hadoop/aula/modo" | grep -qx kernel || falla "pc02 no uso el modulo del kernel"
  listo maestro 1 1200
  listo wpc1 1 600; listo wpc2 1 600
  esperar 120 "el NameNode no ve los 3 DataNodes" igual 3 nn NumLiveDataNodes
  esperar 120 "YARN no ve los 2 NodeManagers" igual 2 nms
  echo "aula de cero lista en $(( SECONDS - t0 )) s"
  subir maestro /aula/cero.bin 6
  esperar 120 "quedaron bloques sub-replicados" sin_subreplicados
  replicas_wg /aula/cero.bin 2
  esperar 60 "no dice 'ya pueden apagar'" igual True aula_api 'a["apagar"]["listo"]'

  paso "docker restart del maestro: mismo codigo y mismo tunel, las PCs vuelven solas"
  docker restart -t 20 maestro > /dev/null
  listo maestro 2 1200
  [ "$(en maestro 'cat /hadoop/aula/codigo')" = AULA ] || falla "el maestro cambio el codigo al reiniciar"
  esperar 180 "el NameNode no ve otra vez los 3 DataNodes" igual 3 nn NumLiveDataNodes
  esperar 180 "YARN no ve otra vez los 2 NodeManagers" igual 2 nms
  en wpc1 "hdfs dfs -cat /aula/cero.bin | wc -c" | grep -qx 6291456 || falla "no se lee el archivo despues del reinicio"
  echo "las PCs volvieron solas, sin correr nada en ellas"

  paso "pc02 rearmada de cero (otro contenedor, volumen nuevo): mismo nombre de PC, misma IP"
  docker rm -fv wpc2 > /dev/null
  sumar wpc2
  listo wpc2 1 600
  [ "$(en wpc2 '. /hadoop/aula/nodo.env; echo $NODO $IP_TUNEL')" = "pc02 10.13.0.12" ] || falla "pc02 rearmada con otro nombre o IP"
  esperar 120 "el NameNode no ve los 3 DataNodes con pc02 rearmada" igual 3 nn NumLiveDataNodes
  esperar 300 "quedaron bloques sub-replicados con pc02 rearmada" sin_subreplicados
  [ "$(en maestro 'ls /hadoop/aula/pcs | wc -l')" = 2 ] || falla "pc02 quedo inscripta dos veces"

  paso "Otra clase: un maestro nuevo (volumen nuevo) y pc01 sin tocar se vuelve a sumar"
  docker rm -fv maestro > /dev/null
  maestro_wg -e CODIGO=AULA
  listo maestro 1 1200
  docker restart -t 20 wpc1 > /dev/null
  listo wpc1 2 600
  docker logs wpc1 2>&1 | grep -q "es de otra clase" || falla "pc01 no se dio cuenta de que el maestro es otro"
  esperar 120 "el NameNode nuevo no ve a pc01" igual 2 nn NumLiveDataNodes
  [ "$(en wpc1 '. /hadoop/aula/nodo.env; echo $NODO')" = pc01 ] || falla "pc01 con otro nombre en la clase nueva"
  echo; echo "OK aula-wg-cero"
}

case "${1:-}" in
  aula)          esc_aula ;;
  aula-caida)    esc_aula_caida ;;
  aula-wg)       esc_aula_wg ;;
  aula-wg-caida) esc_aula_wg_caida ;;
  aula-wg-cero)  esc_aula_wg_cero ;;
  *) echo "Uso: bash pruebas/aula.sh aula|aula-caida|aula-wg|aula-wg-caida|aula-wg-cero" >&2; exit 2 ;;
esac
