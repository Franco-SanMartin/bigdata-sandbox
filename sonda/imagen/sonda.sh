#!/bin/sh
# Sonda del laboratorio: mide si las PCs del aula pueden armar un cluster entre
# ellas (tunel WireGuard con hub en el profe, red directa o nada). Ver LEEME.md.
case "${ROL:-}" in
    profe)  exec /sonda/profe.sh ;;
    alumno) exec /sonda/alumno.sh ;;
    *)
        echo "Uso: docker run ... -e ROL=profe  (en la PC del profe)"
        echo "     docker run ... -e ROL=alumno -e MAESTRO=IP_DEL_PROFE  (en cada PC)"
        echo "Lo arman sonda-profe.cmd y sonda-alumno.cmd: ver LEEME.md."
        exit 2 ;;
esac
