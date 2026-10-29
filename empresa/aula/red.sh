#!/usr/bin/env bash
# Red del aula con RED=wireguard (version empresa): un tunel WireGuard con el
# hub en el maestro (la PC del profe), el mismo que midio la sonda (sonda/) el
# 27/10. Lo corre arranque-empresa.sh antes de prender cualquier otra cosa:
#
#   red.sh hub      en el maestro: crea wg0 (10.13.0.1, UDP 51820), vuelve a
#                   sumar las PCs que ya estaban inscriptas y levanta la
#                   inscripcion (TCP 8099, inscripcion.py)
#   red.sh reservar antes de crear el contenedor de una PC: pide su numero
#                   (con el nombre de la PC y el codigo de la clase) e imprime
#                   NODO=pcNN. El contenedor se crea con --hostname pcNN: Tez
#                   se anuncia con el nombre de la maquina, que asi se resuelve
#                   en todo el cluster (lo hace empresa-alumno.cmd)
#   red.sh unirse   en cada PC: se inscribe con su clave (una conexion SALIENTE
#                   a la PC del profe), recibe su IP del tunel (10.13.0.x) y
#                   levanta el tunel. No publica ningun puerto: no aparece el
#                   cartel del firewall
#
# En los dos, /etc/hosts con los nombres del aula (maestro = 10.13.0.1 y
# pcNN = 10.13.0.(10+NN)): cada nodo resuelve a todos los demas sin DNS, y
# HDFS y YARN se anuncian con nombres que van por el tunel.
# Todo queda en /hadoop/aula (el volumen): un docker restart sigue con el
# mismo tunel, el mismo codigo y las mismas IPs.
. /opt/sandbox/lib.sh
set -euo pipefail

VERSION_AULA=1   # la de la inscripcion: maestro y PCs tienen que coincidir

log()   { echo -e "\n\033[1;36m[aula]\033[0m $*" >&2; }
error() { echo -e "\n\033[1;31m[aula] ERROR:\033[0m $*" >&2; exit 1; }

# valor CLAVE [ARCHIVO]: el valor de "CLAVE=..." (sin archivo, de stdin)
valor() { sed -n "s/^$1=//p" "${2:-/dev/stdin}" 2>/dev/null | tr -d '\r' | tail -n 1; }

# Nombres de PC: letras, numeros, punto, guion y guion bajo (como en la sonda)
limpiar() { printf '%s' "$1" | tr -cd 'A-Za-z0-9_.-' | cut -c1-40; }

mkdir -p "$AULA_DIR"
# Docker Desktop con proxy lo pasa a los contenedores: en el aula todo es la red local
unset http_proxy HTTP_PROXY https_proxy HTTPS_PROXY all_proxy ALL_PROXY
# Para que wireguard-go no se niegue a arrancar si el kernel tambien trae WireGuard
export WG_I_PREFER_BUGGY_USERSPACE_TO_POLISHED_KMOD=1

# Crea wg0 con el modulo WireGuard del kernel (lo trae Docker Desktop: anduvo
# en 11 de 11 PCs) o, si no esta, con wireguard-go (necesita /dev/net/tun).
# SIMULAR_SIN_KERNEL=1 hace de cuenta que no hay modulo (para probar el respaldo).
crear_wg() {
  local err="" _
  ip link del wg0 2>/dev/null || true
  pkill -f '^wireguard-go wg0' 2>/dev/null || true
  rm -f /var/run/wireguard/wg0.sock
  if [ "${SIMULAR_SIN_KERNEL:-0}" != 1 ] && err=$(ip link add wg0 type wireguard 2>&1); then
    WG_MODO=kernel
  elif [ -c /dev/net/tun ] && command -v wireguard-go > /dev/null; then
    wireguard-go wg0 > /var/log/wireguard-go.log 2>&1 \
      || error "wireguard-go no arranco: $(tr '\n' ' ' < /var/log/wireguard-go.log)"
    for _ in $(seq 1 20); do wg show wg0 > /dev/null 2>&1 && break; sleep 0.3; done
    wg show wg0 > /dev/null 2>&1 || error "wireguard-go no creo la interfaz wg0"
    WG_MODO=go
  elif [[ "$err" == *"not permitted"* ]]; then
    error "no se puede crear el tunel: al contenedor le falta --cap-add NET_ADMIN"
  else
    error "no se puede crear el tunel: no esta el modulo WireGuard del kernel ni /dev/net/tun" \
          "para wireguard-go (docker run --device /dev/net/tun)"
  fi
  ip link set wg0 mtu "$WG_MTU"
  echo "$WG_MODO" > "$AULA_DIR/modo"
}

