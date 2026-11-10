#!/usr/bin/env bash
# Entre dos commits, ¿qué imágenes cambiaron? Imprime una palabra:
#
#   si   solo cambió lo de full: no se rearman ni se publican base, latest ni ml
#   ml   cambió ml (y quizás full), pero no base: se publica solo :ml
#   no   cambió base (o no se sabe): se arma y se publica todo
#
# Lo usa imagen.yml en un push a main. Así un cambio de la interfaz o del estudio
# de ML no vuelve a etiquetar latest, que es la imagen de la clase (full.yml
# publica :full por su cuenta).
#
# Cuenta como "solo full": la interfaz (ui/), el servidor de la interfaz
# (server/), los ejemplos que solo copia full (datos/comparar/, con su
# excepción en .gitignore y .dockerignore), la documentación y, en el
# Dockerfile, las líneas de las etapas que van desde "FROM ... AS interfaz"
# hasta la última "FROM base" (interfaz, full, empresa y trabajador: ninguna
# entra en base ni en ml).
# Cuenta como "ml": el estudio de ML (ml/), las librerías y la configuración de
# JupyterLab (conf/requirements-ml.txt, conf/jupyter_server_config.py), su
# prueba (pruebas/probar_ml.sh) y, en el Dockerfile, las líneas de la etapa
# "FROM base AS ml". Ante la duda, "no".
#
# Uso: pruebas/solo_full.sh <commit-antes> <commit-despues>
set -euo pipefail

desde=${1:?falta el commit de antes}
hasta=${2:?falta el commit de despues}

no() { echo no; [ -n "${1:-}" ] && echo "  $1" >&2; exit 0; }
ml=0

# Push forzado, rama nueva (antes = 000…) o un commit que no está: se arma todo
git cat-file -e "$desde^{commit}" 2>/dev/null || no "no existe $desde"
git cat-file -e "$hasta^{commit}" 2>/dev/null || no "no existe $hasta"

cambios=$(git diff --name-only "$desde" "$hasta")
[ -n "$cambios" ] || no "no cambió nada"

while IFS= read -r f; do
  case "$f" in
    ui/* | server/* | datos/comparar/* | docs/* | capturas/* | *.md) ;;
    .github/workflows/full.yml | .github/workflows/server.yml | .github/workflows/docs.yml) ;;
    # Cambiar este workflow no cambia las imágenes. Si hace falta rearmar base y ml a propósito,
    # se corre imagen.yml a mano (workflow_dispatch): ahí no se mira esto
    .github/workflows/imagen.yml) ;;
    # Los workflows de empresa, la sonda, el aula, los releases y borrar tags no arman base ni ml
    # (empresa.yml arma base y ml solo para probar y nunca los sube)
    .github/workflows/empresa.yml | .github/workflows/sonda.yml | .github/workflows/aula.yml) ;;
    .github/workflows/escenarios.yml | .github/workflows/borrar-tag.yml | .github/workflows/release.yml) ;;
    sonda/* | pruebas/aula.sh) ;;
    pruebas/enlaces.py | pruebas/tutoriales.py | pruebas/solo_full.sh | pruebas/probar_solo_full.sh) ;;
    # El arranque y el aula de empresa: van a las etapas empresa y trabajador (después de interfaz) o al
    # release del aula (los .cmd). No cambian base, ml ni full
    empresa/*) ;;
    ml/* | conf/requirements-ml.txt | conf/jupyter_server_config.py | pruebas/probar_ml.sh) ml=1 ;;
    Dockerfile | .dockerignore | .gitignore) ;;   # se miran abajo
    *) no "$f es de base" ;;
  esac
done <<< "$cambios"

for ignore in .dockerignore .gitignore; do
  grep -qx "$ignore" <<< "$cambios" || continue
  # Solo vale sumar la excepción de datos/comparar (y comentarios): ninguna etapa de base ni de ml
  # copia esa carpeta, copian rutas puntuales (datos/ejemplos, conf, sandbox…)
  otras=$(git diff -U0 "$desde" "$hasta" -- "$ignore" | grep -E '^[+-]' | grep -vE '^(\+\+\+|---) ' \
            | grep -vE '^\+(!datos/comparar/?|#.*)$' || true)
  [ -z "$otras" ] || no "$ignore cambia algo más que la excepción de datos/comparar"
done

if grep -qx Dockerfile <<< "$cambios"; then
  # Dónde empiezan ml, interfaz y la última "FROM base" en cada versión del Dockerfile.
  # La etapa ml es [m, i); las de full, [i, f)
  etapas() {
    git show "$1:Dockerfile" | awk '/^FROM base AS ml$/ { m = NR } /^FROM .* AS interfaz$/ { i = NR }
                                    /^FROM base$/ { f = NR } END { print m + 0, i + 0, f + 0 }'
  }
  read -r m0 i0 f0 < <(etapas "$desde")
  read -r m1 i1 f1 < <(etapas "$hasta")
  [ "$m0" -gt 0 ] && [ "$i0" -gt "$m0" ] && [ "$f0" -gt "$i0" ] && [ "$m1" -gt 0 ] && [ "$i1" -gt "$m1" ] \
    && [ "$f1" -gt "$i1" ] || no "no encuentro las etapas ml y full"
  # Cada tramo cambiado (@@ -a,b +c,d @@) tiene que caer en [m, f), en las dos versiones; si toca
  # [m, i), cambió ml. Con b = 0 (o d = 0) el tramo no tiene líneas: se inserta (o se borra)
  # después de la línea a (o c)
  adentro() { # linea cantidad inicio fin
    local a=$1 n=$2 i=$3 f=$4
    if [ "$n" -eq 0 ]; then [ "$a" -ge "$i" ] && [ "$a" -lt "$f" ]; else [ "$a" -ge "$i" ] && [ $((a + n - 1)) -lt "$f" ]; fi
  }
  # (sin ",cantidad" en el encabezado, git quiere decir 1: el awk la completa, así read no corre los campos)
  while read -r a b c d; do
    adentro "$a" "$b" "$m0" "$f0" || no "el Dockerfile cambia la línea $a, en la etapa base"
    adentro "$c" "$d" "$m1" "$f1" || no "el Dockerfile cambia la línea $c, en la etapa base"
    if [ "$a" -lt "$i0" ] || [ "$c" -lt "$i1" ]; then ml=1; fi
  done < <(git diff -U0 "$desde" "$hasta" -- Dockerfile | awk '/^@@ / {
             split(substr($2, 2), x, ","); split(substr($3, 2), y, ",")
             print x[1], (2 in x ? x[2] : 1), y[1], (2 in y ? y[2] : 1) }')
fi

if [ "$ml" = 1 ]; then echo ml; else echo si; fi
