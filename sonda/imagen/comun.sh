# Cosas compartidas por la sonda (profe, alumno y las paginas CGI).
# shellcheck shell=sh disable=SC2034

VERSION_SONDA=1
RED_TUNEL=10.13.0          # la red del tunel: el profe es .1, los alumnos de .11 en adelante
HUB_IP=$RED_TUNEL.1
P_WG=51820                 # UDP: WireGuard (hub en el profe)
P_ECO=51821                # UDP: eco, para saber si el UDP llega aunque no haya tunel
P_HTTP=8099                # TCP: inscripcion y resultados
DATOS=/datos               # en el profe: planilla, resumen y lo que mandan los alumnos

# Docker Desktop con proxy lo pasa a los contenedores: en el aula todo es LAN, sin proxy
unset http_proxy HTTP_PROXY https_proxy HTTPS_PROXY

# Para que wireguard-go no se niegue a arrancar si el kernel tambien trae WireGuard
export WG_I_PREFER_BUGGY_USERSPACE_TO_POLISHED_KMOD=1

# valor CLAVE [ARCHIVO]: el valor de "CLAVE=..." (el ultimo, si se repite). Sin archivo, lee stdin.
valor() {
    if [ $# -ge 2 ]; then
        [ -r "$2" ] || return 0
        sed -n "s/^$1=//p" "$2" | tr -d '\r' | tail -n 1
    else
        sed -n "s/^$1=//p" | tr -d '\r' | tail -n 1
    fi
}

# Nombres de PC: solo letras, numeros, punto, guion y guion bajo (se usan como nombre de archivo)
limpiar() { printf '%s' "$1" | tr -cd 'A-Za-z0-9_.-' | cut -c1-40; }

ahora() { date '+%Y-%m-%d %H:%M:%S'; }

# Numero al azar entre 0 y $1-1 (todas las PCs arrancan en el mismo segundo: nada de srand)
azar() { echo $(( $(od -An -N2 -tu2 /dev/urandom | tr -d ' ') % $1 )); }

# Segundos desde que arranco la maquina (para medir esperas)
segundos() { cut -d. -f1 /proc/uptime; }

# ¿Hay WireGuard en el kernel de la VM de Docker? Crea y borra una interfaz de prueba.
# SIMULAR_SIN_KERNEL=1 hace de cuenta que no (para probar el respaldo wireguard-go en CI).
wg_kernel_anda() {
    [ "${SIMULAR_SIN_KERNEL:-0}" = 1 ] && return 1
    ip link add sondak type wireguard 2>/dev/null || return 1
    ip link del sondak 2>/dev/null
    return 0
}

# ¿Anda wireguard-go (WireGuard en espacio de usuario)? Necesita /dev/net/tun.
# Devuelve 0 si anda, 1 si no, 2 si no hay /dev/net/tun.
wg_go_anda() {
    [ -c /dev/net/tun ] || return 2
    wireguard-go sondag > /tmp/wg-go-prueba.log 2>&1 || return 1
    i=0
    while [ $i -lt 10 ]; do
        if wg show sondag > /dev/null 2>&1; then
            ip link del sondag 2>/dev/null
            rm -f /var/run/wireguard/sondag.sock
            return 0
        fi
        sleep 0.3; i=$((i + 1))
    done
    ip link del sondag 2>/dev/null
    return 1
}

# Crea la interfaz $1 con el modo $2 (kernel o go)
crear_wg() {
    if [ "$2" = kernel ]; then
        ip link add "$1" type wireguard
    else
        wireguard-go "$1" > "/tmp/wg-go-$1.log" 2>&1 || return 1
        i=0
        while [ $i -lt 10 ]; do
            wg show "$1" > /dev/null 2>&1 && return 0
            sleep 0.3; i=$((i + 1))
        done
        return 1
    fi
}

# Ancho de banda con iperf3 contra $1 (Mbit/s, lo que recibio el otro lado).
# Si el servidor esta ocupado con otra PC, reintenta hasta $2 segundos.
medir_iperf() {
    hasta=$(( $(segundos) + $2 ))
    while [ "$(segundos)" -lt "$hasta" ]; do
        salida=$(iperf3 -c "$1" -t "${IPERF_SEGUNDOS:-4}" -f m 2>&1)
        mbps=$(printf '%s\n' "$salida" | awk '/receiver/ { for (i = 1; i <= NF; i++) if ($i == "Mbits/sec") print int($(i-1) + 0.5) }' | tail -n 1)
        if [ -n "$mbps" ]; then echo "$mbps"; return 0; fi
        sleep $(( 2 + $(azar 5) ))
    done
    return 1
}
