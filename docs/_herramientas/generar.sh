#!/usr/bin/env bash
# Regenera la documentacion de una o varias versiones: los PDF (README y guia), el HTML interactivo
# y su verificacion sin red. Desde la raiz del repo:
#   bash docs/_herramientas/generar.sh base [ml full empresa]
set -euo pipefail
cd "$(dirname "$0")/../.."
H=docs/_herramientas
[ $# -gt 0 ] || { echo "Uso: bash $H/generar.sh <version> [mas versiones]" >&2; exit 2; }
[ -d "$H/node_modules/marked" ] || (cd "$H" && npm ci --no-audit --no-fund --silent)
for v in "$@"; do
  d="docs/$v"
  [ -d "$d" ] || { echo "no existe $d" >&2; exit 1; }
  echo "== $v"
  mds=()
  for f in README.md guia.md; do [ -f "$d/$f" ] && mds+=("$d/$f"); done
  [ ${#mds[@]} -gt 0 ] && node "$H/pdf.mjs" "${mds[@]}"
  if [ -f "$d/interactivo.json" ]; then
    node "$H/interactivo.mjs" "$d/interactivo.json"
    node "$H/verificar-interactivo.mjs" "$d/interactivo.html" ${CAPTURAS:+--capturas "$CAPTURAS"}
  fi
done
