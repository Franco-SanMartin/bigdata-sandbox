#!/usr/bin/env bash
# Arranque de la version empresa. Segun ROL:
#   solo (o sin ROL)      igual que la version full: la interfaz en :8080
#   maestro / trabajador  un nodo del cluster del aula: prende sus daemons
#                         directo con /opt/entrypoint.sh, sin interfaz
ROL=$(echo "${ROL:-solo}" | tr '[:upper:]' '[:lower:]')
case "$ROL" in
  solo) exec python3 -m sandbox_server ;;
  *)    exec /opt/entrypoint.sh "$@" ;;
esac
