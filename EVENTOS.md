# Eventos

Lo que pasó en el proyecto, en orden, con lo más nuevo arriba: qué se hizo, qué
falló y en qué quedó. Las horas de GitHub están en UTC. Por qué se hizo cada cosa
está en [DECISIONES.md](DECISIONES.md).

## 2026-10-29

- **La tarde: hojas del laboratorio, maqueta y orden.**
  - **Seis hojas nuevas para el aula** en `guias/empresa/` (04 a 09), enlazadas
    desde su README: prueba piloto con 2 o 3 PCs y tabla para anotar, el dataset
    (NYC Taxi 2024 en Parquet, ~600 MB, con su comando de carga), plan B si falla
    el release, hoja para sistemas (TCP 8099 y UDP 51820 en la PC del profe, red
    "Pública", IPs 192.169.0.x), media página para el alumno y verificación de 1
    minuto sin la interfaz. Todo sacado de los `.cmd`, `estado`, `bloques.sh`,
    `lib.sh` y la sonda; `enlaces.py` y `tutoriales.py --revisar` en verde.
  - **Maqueta del rediseño 360** (`docs/maquetas/rediseno-360.html`) sumada al
    PR #9: un HTML solo, sin red, con datos simulados. Pestaña FULL (capas,
    motores y lenguajes, Comparar, tema claro) y pestaña AULA (PCs, tráfico entre
    PCs, editor 2D de filas, apagar una PC y ver HDFS/YARN reaccionar).
  - **Run 40856905329** (Full main tras el #7): terminó **verde** con el
    relanzamiento de las 11:53; publicó `:full`.
  - **Rama `ui2-rediseno-plan` borrada** (remota y local; PR #8 cerrado).
  - "Para seguir" en la hoja de ruta: la lista de todo lo que falta, en orden.

- **La noche del hub (05:25 a 10:30)**, siguiendo "Para el hub" de la hoja de ruta:
  - **Workflow Empresa** sobre `main` (run 40819945257): **verde**, las 34 pruebas en
    amd64 y arm64. Armó el prerelease **`aula-v1`** (05:47) con
    `bigdata-sandbox-empresa.tar.gz` (1,58 GB), `bigdata-sandbox-trabajador.tar.gz`
    (191 MB), el de arm64 (186 MB), los dos `.cmd` y el `LEEME.md`. **No** publicó
    `:empresa` ni `:trabajador` en Docker Hub: `subir` y `publicar` solo corren
    desde la rama `empresa` (el `:empresa` de Docker Hub sigue siendo del 27/10 y
    `:trabajador` no existe). Para el laboratorio alcanza con el release.
  - **PR #5** (ML a): verde. Chocaba con `main` solo en `HOJA-DE-RUTA.md`; se
    resolvió con un merge de `main` a la rama (solo `.md`, no relanza Full).
    **Mergeado** (`ca98877`).
  - **PR #7** (ML b): rojo en arm64 (run 40820136229), "datos de ejemplo en HDFS":
    `KeyError: '/user/root/ml/clientes_avro'`. Era real: la caché del `fsck` en
    `server/sandbox_server/hdfs.py` contaba la edad desde que el fsck
    **terminaba**. En arm64 tarda varios segundos: si arrancaba antes de que Spark
    escribiera el Avro, salía como fresco y sin el Avro. El primer arreglo
    (`ce5085a`, edad desde el arranque) trajo otro problema: con fsck de más de
    2 s la caché no servía nunca, cada pedido corría su fsck en fila y el humo de
    la interfaz en amd64 se cayó entero por timeouts. El arreglo que quedó
    (`c5adb30`) compara la edad con el **momento del pedido**: vale el fsck que
    arrancó hasta 2 s antes, incluido el que estaba corriendo. Con eso Full dio
    **verde** en las dos arquitecturas (run 40842607427). Se llevó a
    `ui2-ml-etapa-c` con merge y `[skip ci]`. **Mergeado** (`3a235ec`).
  - **Workflow Imagen** en `main`: el run del merge del #5 (40826389671) cayó en
    `armar (amd64)` porque `dlcdn.apache.org` ya no tiene Hive 4.0.0 (404) y el
    respaldo `archive.apache.org` no conectaba. Se relanzó y dio verde: `latest` y
    `base` se republicaron a las 06:58. Full sobre `main` (40826389800) y el
    amd64 de la (b) cayeron por lo mismo y pasaron al relanzarlos.
  - **Rediseño 360**: `REDISENO-FULL.md` en el **PR #9** (rama
    `ui2-rediseno-360`, solo documentación), con la sección Empresa / aula y las
    guías que faltan para probarla en el laboratorio. El PR #8 (rama
    `ui2-rediseno-plan`) se cerró: el commit había salido con otro autor y no se
    hace force-push. La rama quedó sin borrar.
  - **El merge del #5 salió con autor `ManIAco`** (la cuenta con la que se usa
    `gh`), no `Franki`. No se reescribe `main`. El #7 se mergeó desde git como
    `Franki`.
  - Después del merge del #7, **Imagen** en `main` (40856905342) dio **verde** y
    republicó `latest`, `base` y `ml` (11:33). **Full** en `main` (40856905329):
    arm64 verde; amd64 cayó por un `HTTP 500` del registro al bajar la imagen
    (infraestructura) y **quedó relanzado** (11:53). Hasta que pase, `:full` sigue
    siendo la del merge del #5.
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
