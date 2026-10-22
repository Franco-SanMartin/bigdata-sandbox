#!/usr/bin/env bash
# Simula el laboratorio en una sola maquina (CI): el profe publica 51820/udp,
# 51821/udp y 8099 en el host, y cada "PC de alumno" esta en SU red de Docker
# (no se ven entre ellas): solo llegan al profe por la IP del host, como las PCs
# del aula llegan a la del profe por la LAN.
#
# Uso: escenario.sh CASO   (con la imagen ya cargada)
#   tun      alumnos con /dev/net/tun; WireGuard del kernel     -> veredicto A
#   go       alumnos con /dev/net/tun; sin modulo (simulado)    -> A con wireguard-go
#   sin-tun  alumnos sin /dev/net/tun ni modulo; puertos publicados -> B
#   aislado  sin /dev/net/tun ni modulo y sin puertos publicados    -> simulado
set -euo pipefail

caso=${1:?caso: tun, go, sin-tun o aislado}
IMAGEN=${IMAGEN:-bigdata-sandbox-sonda:v1}
PCS=${PCS:-3}
base=${RUNNER_TEMP:-/tmp}/sonda-$caso
rm -rf "$base"; mkdir -p "$base/datos"
resumen_ci=${GITHUB_STEP_SUMMARY:-/dev/null}

case $caso in
    tun)     tun=si; kernel=si; publicar=si; esperado='A ';         modo_esperado=kernel ;;
    go)      tun=si; kernel=no; publicar=si; esperado='A ';         modo_esperado=go ;;
    sin-tun) tun=no; kernel=no; publicar=si; esperado='B ';         modo_esperado=- ;;
    aislado) tun=no; kernel=no; publicar=no; esperado='SIMULADO ';  modo_esperado=- ;;
    *) echo "caso desconocido: $caso" >&2; exit 2 ;;
esac

# La IP del host vista desde los contenedores (la "LAN")
HOST=$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}')
echo "Caso $caso: $PCS PCs, host $HOST"

limpiar() {
    docker rm -f profe > /dev/null 2>&1 || true
    for i in $(seq 1 "$PCS"); do
        docker rm -f "pc0$i" > /dev/null 2>&1 || true
        docker network rm "red-pc0$i" > /dev/null 2>&1 || true
    done
}
logs() {
    echo "::group::logs del profe"; docker logs profe 2>&1 | tail -n 100 || true; echo "::endgroup::"
    for i in $(seq 1 "$PCS"); do
        echo "::group::logs de pc0$i"; docker logs "pc0$i" 2>&1 | tail -n 80 || true; echo "::endgroup::"
    done
}
fallar() { echo "FALLA: $*" >&2; logs; exit 1; }
trap limpiar EXIT
limpiar

# 1. El profe (con /dev/net/tun, como en el diseno)
docker run -d --name profe --cap-add NET_ADMIN --device /dev/net/tun \
    --sysctl net.ipv4.ip_forward=1 \
    -p 51820:51820/udp -p 51821:51821/udp -p 8099:8099 \
    -v "$base/datos:/datos" -e ROL=profe -e PC_NOMBRE=PROFE -e IP_PC="$HOST" \
    -e IMAGEN_ANTES=no -e ESPERADOS="$PCS" "$IMAGEN" > /dev/null
for _ in $(seq 1 30); do
    docker logs profe 2>&1 | grep -q '^Profe listo' && break
    sleep 1
done
docker logs profe 2>&1 | grep -q '^Profe listo' || fallar "el profe no arranco"
docker logs profe

# 2. Las PCs de alumnos, cada una en su red
for i in $(seq 1 "$PCS"); do
    pc=pc0$i
    puerto=$((8100 + i))
    mkdir -p "$base/$pc"
    printf '%s\n' "nombre=$pc" "ip_pc=$HOST" "perfil_red=Ethernet: Private (simulada)" \
        "windows=Windows 11 Education 23H2 (simulada en CI)" "docker_desktop=CI" \
        "ram_gb=16" "cpu=CPU del runner" "nucleos=4" "gpu=ninguna (CI)" \
        "imagen_cargada_antes=no" "tun_docker=$tun" > "$base/$pc/pc.txt"
    docker network create "red-$pc" > /dev/null
    extra=()
    [ "$tun" = si ] && extra+=(--device /dev/net/tun)
    [ "$kernel" = no ] && extra+=(-e SIMULAR_SIN_KERNEL=1)
    [ "$publicar" = si ] && extra+=(-p "$puerto:$puerto")
    docker run -d --name "$pc" --network "red-$pc" --cap-add NET_ADMIN "${extra[@]}" \
        -v "$base/$pc:/salida" -e ROL=alumno -e MAESTRO="$HOST" -e PUERTO_PRUEBA="$puerto" \
        -e ESPERA_FINAL=60 "$IMAGEN" > /dev/null
done

