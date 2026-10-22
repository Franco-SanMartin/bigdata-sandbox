#!/bin/sh
# Arma planilla.csv (una fila por PC) y resumen.txt (con el veredicto A / B /
# simulado y por que) a partir de lo que mandaron los alumnos.
# Uso: planilla.sh [CARPETA]   (por defecto /datos)
# shellcheck source=comun.sh
. /sonda/comun.sh
D=${1:-$DATOS}
todo=$(mktemp)

nombres=$( { ls "$D/resultados" "$D/inscriptos" "$D/dia2"; } 2>/dev/null | grep -v ':$' | sed 's/\.txt$//' | sort -u)
for n in $nombres; do
    echo "@@ $n"
    [ -f "$D/inscriptos/$n" ] && echo "inscripto=si"
    if [ -f "$D/resultados/$n.txt" ]; then
        echo "con_resultado=si"
        tr -d '\r' < "$D/resultados/$n.txt"
    fi
    [ -f "$D/tcp/$n" ] && grep '^tcp_entrante=' "$D/tcp/$n"
    [ -f "$D/dia2/$n.txt" ] && tr -d '\r' < "$D/dia2/$n.txt" | sed 's/^/dia2_/'
done > "$todo"

awk -v profe="$D/profe.txt" -v csv="$D/.planilla.$$" -v resumen="$D/.resumen.$$" \
    -v fecha="$(ahora)" -f /sonda/planilla.awk "$todo"
mv "$D/.planilla.$$" "$D/planilla.csv"
mv "$D/.resumen.$$" "$D/resumen.txt"
rm -f "$todo"
