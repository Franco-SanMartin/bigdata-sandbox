#!/bin/sh
# Sonda, rol alumno: prueba todo lo que hace falta para el cluster del aula y le
# manda los resultados al profe. Deja una copia en /salida (la carpeta
# sonda-resultados del usuario, en Windows).
#
# Variables: MAESTRO (IP de la PC del profe, obligatoria), PC_NOMBRE, IP_PC,
# PUERTO_PRUEBA (TCP publicado para la prueba de entrada, 8098; 0 = sin la
# prueba B: no se publica nada, asi no aparece el cartel del firewall),
# ESPERA_FINAL (segundos que se queda atendiendo a los companeros al final, 120).
# shellcheck source=comun.sh
. /sonda/comun.sh
set -u

MAESTRO=${MAESTRO:-}
SALIDA=/salida
mkdir -p "$SALIDA"
PC_TXT=$SALIDA/pc.txt          # lo que junto el .cmd en Windows (hardware, Docker Desktop)
NOMBRE=$(limpiar "${PC_NOMBRE:-$(valor nombre "$PC_TXT")}")
[ -n "$NOMBRE" ] || NOMBRE=$(limpiar "$(hostname)")
IP_PC=${IP_PC:-$(valor ip_pc "$PC_TXT")}
PUERTO=${PUERTO_PRUEBA:-8098}
ESPERA_FINAL=${ESPERA_FINAL:-120}
RES=/tmp/resultado.txt
: > "$RES"

anotar() { printf '%s=%s\n' "$1" "$2" >> "$RES"; }
decir() { echo "[sonda $NOMBRE] $*"; }

http() {   # http RUTA [CUERPO]: GET o POST al profe
    if [ $# -ge 2 ]; then
        wget -q -T 8 -O - --header 'Content-Type: text/plain' --post-data "$2" \
            "http://$MAESTRO:$P_HTTP$1" 2>/dev/null
    else
        wget -q -T 8 -O - "http://$MAESTRO:$P_HTTP$1" 2>/dev/null
    fi
}

if [ -z "$MAESTRO" ]; then
    echo "Falta MAESTRO: la IP de la PC del profe (sonda-alumno.cmd IP_DEL_PROFE)" >&2
    exit 2
fi

decir "version $VERSION_SONDA, profe en $MAESTRO, esta PC en ${IP_PC:-?}"
anotar version_sonda "$VERSION_SONDA"
anotar fecha_prueba "$(ahora)"

# 1. Escuchar en el puerto publicado: el profe y los companeros intentan entrar
#    (sin la prueba B, PUERTO_PRUEBA=0, no se escucha ni se publica nada)
if [ "$PUERTO" != 0 ]; then
    socat TCP-LISTEN:"$PUERTO",fork,reuseaddr SYSTEM:"echo sonda-ok $NOMBRE" 2>/dev/null &
    anotar prueba_b si
else
    anotar prueba_b no
    decir "sin la prueba B: esta PC no publica ningun puerto"
fi

# 2. UDP al profe (independiente del tunel)
udp=no
for _ in 1 2 3; do
    if echo "eco $NOMBRE" | socat -t3 -T3 - "UDP:$MAESTRO:$P_ECO" 2>/dev/null | grep -q "eco $NOMBRE"; then
        udp=si; break
    fi
done
anotar udp_profe "$udp"
decir "UDP al profe: $udp"

# 3. WireGuard en esta PC: modulo del kernel y wireguard-go
if wg_kernel_anda; then kernel=si; else kernel=no; fi
[ "${SIMULAR_SIN_KERNEL:-0}" = 1 ] && kernel="no (simulado)"
wg_go_anda; r=$?
case $r in 0) wggo=si ;; 2) wggo="no (sin /dev/net/tun)" ;; *) wggo=no ;; esac
[ -c /dev/net/tun ] && tun=si || tun=no
anotar dev_net_tun "$tun"
anotar wg_kernel "$kernel"
anotar wg_go "$wggo"
decir "WireGuard: kernel $kernel, wireguard-go $wggo"

