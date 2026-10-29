#!/usr/bin/env bash
# Como quedaron repartidos los bloques de una carpeta (o archivo) de HDFS entre
# las PCs del aula: cuantas copias tiene cada nodo y en que fila esta. Lo usa
# empresa-profe.cmd despues de cargar un dataset; tambien se puede correr a mano:
#   docker exec bigdata-maestro /opt/sandbox/aula/bloques.sh /aula/datos
. /opt/sandbox/lib.sh
ruta=${1:-/}
hdfs fsck "$ruta" -files -blocks -locations 2>/dev/null > /tmp/bloques.txt
total=$(grep -c ' blk_' /tmp/bloques.txt || true)
# Cada copia: DatanodeInfoWithStorage[10.13.0.12:9866,DS-...,DISK]
grep -o 'DatanodeInfoWithStorage\[[^]]*\]' /tmp/bloques.txt \
  | sed -E 's/DatanodeInfoWithStorage\[([0-9.]+):[0-9]+,[^,]*,([A-Z]+)\]/\1 \2/' \
  | sort | uniq -c | while read -r n ip tipo; do
      nombre=$(getent hosts "$ip" | awk '{ print $2; exit }')
      printf '  %-8s %-14s %-9s %6s copias  %s\n' "${nombre:-?}" "$ip" "$(topologia "${nombre:-$ip}")" "$n" \
        "$([ "$tipo" = ARCHIVE ] && echo '(la del maestro: una de cada bloque)')"
    done | sort -k1,1
echo "  $total bloques en $ruta (replicacion $(hdfs getconf -confKey dfs.replication 2>/dev/null))"
grep -E 'Under-replicated blocks|Missing blocks|^Status' /tmp/bloques.txt | sed 's/^ */  /'