# Los nombres del aula en /etc/hosts (Docker lo vuelve a escribir en cada
# arranque del contenedor: por eso se rehace siempre). Se saca la linea que
# pone Docker para "maestro" (la IP de la red de Docker), que no sirve a las PCs.
hosts_aula() {
  local t n
  t=$(mktemp)
  {
    grep -vE '[[:space:]](maestro|pc[0-9]+)([[:space:]]|$)|# aula$' /etc/hosts || true
    echo "$HUB_IP maestro  # aula"
    for n in $(seq 1 240); do printf '%s.%d pc%02d  # aula\n' "$RED_TUNEL" $((10 + n)) "$n"; done
  } > "$t"
  cat "$t" > /etc/hosts   # cat y no mv: /etc/hosts lo monta Docker
  rm -f "$t"
}

clave() { # la clave privada de este nodo (queda en el volumen)
  [ -s "$AULA_DIR/clave" ] || (umask 077; wg genkey > "$AULA_DIR/clave")
}

cpu_modelo() {
  local m=${PC_CPU:-}
  [ -n "$m" ] || m=$(awk -F': *' '/^model name/ { print $2; exit }' /proc/cpuinfo)
  [ -n "$m" ] || m=$(uname -m)
  printf '%s' "$m" | tr -d '\r\n=' | cut -c1-80
}

