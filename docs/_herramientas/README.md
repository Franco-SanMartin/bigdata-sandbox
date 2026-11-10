# Herramientas de la documentación

Lo que arma los PDF y los HTML interactivos de `docs/<version>/`. Todo corre en la compu, sin servicios
externos: Node 22 y un Chromium sin ventana.

| Archivo | Qué hace |
|---|---|
| `pdf.mjs` | Markdown → PDF (A4, IBM Plex, número de página, índice del PDF con los títulos) |
| `interactivo.mjs` | `interactivo.json` → `interactivo.html` autocontenido (anda sin red) |
| `verificar-interactivo.mjs` | Abre un `interactivo.html` sin red y prueba que ande; saca capturas |
| `generar.sh` | Regenera todo lo de una o varias versiones (PDF + interactivo + verificación) |
| `instalar.sh` | Deja listo el Chromium y las dependencias, sin `sudo` |
| `plantilla-interactivo.html` | La página del interactivo (estilos y lógica); los datos vienen del `.json` |
| `estilo-pdf.css` | El aspecto de los PDF |
| `fuentes/` | IBM Plex Sans y Mono (licencia OFL, `fuentes/OFL.txt`) |
| `ejemplo.json` | Un interactivo mínimo para copiar como punto de partida |
| `cdp.mjs` | Maneja el Chromium por el protocolo de DevTools (lo usan los otros scripts) |

## Cómo se usa

Una vez por compu:

```bash
bash docs/_herramientas/instalar.sh
```

Después, para regenerar todo lo de una versión (desde la raíz del repo):

```bash
bash docs/_herramientas/generar.sh base
bash docs/_herramientas/generar.sh base ml full empresa   # varias
```

`generar.sh <version>` hace, para `docs/<version>/`:

1. `README.md` → `README.pdf` y `guia.md` → `guia.pdf`.
2. `interactivo.json` → `interactivo.html` (corta si el `.json` tiene ids repetidos, conexiones a
   componentes que no existen o links rotos).
3. Verifica el `interactivo.html` sin red (ver abajo).

Sueltos:

```bash
node docs/_herramientas/pdf.mjs docs/base/README.md docs/base/guia.md
node docs/_herramientas/interactivo.mjs docs/base/interactivo.json
node docs/_herramientas/verificar-interactivo.mjs docs/base/interactivo.html --capturas /tmp/capturas
```

## Los PDF

- Cada PDF queda al lado de su `.md`. Arriba dice de qué archivo y de qué commit sale.
- Los títulos llevan el mismo ancla que en GitHub: un link `#sección` anda igual en el `.md` y en el PDF.
- Un link relativo a otro `.md` de `docs/` que tenga PDF pasa a apuntar al PDF (en la misma carpeta).
  Cualquier otro link relativo (al `Dockerfile`, a `conf/`…) pasa a su dirección en GitHub, porque el
  PDF suelto no tiene el repo al lado.
- Las imágenes relativas (`![...](img/arquitectura.svg)`) se incrustan. Para diagramas conviene SVG:
  se ve igual en GitHub, en el PDF y sin red.
- Los comentarios HTML (`<!-- prueba: ... -->`, las marcas de `pruebas/tutoriales.py`) no se ven.

## El interactivo

Cada versión tiene un `docs/<version>/interactivo.json`; `interactivo.mjs` lo mete en la plantilla y deja
un solo `interactivo.html` (fuentes incrustadas, sin CDN, sin `fetch`). Tiene tres pestañas:

- **Mapa y conexiones**: los componentes en filas por capa, con flechas. Al tocar uno se resaltan sus
  conexiones y el panel muestra qué es, versión, puertos, con qué se conecta, cómo se usa y qué no hace.
  Abajo, los **recorridos**: una tarea paso a paso, resaltando las piezas que toca. En pantallas
  angostas el dibujo se reemplaza por una lista por capas.
- **Cómo se usa**: pasos numerados con sus comandos (botón Copiar) y "Ver en el mapa".
- **Puertos y accesos**: la tabla de todos los puertos, armada sola desde los componentes.

### Campos del `.json`

| Campo | Qué es |
|---|---|
| `tag`, `nombre`, `titulo`, `subtitulo` | Encabezado (`nombre` va antes del tag: "Versión `base`") |
| `contenedor` | Nombre del contenedor para el rótulo "Adentro del contenedor (`docker exec -it <contenedor> bash`)"; por defecto `bigdata` |
| `arranque` | `{ "texto", "cmd" }`: el comando de arranque, con botón Copiar arriba a la derecha |
| `intro`, `pie` | Texto del panel de inicio y del pie |
| `guia`, `readme` | `{ "md", "pdf" }`: links a la guía y al README de la versión |
| `capas[]` | `{ "id", "nombre", "desc", "color" }`, en orden de arriba a abajo |
| `componentes[]` | `{ "id", "nombre", "capa", "corto", "version", "que", "puertos": [{ "n", "que", "url" }], "comandos": [{ "donde": "compu" \| "adentro" \| texto, "cmd" }], "no", "guia": { "archivo", "seccion" }, "x" }` |
| `conexiones[]` | `{ "de", "a", "que", "tipo": "control" (punteada), "doble": true (flecha en las dos puntas) }` |
| `recorridos[]` | `{ "id", "nombre", "desc", "pasos": [{ "titulo", "texto", "nodos": [ids], "cmd" }] }` |
| `usoIntro`, `uso[]` | `{ "titulo", "texto", "comandos": [...], "nodos": [ids], "guia" }` |
| `puertosIntro` | Texto arriba de la tabla de puertos |

En los textos se puede usar `` `código` `` y `**negrita**`; nada más de Markdown. `x` (de 0 a 1) fija la
posición horizontal de una caja en su fila si el reparto automático no queda bien. Colores de capa: los de
`ui/src/styles/tokens.css` (`--capa-*`), para que el mapa se vea como la interfaz.

### Qué prueba `verificar-interactivo.mjs`

A 1440 y a 390 px de ancho: que no pida nada a la red, que no tire errores de JavaScript, que la fuente
incrustada cargue, que no haya scroll horizontal, que tocar un componente abra su detalle, que el primer
recorrido avance, que "Cómo se usa" tenga pasos y que una búsqueda sin resultados muestre el aviso.
Sale con código 1 si algo falla.

## Si `instalar.sh` no puede

`pdf.mjs` y los otros buscan el navegador en `$CHROME`, después el `chrome-headless-shell` que baja
Playwright (`~/.cache/ms-playwright`) y después `chromium` o `google-chrome` del sistema. Con cualquier
Chromium o Chrome instalado alcanza: `CHROME=/ruta/al/chrome bash docs/_herramientas/generar.sh base`.
