#!/usr/bin/env bash
# Deja lista la compu para generar la documentacion, SIN sudo:
#   1. las dependencias de Node de docs/_herramientas (npm ci),
#   2. un Chromium sin ventana: si no hay ninguno, baja el chrome-headless-shell de Playwright
#      a ~/.cache/ms-playwright,
#   3. en Linux, si al Chromium le faltan bibliotecas del sistema (pasa en servidores sin escritorio),
#      las baja con `apt-get download` (no instala nada) y las desarma en ~/.local/share/docs-pdf-libs,
#      que cdp.mjs suma solo al LD_LIBRARY_PATH.
set -euo pipefail
H="$(cd "$(dirname "$0")" && pwd)"
(cd "$H" && npm ci --no-audit --no-fund --silent)
CHROME="$(node -e "import('$H/cdp.mjs').then(m=>console.log(m.buscarNavegador())).catch(()=>{})")"
if [ -z "$CHROME" ]; then
  echo "Bajando chrome-headless-shell (Playwright)..."
  npx -y playwright@1 install chromium-headless-shell
  CHROME="$(node -e "import('$H/cdp.mjs').then(m=>console.log(m.buscarNavegador()))")"
fi
echo "Navegador: $CHROME"
if [ "$(uname)" = Linux ]; then
  LIBS="$HOME/.local/share/docs-pdf-libs"
  for vuelta in 1 2 3 4; do
    faltan="$(LD_LIBRARY_PATH="$(find "$LIBS" -type d -name '*-linux-gnu' 2>/dev/null | tr '\n' ':')" ldd "$CHROME" | awk '/not found/ {print $1}' | sort -u)"
    [ -z "$faltan" ] && break
    command -v apt-get >/dev/null || { echo "Faltan bibliotecas y no hay apt-get: $faltan" >&2; exit 1; }
    paquetes=""
    for so in $faltan; do
      p="$(apt-cache search --names-only "^$(echo "$so" | sed -E 's/\.so.*//; s/^lib//; s/-([0-9.]+)$/\1/' | tr 'A-Z' 'a-z')" 2>/dev/null | awk '{print $1}' | head -1 || true)"
      case "$so" in
        libatk-1.0*) p=libatk1.0-0t64 ;; libatspi*) p=libatspi2.0-0t64 ;; libasound*) p=libasound2t64 ;;
        libgbm*) p=libgbm1 ;; libdrm*) p=libdrm2 ;; libxkbcommon*) p=libxkbcommon0 ;;
        libXcomposite*) p=libxcomposite1 ;; libXdamage*) p=libxdamage1 ;; libXext*) p=libxext6 ;;
        libXfixes*) p=libxfixes3 ;; libXrandr*) p=libxrandr2 ;; libXrender*) p=libxrender1 ;; libXi.so*) p=libxi6 ;;
      esac
      [ -n "$p" ] && paquetes="$paquetes $p"
    done
    echo "Faltan: $(echo $faltan) -> bajando:$paquetes"
    tmp="$(mktemp -d)"
    (cd "$tmp" && apt-get download $paquetes >/dev/null)
    mkdir -p "$LIBS/raiz"
    for deb in "$tmp"/*.deb; do dpkg-deb -x "$deb" "$LIBS/raiz"; done
    rm -rf "$tmp"
  done
  [ -z "${faltan:-}" ] || { echo "Siguen faltando: $faltan" >&2; exit 1; }
fi
echo "Listo: bash $H/generar.sh <version>"
