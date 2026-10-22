#!/bin/sh
# Sonda, rol profe: hub WireGuard (UDP 51820), eco UDP (51821), inscripcion y
# recepcion de resultados (TCP 8099). Prueba si llega a los puertos publicados
# de cada alumno y arma la planilla (planilla.csv) y el resumen con el veredicto
# (resumen.txt) en /datos, que es la carpeta sonda-profe del usuario en Windows.
#
# Variables: PC_NOMBRE, IP_PC, IMAGEN_ANTES (las pone el .cmd), ESPERADOS
# (cuantas PCs de alumnos se esperan, para el resumen), UMBRAL (porcentaje de
# PCs que tienen que andar para elegir una opcion, 80).
# shellcheck source=comun.sh
. /sonda/comun.sh
set -u

mkdir -p "$DATOS/inscriptos" "$DATOS/resultados" "$DATOS/tcp" "$DATOS/dia2"
EVENTOS=$DATOS/eventos.log
touch "$EVENTOS"
evento() { echo "$(date '+%H:%M:%S') $*" >> "$EVENTOS"; }

trap 'echo; echo "Sonda del profe cortada. Planilla y resumen en la carpeta sonda-profe."; exit 0' INT TERM

{
    echo "nombre=$(limpiar "${PC_NOMBRE:-$(hostname)}")"
    echo "ip_pc=${IP_PC:-}"
    echo "imagen_cargada_antes=${IMAGEN_ANTES:-}"
    echo "fecha=$(ahora)"
    echo "version_sonda=$VERSION_SONDA"
    echo "esperados=${ESPERADOS:-}"
    echo "umbral=${UMBRAL:-80}"
} > "$DATOS/profe.txt"

# 1. Hub WireGuard: modulo del kernel y, si no, wireguard-go
modo=no
if wg_kernel_anda; then modo=kernel
elif wg_go_anda; then modo=go
fi
if [ "$modo" != no ] && crear_wg wg0 "$modo"; then
    (umask 077; wg genkey > /tmp/clave)
    wg pubkey < /tmp/clave > /tmp/hub_pub
    wg set wg0 private-key /tmp/clave listen-port "$P_WG"
    ip addr add "$HUB_IP/24" dev wg0
    ip link set wg0 up
    # El hub reenvia entre alumnos (pc07 -> profe -> pc08)
    { echo 1 > /proc/sys/net/ipv4/ip_forward; } 2>/dev/null
    reenvio=$(cat /proc/sys/net/ipv4/ip_forward)
    (while :; do iperf3 -s -B "$HUB_IP" > /dev/null 2>&1; sleep 1; done) &
else
    modo=no
    reenvio=0
    rm -f /tmp/hub_pub
fi
echo "$modo" > /tmp/hub_modo
{ echo "hub=$modo"; echo "hub_reenvio=$reenvio"; } >> "$DATOS/profe.txt"

# 2. Eco UDP y servidor HTTP
# shellcheck disable=SC2016  # el $l lo expande el sh que lanza socat
socat -T2 UDP4-RECVFROM:"$P_ECO",reuseaddr,fork SYSTEM:'read -r l; echo "$l"' 2>/dev/null &
busybox-extras httpd -f -p "$P_HTTP" -h /sonda/www &

/sonda/planilla.sh
echo "=========================================================="
echo " Sonda del laboratorio (version $VERSION_SONDA) - PC del profe"
echo "   IP de esta PC: ${IP_PC:-?}"
case $modo in
    kernel) echo "   Hub WireGuard: arriba (modulo del kernel), UDP $P_WG" ;;
    go)     echo "   Hub WireGuard: arriba (wireguard-go), UDP $P_WG" ;;
    *)      echo "   Hub WireGuard: NO (sin modulo ni /dev/net/tun): solo se mide lo demas" ;;
esac
[ "$modo" != no ] && [ "$reenvio" != 1 ] && echo "   OJO: sin reenvio de paquetes (ip_forward=0): alumno -> alumno no va a andar"
echo "   Inscripcion y resultados: TCP $P_HTTP"
echo " En las PCs de alumnos (Veyon > Ejecutar programa):"
echo "   sonda-alumno.cmd ${IP_PC:-IP_DEL_PROFE}"
echo " Planilla y resumen: carpeta sonda-profe (se actualizan solos)."
echo " Para terminar: Ctrl+C."
echo "=========================================================="
echo "Profe listo"

# 3. A cada inscripto: probar si se llega a su puerto publicado (3 intentos)
probar_tcp() {   # nombre ip puerto
    f=$DATOS/tcp/$1
    intentos=$(valor intentos "$f"); intentos=${intentos:-0}
    if [ "$2" = - ] || [ -z "$2" ]; then
        printf 'tcp_entrante=no (sin IP de la PC)\nintentos=9\n' > "$f"; return
    fi
    salida=$(socat -t3 -T3 - "TCP:$2:$3,connect-timeout=3" < /dev/null 2>&1)
    intentos=$((intentos + 1))
    if printf '%s' "$salida" | grep -q sonda-ok; then
        printf 'tcp_entrante=si\nintentos=%s\n' "$intentos" > "$f"
        evento "$1: el profe entra a su puerto $3: si"
        return
    fi
    case $salida in
        *refused*) porque="rechazada" ;;
        *imed*out*|*imeout*) porque="sin respuesta (firewall)" ;;
        *unreachable*) porque="inalcanzable" ;;
        *) porque="sin respuesta de la sonda" ;;
    esac
    if [ "$intentos" -ge 3 ]; then
        printf 'tcp_entrante=no (%s)\nintentos=%s\n' "$porque" "$intentos" > "$f"
        evento "$1: el profe entra a su puerto $3: no ($porque)"
    else
        printf 'tcp_entrante=pendiente\nintentos=%s\n' "$intentos" > "$f"
    fi
}

tail -n 0 -f "$EVENTOS" &
antes=
while :; do
    for f in "$DATOS"/inscriptos/*; do
        [ -f "$f" ] || continue
        read -r _ nombre _ ip_pc puerto _ < "$f"
        case $(valor tcp_entrante "$DATOS/tcp/$nombre") in
            si|no*) ;;
            *) probar_tcp "$nombre" "$ip_pc" "$puerto" ;;
        esac
    done
    ahora_hay=$(find "$DATOS"/inscriptos "$DATOS"/resultados "$DATOS"/tcp "$DATOS"/dia2 -type f -exec cat {} + 2>/dev/null | md5sum)
    if [ "$ahora_hay" != "$antes" ]; then
        /sonda/planilla.sh
        [ -n "$antes" ] && sed -n 's/^VEREDICTO/  -> VEREDICTO por ahora/p' "$DATOS/resumen.txt"
        antes=$ahora_hay
    fi
    sleep 3
done