# 4. Inscripcion (reintenta un minuto por si el profe todavia no arranco)
(umask 077; wg genkey > /tmp/clave)
pub=$(wg pubkey < /tmp/clave)
resp=
hasta=$(( $(segundos) + ${ESPERA_PROFE:-60} ))
while [ "$(segundos)" -lt "$hasta" ]; do
    resp=$(http /cgi-bin/unirse "$(printf 'nombre=%s\nip_pc=%s\npuerto=%s\npub=%s\nversion=%s\n' \
        "$NOMBRE" "$IP_PC" "$PUERTO" "$pub" "$VERSION_SONDA")") && [ -n "$resp" ] && break
    resp=
    sleep 3
done
mi_ip=$(echo "$resp" | valor ip)
hub_pub=$(echo "$resp" | valor hub_pub)
if [ -z "$mi_ip" ]; then
    anotar inscripcion "no"
    anotar notas "no llego al profe por TCP $P_HTTP ($MAESTRO): firewall de la PC del profe o IP equivocada"
    decir "NO pude inscribirme en http://$MAESTRO:$P_HTTP (firewall de la PC del profe o IP equivocada)"
else
    anotar inscripcion si
    anotar ip_tunel "$mi_ip"
    decir "inscripcion ok: IP del tunel $mi_ip"
fi

# 5. Tunel hacia el profe
tunel=no; modo=-; motivo=
if [ -z "$mi_ip" ]; then
    motivo="sin inscripcion"
elif [ -z "$hub_pub" ]; then
    motivo="el profe no tiene tunel"
else
    if [ "$kernel" = si ]; then modo=kernel
    elif [ "$wggo" = si ]; then modo=go
    fi
    if [ "$modo" = - ]; then
        motivo="sin modulo WireGuard y sin /dev/net/tun"
        [ "$tun" = si ] && motivo="sin modulo WireGuard y wireguard-go no arranca"
    elif ! crear_wg wg0 "$modo"; then
        motivo="no se pudo crear la interfaz ($modo)"
    else
        wg set wg0 private-key /tmp/clave peer "$hub_pub" endpoint "$MAESTRO:$P_WG" \
            allowed-ips "$RED_TUNEL.0/24" persistent-keepalive 25
        ip addr add "$mi_ip/24" dev wg0
        ip link set wg0 up
        hasta=$(( $(segundos) + 25 ))
        while [ "$(segundos)" -lt "$hasta" ]; do
            if ping -c 1 -W 2 "$HUB_IP" > /dev/null 2>&1; then tunel=si; break; fi
            sleep 1
        done
        if [ "$tunel" = si ]; then
            ms=$(ping -c 5 -W 2 "$HUB_IP" 2>/dev/null | sed -n 's#.*= [0-9.]*/\([0-9.]*\)/.*#\1#p')
            anotar ping_profe_ms "$ms"
        elif [ "$udp" = no ]; then
            motivo="el UDP no llega al profe"
        else
            motivo="el UDP llega pero el tunel no levanta (handshake)"
        fi
    fi
fi
anotar tunel "$tunel"
anotar tunel_modo "$modo"
[ -n "$motivo" ] && anotar tunel_motivo "$motivo"
if [ "$tunel" = si ]; then decir "tunel: si ($modo)"; else decir "tunel: no ($motivo)"; fi

