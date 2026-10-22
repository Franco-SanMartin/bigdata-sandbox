# Para las paginas CGI del profe (las sirve busybox httpd en el puerto 8099).
# shellcheck shell=sh
# shellcheck source=comun.sh
. /sonda/comun.sh
printf 'Content-Type: text/plain; charset=utf-8\r\n\r\n'

# El cuerpo del POST (con tope, por las dudas)
cuerpo() { head -c "${CONTENT_LENGTH:-0}" | head -c "${1:-65536}" | tr -d '\r'; }
evento() { echo "$(date '+%H:%M:%S') $*" >> "$DATOS/eventos.log"; }
