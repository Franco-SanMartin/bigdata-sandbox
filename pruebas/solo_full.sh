#!/usr/bin/env bash
# Entre dos commits, ¿cambió solo lo de full? Imprime "si" o "no".
#
# Lo usa imagen.yml en un push a main: si es "si", no rearma ni publica base,
# latest ni ml (full.yml publica :full por su cuenta). Así un cambio de la
# interfaz no vuelve a etiquetar latest, que es la imagen de la clase.
#
# Cuenta como "solo full": la interfaz (ui/), el servidor de la interfaz
# (server/), los ejemplos que solo copia full (datos/comparar/), la
# documentación y, en el Dockerfile, las líneas de las etapas que van desde
# "FROM ... AS interfaz" hasta la última "FROM base" (interfaz, full, empresa
# y trabajador: ninguna entra en base ni en ml). Ante la duda, "no".
#
# Uso: pruebas/solo_full.sh <commit-antes> <commit-despues>
set -euo pipefail

desde=${1:?falta el commit de antes}
hasta=${2:?falta el commit de despues}

no() { echo no; [ -n "${1:-}" ] && echo "  $1" >&2; exit 0; }

# Push forzado, rama nueva (antes = 000…) o un commit que no está: se arma todo
git cat-file -e "$desde^{commit}" 2>/dev/null || no "no existe $desde"
git cat-file -e "$hasta^{commit}" 2>/dev/null || no "no existe $hasta"

cambios=$(git diff --name-only "$desde" "$hasta")
[ -n "$cambios" ] || no "no cambió nada"

while IFS= read -r f; do
  case "$f" in
    ui/* | server/* | datos/comparar/* | docs/* | guias/* | capturas/* | *.md) ;;
    .github/workflows/full.yml | .github/workflows/server.yml | .github/workflows/docs.yml) ;;
    # Cambiar este workflow no cambia las imágenes. Si hace falta rearmar base y ml a propósito,
    # se corre imagen.yml a mano (workflow_dispatch): ahí no se mira esto
    .github/workflows/imagen.yml) ;;
    pruebas/enlaces.py | pruebas/tutoriales.py | pruebas/solo_full.sh) ;;
    Dockerfile | .dockerignore) ;;   # se miran abajo
    *) no "$f es de base o ml" ;;
  esac
done <<< "$cambios"

if grep -qx .dockerignore <<< "$cambios"; then
  # Solo vale sumar la excepción de datos/comparar (y comentarios): ninguna etapa de base ni de ml
  # copia esa carpeta, copian rutas puntuales (datos/ejemplos, conf, sandbox…)
  otras=$(git diff -U0 "$desde" "$hasta" -- .dockerignore | grep -E '^[+-]' | grep -vE '^(\+\+\+|---) ' \
            | grep -vE '^\+(!datos/comparar/?|#.*)$' || true)
  [ -z "$otras" ] || no ".dockerignore cambia algo más que la excepción de datos/comparar"
fi

if grep -qx Dockerfile <<< "$cambios"; then
  # Las líneas de las etapas de full en cada versión del Dockerfile: [inicio, fin)
  etapas() {
    git show "$1:Dockerfile" | awk '/^FROM .* AS interfaz$/ { i = NR } /^FROM base$/ { f = NR } END { print i + 0, f + 0 }'
  }
  read -r i0 f0 < <(etapas "$desde")
  read -r i1 f1 < <(etapas "$hasta")
  [ "$i0" -gt 0 ] && [ "$f0" -gt "$i0" ] && [ "$i1" -gt 0 ] && [ "$f1" -gt "$i1" ] || no "no encuentro las etapas de full"
  # Cada tramo cambiado (@@ -a,b +c,d @@) tiene que caer adentro, en las dos versiones.
  # Con b = 0 (o d = 0) el tramo no tiene líneas: se inserta (o se borra) después de la línea a (o c)
  adentro() { # linea cantidad inicio fin
    local a=$1 n=$2 i=$3 f=$4
    if [ "$n" -eq 0 ]; then [ "$a" -ge "$i" ] && [ "$a" -lt "$f" ]; else [ "$a" -ge "$i" ] && [ $((a + n - 1)) -lt "$f" ]; fi
  }
  while read -r a b c d; do
    adentro "$a" "${b:-1}" "$i0" "$f0" || no "el Dockerfile cambia la línea $a, fuera de las etapas de full"
    adentro "$c" "${d:-1}" "$i1" "$f1" || no "el Dockerfile cambia la línea $c, fuera de las etapas de full"
  done < <(git diff -U0 "$desde" "$hasta" -- Dockerfile | sed -nE 's/^@@ -([0-9]+)(,([0-9]+))? \+([0-9]+)(,([0-9]+))? @@.*/\1 \3 \4 \6/p')
fi

echo si