# ------------------------------------------------------------------ maestro
hub() {
  clave
  wg pubkey < "$AULA_DIR/clave" > "$AULA_DIR/pub"
  # El codigo de la clase: el que se pida con CODIGO, o uno nuevo de 4
  # letras la primera vez (sin 0/O ni 1/I/L, que se confunden en el pizarron)
  if [ -n "${CODIGO:-}" ]; then
    limpiar "${CODIGO^^}" > "$AULA_DIR/codigo"
  elif [ ! -s "$AULA_DIR/codigo" ]; then
    python3 -c 'import secrets; print("".join(secrets.choice("ACDEFHJKMNPRTUVWXY34679") for _ in range(4)))' \
      > "$AULA_DIR/codigo"
  fi
  # Id de esta clase: si el maestro arranca de cero, las PCs borran lo viejo
  [ -s "$AULA_DIR/clase" ] || python3 -c 'import secrets; print(secrets.token_hex(6))' > "$AULA_DIR/clase"
  mkdir -p "$AULA_DIR/pcs"

  crear_wg
  wg set wg0 private-key "$AULA_DIR/clave" listen-port "$P_WG"
  ip addr add "$HUB_IP/24" dev wg0
  ip link set wg0 up
  # Las PCs que ya estaban inscriptas (docker restart del maestro)
  local f n=0
  for f in "$AULA_DIR"/pcs/*; do
    [ -f "$f" ] && [ -n "$(valor pub "$f")" ] || continue   # (las reservadas todavia no tienen clave)
    if wg set wg0 peer "$(valor pub "$f")" allowed-ips "$(valor ip "$f")/32"; then n=$((n + 1)); fi
  done
  # El hub reenvia entre PCs (pc03 -> maestro -> pc07): las copias de HDFS
  # entre PCs y el shuffle de los trabajos pasan por aca
  if [ "$(cat /proc/sys/net/ipv4/ip_forward)" != 1 ]; then
    echo 1 > /proc/sys/net/ipv4/ip_forward 2>/dev/null \
      || log "AVISO: sin reenvio de paquetes (falta --sysctl net.ipv4.ip_forward=1): las PCs" \
             "no se van a ver entre ellas, y las copias entre PCs y el shuffle no van a andar"
  fi
  hosts_aula

  # La inscripcion (TCP 8099): las PCs llegan por la red del aula
  pkill -f '/opt/sandbox/aula/inscripcion.py' 2>/dev/null || true
  export AULA_DIR P_INSCRIPCION RED_TUNEL WG_MTU REPLICATION BLOCK_SIZE SERVICIOS PCS_POR_FILA VERSION_AULA
  setsid python3 /opt/sandbox/aula/inscripcion.py >> /var/log/aula-inscripcion.log 2>&1 < /dev/null &
  local _
  for _ in $(seq 1 50); do escuchando "$P_INSCRIPCION" && break; sleep 0.2; done
  escuchando "$P_INSCRIPCION" || error "la inscripcion no levanto: $(tail -5 /var/log/aula-inscripcion.log)"

  local ip_aula=${IP_AULA:-IP_DEL_PROFE}
  echo
  echo "  ============================================================"
  echo "   Aula lista para sumar PCs"
  echo "     Codigo de la clase: $(cat "$AULA_DIR/codigo")"
  echo "     IP de la PC del profe: $ip_aula (UDP $P_WG y TCP $P_INSCRIPCION)"
  echo "     Tunel: $WG_MODO, MTU $WG_MTU, $n PC(s) ya inscriptas"
  echo "     En cada PC: empresa-alumno.cmd $ip_aula $(cat "$AULA_DIR/codigo")"
  echo "  ============================================================"
}

# ----------------------------------------------------------------- trabajador
# pedir RUTA CUERPO: POST a la inscripcion del profe; deja la respuesta en
# RESP. Reintenta hasta ESPERA_MAESTRO segundos (el profe puede estar
# arrancando todavia), salvo que el maestro diga que no.
pedir() {
  local err hasta=$(( SECONDS + ${ESPERA_MAESTRO:-600} )) aviso=$SECONDS
  while :; do
    RESP=$(curl -s --max-time 10 -H 'Content-Type: text/plain' --data-binary "$2" \
      "http://$HUB:$P_INSCRIPCION$1" 2>/dev/null || true)
    err=$(valor error <<<"$RESP")
    [ -n "$err" ] && error "el maestro no te sumo: $err"
    [ -n "$(valor ip <<<"$RESP")" ] && return 0
    [ "$SECONDS" -ge "$hasta" ] && error "la PC del profe no contesta en http://$HUB:$P_INSCRIPCION" \
      "despues de ${ESPERA_MAESTRO:-600} s. Revisar: que empresa-profe.cmd este andando, que la IP" \
      "sea la de la red del aula y que el firewall de la PC del profe deje entrar (el cartel de Docker)"
    if [ $(( SECONDS - aviso )) -ge 30 ]; then
      log "Todavia no contesta la PC del profe ($HUB:$P_INSCRIPCION): sigo probando..."
      aviso=$SECONDS
    fi
    sleep 3
  done
}

datos_pc() { # el nombre de la PC y el codigo, validados
  [ -n "${HUB:-}" ] || error "falta MAESTRO: la IP de la PC del profe en el aula (empresa-alumno.cmd IP CODIGO)"
  [ -n "${CODIGO:-}" ] || error "falta CODIGO: el codigo de la clase que muestra la PC del profe"
  codigo=$(limpiar "${CODIGO^^}")
  nombre=$(limpiar "${PC_NOMBRE:-$(hostname)}")
}

reservar() {
  local codigo nombre
  datos_pc
  log "Pidiendo el numero de $nombre en la PC del profe (http://$HUB:$P_INSCRIPCION, codigo $codigo)..."
  pedir /reservar "$(printf '%s\n' "nombre=$nombre" "codigo=$codigo" "version=$VERSION_AULA")"
  [[ "$(valor nodo <<<"$RESP")" =~ ^pc[0-9]+$ ]] || error "respuesta rara de la inscripcion: $(tr '\n' ' ' <<<"$RESP")"
  echo "NODO=$(valor nodo <<<"$RESP")"
  echo "IP_TUNEL=$(valor ip <<<"$RESP")"
}

unirse() {
  local codigo nombre pub ram cores cuerpo ip nodo hub_pub clase_vieja clase RESP
  datos_pc
  clave
  pub=$(wg pubkey < "$AULA_DIR/clave")
  ram=$(docker_ram_mb); cores=$(docker_cores)
  log "Esta PC: $nombre, Docker con $ram MB y $cores cores." \
      "Presta $TRABAJADOR_RAM MB y $TRABAJADOR_CORES cores para trabajos" \
      "$([ "$TRABAJADOR_RAM_AUTO" = si ] && echo "(automatico: dos tercios de la RAM de Docker)")"
  cuerpo=$(printf '%s\n' "nombre=$nombre" "pub=$pub" "codigo=$codigo" "ram_mb=$ram" "cores=$cores" \
    "yarn_mb=$TRABAJADOR_RAM" "vcores=$TRABAJADOR_CORES" "cpu=$(cpu_modelo)" "ram_pc_gb=${PC_RAM_GB:-}" \
    "clase=$(cat "$AULA_DIR/clase" 2>/dev/null || true)" "version=$VERSION_AULA")

  log "Inscribiendose en la PC del profe (http://$HUB:$P_INSCRIPCION, codigo $codigo)..."
  pedir /unirse "$cuerpo"
  ip=$(valor ip <<<"$RESP"); nodo=$(valor nodo <<<"$RESP"); hub_pub=$(valor hub_pub <<<"$RESP")
  clase=$(valor clase <<<"$RESP")
  [[ "$nodo" =~ ^pc[0-9]+$ ]] && [[ "$ip" =~ ^$RED_TUNEL\.[0-9]+$ ]] && [ ${#hub_pub} -eq 44 ] \
    || error "respuesta rara de la inscripcion: $(tr '\n' ' ' <<<"$RESP")"
  [ "$(valor version <<<"$RESP")" = "$VERSION_AULA" ] \
    || log "AVISO: el maestro tiene otra version de la imagen ($(valor version <<<"$RESP"), esta PC $VERSION_AULA)"
  # El nombre de la maquina tiene que ser el del nodo: Tez (y cualquier
  # programa que pregunte "como me llamo") se anuncia con ese nombre, y las
  # demas PCs y el maestro lo resuelven con /etc/hosts
  [ "$(hostname)" = "$nodo" ] || error "este contenedor se tiene que llamar $nodo (docker run --hostname $nodo):" \
    "empresa-alumno.cmd reserva el nombre antes de crearlo (red.sh reservar). Si el maestro es nuevo, volve a" \
    "correr empresa-alumno.cmd"

  # Un maestro nuevo (otra clase, o se borro su volumen): lo que esta PC
  # guardaba de HDFS es de otro cluster y el DataNode no arrancaria
  clase_vieja=$(cat "$AULA_DIR/clase" 2>/dev/null || true)
  if [ -n "$clase_vieja" ] && [ "$clase_vieja" != "$clase" ]; then
    log "El maestro es de otra clase: se borra lo que esta PC tenia de HDFS"
    rm -rf /hadoop/dfs /hadoop/tmp
  fi
  echo "$clase" > "$AULA_DIR/clase"
  {
    echo "NODO=$nodo"
    echo "IP_TUNEL=$ip"
    for k in REPLICATION BLOCK_SIZE SERVICIOS PCS_POR_FILA; do
      v=$(valor "${k,,}" <<<"$RESP")
      if [[ "$v" =~ ^[A-Za-z0-9]+$ ]]; then echo "$k=$v"; fi
    done
  } > "$AULA_DIR/nodo.env"

  crear_wg
  wg set wg0 private-key "$AULA_DIR/clave" peer "$hub_pub" endpoint "$HUB:$P_WG" \
    allowed-ips "$RED_TUNEL.0/24" persistent-keepalive 25
  ip addr add "$ip/24" dev wg0
  ip link set wg0 up
  hosts_aula

  # El tunel anda si se llega a la inscripcion por adentro (10.13.0.1)
  local _ ok=no
  for _ in $(seq 1 30); do
    if curl -s --max-time 2 "http://$HUB_IP:$P_INSCRIPCION/ping" 2>/dev/null | grep -q '^ok'; then ok=si; break; fi
    sleep 1
  done
  [ "$ok" = si ] || error "la inscripcion anduvo (TCP $P_INSCRIPCION) pero el tunel no levanta: el UDP" \
    "$P_WG no llega a la PC del profe (firewall de esa PC) o Docker no deja pasar UDP"
  mtu_ok

  log "Esta PC es $nodo en el cluster del aula: IP del tunel $ip (WireGuard $WG_MODO, MTU $(cat /sys/class/net/wg0/mtu))"
}

# Que los paquetes grandes pasen enteros por el tunel. Si el de WG_MTU no
# pasa (la red o Docker agregan algo en el camino), se baja a 1280 en esta PC:
# TCP acuerda el tamano con cada punta, asi que las demas no cambian.
mtu_ok() {
  command -v ping > /dev/null || return 0
  ping -c 2 -W 2 -M "do" -s $(( WG_MTU - 28 )) "$HUB_IP" > /dev/null 2>&1 && return 0
  if ping -c 2 -W 2 -M "do" -s 1252 "$HUB_IP" > /dev/null 2>&1; then
    log "AVISO: paquetes de $WG_MTU bytes no pasan enteros por el tunel: en esta PC va con MTU 1280"
    ip link set wg0 mtu 1280
  else
    log "AVISO: ni con MTU 1280 pasan paquetes grandes por el tunel: HDFS va a andar lento o trabarse"
  fi
}

case "${1:-}" in
  hub)      hub ;;
  reservar) reservar ;;
  unirse)   unirse ;;
  *) echo "Uso: red.sh hub|reservar|unirse (hub y unirse los corre arranque-empresa.sh con RED=wireguard)" >&2; exit 2 ;;
esac
