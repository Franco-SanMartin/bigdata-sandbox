#!/usr/bin/env bash
# Prueba pruebas/solo_full.sh con commits de prueba armados en un índice aparte
# (no toca el árbol de trabajo ni la rama): un cambio en cada lugar que importa
# y la historia de los PR ya mergeados. Necesita la historia (fetch-depth: 0).
# Uso, parado en el repo: bash pruebas/probar_solo_full.sh
set -euo pipefail
base=$(git rev-parse origin/main 2>/dev/null || git rev-parse HEAD)
export GIT_INDEX_FILE=$(mktemp)
mal=0

commit_con() { # descripcion; despues pares archivo=contenido-nuevo (agrega una linea al final)
  git read-tree "$base"
  local f
  for f in "$@"; do
    local blob
    blob=$( { git show "$base:$f" 2>/dev/null || true; echo "# prueba"; } | git hash-object -w --stdin)
    git update-index --add --cacheinfo 100644 "$blob" "$f"
  done
  git commit-tree "$(git write-tree)" -p "$base" -m prueba
}

dockerfile_linea() { # numero de linea del Dockerfile a modificar
  git read-tree "$base"
  local blob
  blob=$(git show "$base:Dockerfile" | awk -v n="$1" 'NR == n { print $0 " # prueba"; next } { print }' | git hash-object -w --stdin)
  git update-index --cacheinfo 100644 "$blob" Dockerfile
  git commit-tree "$(git write-tree)" -p "$base" -m prueba
}

espera() { # nombre esperado commit
  local r
  r=$(bash pruebas/solo_full.sh "$base" "$3" 2>/dev/null)
  if [ "$r" = "$2" ]; then echo "ok   $1 -> $r"; else echo "MAL  $1 -> $r (esperaba $2)"; mal=1; fi
}

linea() { git show "$base:Dockerfile" | grep -n "$1" | head -1 | cut -d: -f1; }
ml_ini=$(linea '^FROM base AS ml$'); int_ini=$(linea 'AS interfaz$')

espera "solo la interfaz" si "$(commit_con ui/src/main.tsx)"
espera "el estudio de ML" ml "$(commit_con ml/sandbox_ml/catalogo.py)"
espera "ML + interfaz + servidor" ml "$(commit_con ml/sandbox_ml/catalogo.py ui/src/main.tsx server/sandbox_server/ml.py)"
espera "librerías de ML" ml "$(commit_con conf/requirements-ml.txt)"
espera "prueba de ML" ml "$(commit_con pruebas/probar_ml.sh)"
espera "Dockerfile, etapa ml" ml "$(dockerfile_linea $((ml_ini + 5)))"
espera "Dockerfile, etapa full" si "$(dockerfile_linea $((int_ini + 5)))"
espera "Dockerfile, etapa base" no "$(dockerfile_linea $((ml_ini - 10)))"
espera "configuración de Hadoop" no "$(commit_con conf/core-site.xml)"
espera "ML + algo de base" no "$(commit_con ml/sandbox_ml/catalogo.py entrypoint.sh)"
r=$(bash pruebas/solo_full.sh 8b291b2 deb6733 2>/dev/null); [ "$r" = si ] && echo "ok   historia PR 10 -> si" || { echo "MAL  historia PR 10 -> $r"; mal=1; }
r=$(bash pruebas/solo_full.sh deb6733 5316fab 2>/dev/null); [ "$r" = si ] && echo "ok   historia PR 11 -> si" || { echo "MAL  historia PR 11 -> $r"; mal=1; }
rm -f "$GIT_INDEX_FILE"
exit $mal
