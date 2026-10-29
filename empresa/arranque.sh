#!/usr/bin/env bash
# Arranque de la version empresa (y de la imagen trabajador). Segun ROL:
#   solo (o sin ROL)  igual que la version full: la interfaz en :8080
#   maestro           la PC del profe: la interfaz en :8080, que prende sola
#                     el cluster del aula (AUTOSTART) y tiene la vista Aula.
#                     Con INTERFAZ=no, el arranque directo sin interfaz
#   trabajador        una PC del aula: su DataNode y su NodeManager, directo
#                     con /opt/entrypoint.sh
# Con RED=wireguard, antes de todo se arma la red del aula (aula/red.sh): el
# hub y la inscripcion en el maestro, el tunel en cada PC.
set -e
ROL=$(echo "${ROL:-solo}" | tr '[:upper:]' '[:lower:]')
RED=$(echo "${RED:-docker}" | tr '[:upper:]' '[:lower:]')
INTERFAZ=$(echo "${INTERFAZ:-si}" | tr '[:upper:]' '[:lower:]' | sed 's/í/i/')
hay_interfaz() { [ -d /opt/sandbox/server/sandbox_server ]; }

if [ "$RED" = wireguard ]; then
  case "$ROL" in
    maestro)    /opt/sandbox/aula/red.sh hub ;;
    trabajador) /opt/sandbox/aula/red.sh unirse ;;
  esac
fi

case "$ROL" in
  solo)
    hay_interfaz || { echo "Esta imagen es solo para las PCs del aula (ROL=trabajador)" >&2; exit 2; }
    exec python3 -m sandbox_server ;;
  maestro)
    if [ "$INTERFAZ" = si ] && hay_interfaz; then
      # ECO_ARRANQUE: la salida del arranque sale tambien en docker logs
      export AUTOSTART=1 ECO_ARRANQUE=1
      exec python3 -m sandbox_server
    fi
    exec /opt/entrypoint.sh "$@" ;;
  *)
    exec /opt/entrypoint.sh "$@" ;;
esac