# 6. Ancho de banda por el tunel: alumno -> profe y alumno -> companero (pasa por el hub)
if [ "$tunel" = si ]; then
    iperf3 -s -B "$mi_ip" -D --logfile /tmp/iperf-servidor.log
    if mbps=$(medir_iperf "$HUB_IP" "${IPERF_ESPERA:-240}"); then
        anotar iperf_profe_mbps "$mbps"
        decir "alumno -> profe: $mbps Mbit/s"
    else
        anotar iperf_profe_mbps ""
        decir "alumno -> profe: no se pudo medir"
    fi
    # Companero: el que sigue en la lista de inscriptos (en ronda: a cada uno le mide uno solo)
    par=; par_ip=
    hasta=$(( $(segundos) + ${ESPERA_PAR:-60} ))
    while [ "$(segundos)" -lt "$hasta" ]; do
        lista=$(http /cgi-bin/lista)
        sig=$(printf '%s\n' "$lista" | awk -v yo="$NOMBRE" '
            NF >= 2 { n++; nom[n] = $1; ip[n] = $2; if ($1 == yo) me = n }
            END { if (me && n > 1) { s = me % n + 1; print nom[s], ip[s] } }')
        if [ -n "$sig" ]; then
            par=${sig% *}; par_ip=${sig#* }
            ping -c 1 -W 2 "$par_ip" > /dev/null 2>&1 && break
        fi
        par_ip=
        sleep 3
    done
    if [ -n "$par_ip" ]; then
        anotar iperf_par "$par"
        if mbps=$(medir_iperf "$par_ip" "${IPERF_ESPERA:-240}"); then
            anotar iperf_par_mbps "$mbps"
            decir "alumno -> $par (por el hub): $mbps Mbit/s"
        fi
    else
        anotar iperf_par "-"
        decir "no hay otro companero con tunel para medir alumno -> alumno"
    fi
fi

# 7. TCP directo a puertos publicados de dos companeros (lo que necesitaria la red directa)
companeros=
if [ -n "$mi_ip" ] && [ "$PUERTO" != 0 ]; then
    otros=$(http /cgi-bin/lista | awk -v yo="$NOMBRE" 'NF >= 4 && $1 != yo && $4 != 0 { print $1, $3, $4 }' | head -n 2)
    while read -r nom ip puerto; do
        if [ -z "$nom" ] || [ "$ip" = - ]; then continue; fi
        if socat -t3 -T3 - "TCP:$ip:$puerto,connect-timeout=3" < /dev/null 2>/dev/null | grep -q sonda-ok; then
            companeros="$companeros $nom:si"
        else
            companeros="$companeros $nom:no"
        fi
    done <<EOF
$otros
EOF
fi
anotar tcp_companeros "${companeros# }"
[ -n "$companeros" ] && decir "TCP directo a companeros:$companeros"

# 8. Guardar la copia local y mandarla al profe
archivo=$SALIDA/sonda-$NOMBRE.txt
{
    [ -r "$PC_TXT" ] && tr -d '\r' < "$PC_TXT"
    echo "nombre=$NOMBRE"
    echo "ip_pc=$IP_PC"
    echo "docker=si"
    cat "$RES"
} > "$archivo"
enviado=no
if [ -n "$mi_ip" ]; then
    for _ in 1 2 3 4 5; do
        if http /cgi-bin/resultado "$(cat "$archivo")" | grep -q '^ok'; then enviado=si; break; fi
        sleep 3
    done
fi
echo "enviado_al_profe=$enviado" >> "$archivo"
decir "copia local: sonda-resultados\\sonda-$NOMBRE.txt; enviado al profe: $enviado"

echo
echo "================ RESULTADO DE ESTA PC ================"
grep -E '^(udp_profe|inscripcion|wg_kernel|wg_go|tunel|tunel_modo|tunel_motivo|ping_profe_ms|iperf_profe_mbps|iperf_par|iperf_par_mbps|tcp_companeros|enviado_al_profe)=' "$archivo"
echo "======================================================"

# 9. Quedarse un rato atendiendo a los companeros (iperf y TCP) y despues irse
if [ "$ESPERA_FINAL" -gt 0 ]; then
    decir "me quedo $ESPERA_FINAL s atendiendo a los companeros; ya se puede cerrar la ventana"
    sleep "$ESPERA_FINAL"
fi
ip link del wg0 2>/dev/null
exit 0
