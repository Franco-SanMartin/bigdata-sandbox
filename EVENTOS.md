# Eventos

Lo que pasó en el proyecto, en orden, con lo más nuevo arriba: qué se hizo, qué
falló y en qué quedó. Las horas de GitHub están en UTC. Por qué se hizo cada cosa
está en [DECISIONES.md](DECISIONES.md).

## 2026-10-29

- **Pedido de Franki:** dar una **vuelta 360 a `full`**:
  - separar almacenamiento de procesamiento;
  - dejar claro qué es cada herramienta y cómo se combinan;
  - explicar qué herramientas sirven para la misma tarea.

  Además, **todas las interfaces en tema claro**. Quedó escrito en D-05 y D-06.
  Desde hoy el **hub** controla git y el CI de noche, con poco desarrollo (D-07).
  Se cortaron las sesiones locales.
- **ML, prueba de humo:** los PRs #5 y #7 fallaban en el humo de `full`, en amd64 y
  arm64. El estudio nuevo había tapado la pantalla de ML de la clase: los recorridos
  "entrenar desde la interfaz", "p5" y "p6" no encontraban sus botones. Arreglo:
  `92a5053`, la ML de clase vive en la pestaña *Guiado* (`#ml/guiado`) y la prueba
  la busca ahí. Se llevó a `ui2-ml-etapa-b` (`6ab83e9`) y a `ui2-ml-etapa-c`. El CI
  de los #5 y #7 quedó corriendo.
- **ML etapa (c):** quedó a medio hacer en `ui2-ml-etapa-c`. `0a0d0d5` y `cf534c5`
  son WIP con `[skip ci]`: motor, tests y cliente del estudio, todavía sin la
  interfaz terminada.
- **Workflow Empresa** lanzado a mano por Franki sobre `main` (04:50), para
  publicar `:empresa` y `:trabajador` y armar el release **`aula-v1`**. Seguía
  corriendo al cortar.
- **PR #6** mergeado (04:45): el apagado del cluster mata los `hdfs fsck` de fondo
  que estaban en vuelo. Era la falla intermitente del humo en arm64 ("apagado
  después del arranque desde Inicio").
- **Workflow Imagen** en `main`, rojo dos veces (00:26 y 00:30) en el escenario
  `parametros`: `failed to ingest blobs ... short read ... unexpected EOF`. Es la
  imagen que se pasa entre jobs, que llegó cortada: una falla de infraestructura
  del CI, no del código. Hasta que pase, `latest` en Docker Hub sigue siendo la
  del 27/10.
- **PR #3** (empresa en el aula: `RED=wireguard`, imagen `trabajador`, vista Aula y
  `.cmd` para Veyon) y **PR #4** (seguridad de la API de `full`) mergeados (00:26 y
  00:30). `:full` se republicó (02:22).
- La sesión en la nube para seguir ML no se pudo crear: el proyecto local no es
  un checkout de git.

## 2026-10-28

- **PR #7** abierto: ML etapa (b), con formatos de HDFS, perfil y receta de
  limpieza.
- **PR #5** abierto: ML etapa (a), con el motor `sandbox_ml` y las primeras
  pantallas. Se abrió desde la rama nueva `ui2-ml-etapa-a`, porque el push forzado
  de `ui2-ml-pro` estaba bloqueado.
- **PR #4** abierto: seguridad de la API (hosts permitidos, origen y
  `application/json`). Su chequeo `demo` falló porque `docs/demo` no estaba
  recompilada; se arregló con `3e7cadd`.
- **PR #3** abierto: etapa 2 de `empresa` en el aula.

## 2026-10-27

- **Sonda en el laboratorio:** PC del profe y 11 de alumnos. Veredicto **A**: túnel
  WireGuard arriba en 11 de 11, unos 50 Mbit/s alumno → profe y 31 alumno → alumno.
  Además:
  - la mayoría de las PCs tiene 8 GB y ninguna tiene GPU;
  - la red figura como "Pública", con IPs 192.169.0.x;
  - el reset borra todo cada día;
  - el cartel del firewall salía por la prueba B.

  Resultados en `sonda/resultados/2026-10-27/`.
- **PRs #1 y #2** mergeados: prácticas de HDFS, terminal integrada, autoevaluación
  y exportar/importar el avance.
- El repo pasó de `Franki-678` a `Franco-SanMartin`.
- Release **v1.3.0**.

## 2026-10-23

- Releases **v1.0.0**, **v1.1.0** y **v1.2.0**, y prerelease **`sonda-v1`**.

## 2026-10-20

- GitHub Pages publica el mapa interactivo del stack (`docs/index.html`).
