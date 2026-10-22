#!/bin/bash
# Imita la salida de /opt/entrypoint.sh (mismos mensajes, con colores) sin
# arrancar nada. Variables para las pruebas:
#   FALSO_PAUSA   segundos entre pasos (por defecto 0.05)
#   FALSO_FALLA   si vale "parametros", corta como cuando un parámetro está mal;
#                 si vale "hdfs", termina con código 1 antes de "Cluster LISTO"
#   FALSO_TRAZA   archivo donde anota las variables que recibió y el apagado
log()   { echo -e "\n\033[1;36m[sandbox]\033[0m $*"; }
error() { echo -e "\n\033[1;31m[sandbox] ERROR:\033[0m $*" >&2; exit 1; }
p="${FALSO_PAUSA:-0.05}"
[ -n "$FALSO_TRAZA" ] && echo "DATANODES=$DATANODES REPLICATION=$REPLICATION BLOCK_SIZE=$BLOCK_SIZE NAMENODES=$NAMENODES SERVICIOS=$SERVICIOS MONGODB=$MONGODB JUPYTER=$JUPYTER PIG_HEAPSIZE=$PIG_HEAPSIZE" > "$FALSO_TRAZA"
[ "$FALSO_FALLA" = parametros ] && error "DATANODES=$DATANODES: tiene que ser un numero de 1 a 9"
if [ "${NAMENODES:-1}" -gt 1 ]; then
  log "HDFS en alta disponibilidad: ZooKeeper + 3 JournalNodes + $NAMENODES NameNodes..."; sleep "$p"
fi
if [ ! -f "${FALSO_VOLUMEN:-/nada}/formateado" ]; then
  log "Primer arranque: formateando NameNode..."; echo "2026-10-22 14:00:01,123 INFO namenode.FSImage: Allocated new BlockPoolId"; sleep "$p"
  [ -n "$FALSO_VOLUMEN" ] && mkdir -p "$FALSO_VOLUMEN/dfs/name/current" && touch "$FALSO_VOLUMEN/formateado"
fi
log "Arrancando NameNode + Secondary NameNode..."; sleep "$p"
log "Arrancando ${DATANODES:-1} DataNode(s)..."; sleep "$p"
[ "$FALSO_FALLA" = hdfs ] && { echo "2026-10-22 14:00:05,001 ERROR datanode.DataNode: Exception in secureMain"; exit 1; }
log "Esperando a que HDFS salga de safe mode (en reinicios tarda unos segundos)..."; sleep "$p"
log "Preparando directorios en HDFS..."; sleep "$p"
if [ "$SERVICIOS" != hdfs ]; then
  log "Arrancando YARN (ResourceManager + NodeManager) y MapReduce JobHistory..."; sleep "$p"
  log "Arrancando MySQL (base de ejemplo para Sqoop)..."; sleep "$p"
fi
if [ "$SERVICIOS" = todo ]; then
  log "Subiendo librerias de Tez a HDFS..."; sleep "$p"
  log "Arrancando Hive Metastore + HiveServer2 + Spark History Server..."; sleep "$p"
  log "Esperando a que HiveServer2 acepte conexiones (puede tardar ~1 min)..."; sleep "$p"
fi
if [ "$JUPYTER" = si ]; then
  log "Arrancando JupyterLab..."; sleep "$p"
fi
echo
echo "  ============================================================"
echo "   Cluster LISTO"
echo "  ============================================================"
apagar() {
  trap - TERM INT
  log "Apagando el cluster..."
  [ -n "$FALSO_TRAZA" ] && echo apagado-en-orden >> "$FALSO_TRAZA"
  exit 0
}
trap apagar TERM INT
while true; do echo "2026-10-22 14:01:00,000 INFO datanode.DataNode: latido"; sleep 0.2; done &
wait $!