# 3. Que las PCs no se vean entre ellas directamente (como PCs aisladas)
if docker exec pc01 ping -c 1 -W 2 "$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' pc02)" > /dev/null 2>&1; then
    fallar "pc01 llega directo a pc02: las redes no estan aisladas"
fi

# 4. Esperar los resultados de todas (hasta 8 minutos)
for _ in $(seq 1 160); do
    listos=$(find "$base/datos/resultados" -name '*.txt' 2> /dev/null | wc -l)
    [ "$listos" -ge "$PCS" ] && break
    sleep 3
done
[ "$listos" -ge "$PCS" ] || fallar "llegaron $listos de $PCS resultados"
# ...y las pruebas de TCP entrante del profe (3 intentos cada una)
for _ in $(seq 1 30); do
    pend=0
    for i in $(seq 1 "$PCS"); do
        grep -qE '^tcp_entrante=(si|no)' "$base/datos/tcp/pc0$i" 2> /dev/null || pend=1
    done
    [ $pend = 0 ] && break
    sleep 2
done

# 5. Dia siguiente (lo que manda el .cmd con "dia2") y el resumen por HTTP
if [ "$caso" = tun ]; then
    curl -sf --data-binary $'nombre=pc01\nimagen_cargada_antes=no\ncarpeta_resultados=si\n' \
        -H 'Content-Type: text/plain' http://localhost:8099/cgi-bin/dia2 | grep -qx ok || fallar "dia2 no contesto ok"
fi
curl -sf http://localhost:8099/cgi-bin/resumen > "$base/resumen-http.txt" || fallar "GET /cgi-bin/resumen"
sleep 1
docker exec profe /sonda/planilla.sh

echo "================ resumen.txt ================"
cat "$base/datos/resumen.txt"
echo "================ planilla.csv ==============="
cat "$base/datos/planilla.csv"
{
    echo "## Caso \`$caso\`"
    echo '```'
    cat "$base/datos/resumen.txt"
    echo '```'
    echo '<details><summary>planilla.csv</summary>'
    echo
    echo '```'
    cat "$base/datos/planilla.csv"
    echo '```'
    echo '</details>'
} >> "$resumen_ci"

# 6. Verificar
val() { sed -n "s/^$1=//p" "$2" | tail -n 1; }
grep -q "^VEREDICTO: $esperado" "$base/datos/resumen.txt" || fallar "se esperaba VEREDICTO: $esperado"
grep -q "^VEREDICTO: $esperado" "$base/resumen-http.txt" || fallar "el resumen por HTTP no coincide"
filas=$(tail -n +2 "$base/datos/planilla.csv" | grep -c '^pc0')
[ "$filas" -eq "$PCS" ] || fallar "la planilla tiene $filas filas de alumnos"
for i in $(seq 1 "$PCS"); do
    pc=pc0$i
    r=$base/datos/resultados/$pc.txt
    local_=$base/$pc/sonda-$pc.txt
    [ -f "$local_" ] || fallar "$pc: no dejo la copia local"
    [ "$(val enviado_al_profe "$local_")" = si ] || fallar "$pc: la copia local dice que no se envio"
    [ "$(val udp_profe "$r")" = si ] || fallar "$pc: UDP al profe"
    [ "$(val inscripcion "$r")" = si ] || fallar "$pc: inscripcion"
    [ "$(val windows "$r")" != "" ] || fallar "$pc: no se juntaron los datos de pc.txt"
    tcp=$(val tcp_entrante "$base/datos/tcp/$pc")
    if [ "$modo_esperado" != - ]; then
        [ "$(val tunel "$r")" = si ] || fallar "$pc: el tunel no levanto"
        [ "$(val tunel_modo "$r")" = "$modo_esperado" ] || fallar "$pc: tunel con $(val tunel_modo "$r"), se esperaba $modo_esperado"
        [ "$(val iperf_profe_mbps "$r")" -gt 0 ] 2> /dev/null || fallar "$pc: sin iperf alumno->profe"
        [ "$(val iperf_par_mbps "$r")" -gt 0 ] 2> /dev/null || fallar "$pc: sin iperf alumno->alumno"
    else
        [ "$(val tunel "$r")" = no ] || fallar "$pc: el tunel no deberia levantar"
        [ "$(val tunel_motivo "$r")" = "sin modulo WireGuard y sin /dev/net/tun" ] \
            || fallar "$pc: motivo '$(val tunel_motivo "$r")'"
    fi
    if [ "$publicar" = si ]; then
        [ "$tcp" = si ] || fallar "$pc: el profe no entro a su puerto ($tcp)"
    else
        case $tcp in no*) ;; *) fallar "$pc: tcp_entrante '$tcp', se esperaba no" ;; esac
    fi
done
if [ "$caso" = tun ]; then
    grep -q 'La imagen seguía cargada en 0 de 1' "$base/datos/resumen.txt" || fallar "falta el dia siguiente en el resumen"
fi
echo "OK: caso $caso -> $(grep '^VEREDICTO' "$base/datos/resumen.txt")"
