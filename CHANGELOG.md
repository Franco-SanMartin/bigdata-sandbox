# Cambios

Los cambios que importan de cada versión. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones,
[Semantic Versioning](https://semver.org/lang/es/). Las imágenes se publican
en Docker Hub como
[`franki678/bigdata-sandbox`](https://hub.docker.com/r/franki678/bigdata-sandbox),
con un tag por versión de la imagen (`latest`, `base`, `ml`, `full`).

## [Sin publicar]

### Agregado

- **`empresa` con las PCs del laboratorio** (etapa 2, rama `empresa-aula`),
  con lo que midió la sonda el 27/10:
  - `RED=wireguard`: túnel WireGuard con hub en la PC del profe (UDP 51820) e
    inscripción con un código de la clase (TCP 8099). Cada PC reserva su
    nombre (`pcNN`), se conecta **hacia** el profe y se anuncia a HDFS y YARN
    con su IP del túnel (`10.13.0.x`). Las PCs no publican ningún puerto (no
    aparece el cartel del firewall). MTU 1380, con respaldo a 1280 por PC.
    Módulo del kernel o `wireguard-go`.
  - Imagen **`trabajador`** para las PCs: Java 8, Hadoop recortado al
    DataNode y al NodeManager, Python con numpy (el mismo que el maestro) y
    WireGuard; Spark y Tez llegan desde HDFS. 192 MB comprimida, contra
    1,6 GB de `empresa`. amd64 y arm64.
  - Cada PC presta dos tercios de la RAM de Docker (2048 MB en las de 8 GB,
    5120 en las de 16) y sus cores; `TRABAJADOR_RAM` y `TRABAJADOR_CORES` lo
    pisan. YARN reparte por memoria y por cores y da por perdida una PC al
    minuto.
  - El maestro corre la interfaz con la vista **Aula**: cada PC una lámpara
    (sumándose, arriba, sin respuesta, caída) con lo que presta y sus
    bloques, la IP, el código y la línea para Veyon, y el aviso "ya pueden
    apagar" cuando el maestro tiene una copia de cada bloque.
  - `empresa-profe.cmd` (arranca el maestro, muestra la línea para Veyon y
    carga datasets midiendo la velocidad) y `empresa-alumno.cmd` (carga la
    imagen de su carpeta o de una ruta de red y suma la PC). Release
    `aula-v1` con las imágenes en `.tar.gz`.
  - Guía 3 reescrita como el paso a paso de la clase, con tiempos y una tabla
    de tamaños de dataset para esta red.
- Sonda: `sonda-alumno.cmd IP sin-b`, sin la prueba B (no publica el 8098 y
  no aparece el cartel del firewall).
- Pruebas `aula-wg`, `aula-wg-caida` y `aula-wg-cero`: las PCs en redes de
  Docker separadas, unidas solo por el túnel, sin puertos publicados.

- Terminal integrada en la interfaz de `full` (``Ctrl+` `` o el ícono de arriba):
  bash del contenedor por websocket (`/api/terminal`), solo desde `localhost`
  (chequea Host y Origin). `TERMINAL=0` la apaga; `TERMINAL_HOSTS` suma
  nombres permitidos.
- Prácticas: *Correr en la terminal* en cada paso con comando. Se tipea en la
  terminal, toma lo que imprimió y el código de salida y, si el paso tiene
  verificación, la corre igual que antes.
- Prácticas: autoevaluación al final de cada una (2-3 preguntas y un desafío
  con pista y solución).
- Prácticas: exportar e importar el avance como JSON (al importar se queda,
  de cada práctica, la versión más avanzada).
- Prácticas: en cada tarjeta, qué servicios necesita (con su estado) y qué
  práctica conviene hacer antes.
- Prueba de humo de `full`: abre la terminal, corre comandos (`whoami`,
  `pwd`, `hdfs`) y comprueba que rechaza otro origen.

## [1.3.0] - 2026-10-27

Documentación completa para cada versión, las Prácticas de `full` te hacen
pensar el comando antes de correrlo, y sale `empresa` en beta.

### Agregado

- **Documentación por versión** en `guias/base`, `guias/ml`, `guias/full` y
  `guias/empresa`: paso a paso, referencia (qué hace cada cosa, dónde se usa y
  cómo), teoría y evaluación (opción múltiple con el porqué de cada respuesta,
  preguntas de desarrollo con respuesta modelo y ejercicios sobre la imagen
  con solución y rúbrica). El [índice de guías](guias/README.md) dice qué
  versión usar. Las guías 03 a 10 terminan con un *Para profundizar*.
- **`empresa` en beta** (tag `empresa`, amd64 y arm64): varias compus arman un
  solo cluster, con la del profe como maestro y cada PC como DataNode y
  NodeManager, racks por fila y una copia de cada bloque en el maestro. Hoy
  anda el aula simulada en una sola compu (`empresa/aula-simulada.yml`); la
  red entre PCs reales viene después, con lo que mida la sonda del
  laboratorio. Guía para probarla en clase:
  [`guias/empresa/03-laboratorio.md`](guias/empresa/03-laboratorio.md).

- **Pregunta antes de ejecutar** en cada paso que corre un comando (guías 03 a
  10): tres o cuatro opciones, y al elegir te dice por qué esa sí o por qué no
  y cuál era. *Ejecutar* se habilita después de responder; la barra lateral
  cuenta cuántas acertaste al primer intento y, si ya hiciste la práctica,
  podés ver la respuesta directo.
- **Dónde queda**: después de cada paso, qué hay en el contenedor, en HDFS, en
  la base y en tu compu, y cómo llegar a mirarlo en la interfaz.
- **Salida de la terminal**: lo que imprimiría el comando, tal cual, con el
  código de salida y lo que va a stderr marcado aparte.
- **Qué hiciste**: al terminar una práctica, cada paso con su comando y dónde
  quedó el resultado.
- **Volver al paso**: si saltás a otra pantalla desde un paso ("Ver en HDFS",
  "Ver el trabajo"), arriba queda un botón que te devuelve al mismo paso.
- **Antes de empezar**: cada práctica lista lo que necesita andando (y en qué
  paso), con el motivo y el botón que lo arregla, y las prácticas previas.

### Cambiado

- La interfaz es **oscura siempre**: no sigue al tema de Windows/macOS ni
  tiene interruptor.
- El comando que muestra cada paso es el que corre de verdad (el DataNode o
  NameNode que se apaga, el `setrep -w`, la carpeta exacta).
- *Bajarlo a tu compu* dice la verdad: el botón descarga por el navegador
  (WebHDFS); `hdfs dfs -get` baja al contenedor, y se explica la diferencia.
- La verificación automática espera espaciado (de 3 s a 10 s) y sin apilar
  pedidos, en vez de un fsck por segundo que llenaba la Consola.
- La versión `full` también monta tu carpeta `datos/` en `/datos` en el
  `docker run` del README.

### Arreglado

- **Salud** de HDFS ya no se contradice: si hay bloques sub-replicados que no
  tienen adónde copiarse (piden más copias que DataNodes vivos), el resumen y
  la cola lo dicen igual, en vez de "re-replicando" con la cola vacía.
- En la demo, al volver un DataNode se podían borrar copias de más dos veces y
  quedaban bloques sub-replicados para siempre.

## [1.2.0] - 2026-10-23

Cada modelo de Machine Learning por dentro: el modelo entrenado dibujado en 3D
con lo que de verdad aprendió y la cuenta de una fila hecha en el navegador,
igual a la del servidor. Además, el humo de `full` entrena todos los modelos
en los dos motores y prueba las prácticas de Spark desde la interfaz.

### Cambiado

- El archivo del aula (release `imagen`) carga un solo nombre,
  `franki678/bigdata-sandbox:base`, y las guías, el README y el
  `docker-compose.yml` usan ese mismo con el tag escrito, para que todo ande
  sin internet después del `docker load`.

### Agregado

- **Por dentro de cada modelo** en la pantalla de Machine Learning: el modelo
  entrenado dibujado en 3D con lo que de verdad aprendió, y la cuenta de una
  fila hecha delante tuyo, con reproducir, pausa, paso a paso, velocidad y
  cámara que se gira. La red neuronal (scikit-learn y MLlib) muestra capas,
  conexiones según su peso, el dato pasando capa por capa, las neuronas que se
  activan y las probabilidades de salida, y época por época con la curva de
  pérdida; el árbol, el camino de la fila hasta la hoja; KMeans, los puntos en
  3D y los centros moviéndose por iteración; la regresión lineal y la
  logística, su superficie con los residuos. Sin WebGL dice por qué y deja la
  cuenta en texto; con «reducir movimiento», paso a paso.
- `GET /api/ml/models/{id}/viz`: lo de adentro de cada modelo (pesos, nodos,
  centros, coeficientes) y una muestra con lo que predijo, para los últimos 30.
- La red neuronal también se ofrece con Spark MLlib en la recomendación.
- El humo rehace la cuenta de cada modelo con lo que devuelve `/viz` y la
  compara con lo que predijo el servidor (1e-6), y en la interfaz revisa que
  el dibujo 3D se vea y que la cuenta del navegador dé lo mismo.
- El humo de `full` entrena desde la API todos los modelos de ML en los dos
  motores (regresión, árbol, logística, red, tonto y KMeans) y revisa que la
  métrica quede en un rango razonable y que la regresión aprenda la regla real.
- Desde la interfaz: el pipeline entero desde el riel (con PySpark, Spark SQL,
  Spark MLlib y Sqoop), la práctica de Spark, y regresión, árbol con MLlib y
  KMeans desde la pantalla de ML.

### Arreglado

- La práctica de Spark ya no dice «No existe el trabajo» al lanzar SparkPi o las
  ventas: el servidor devuelve el id recién cuando el ResourceManager conoce la
  aplicación (spark-submit lo imprime antes de que YARN la acepte).
- El paso «Mirar el DAG» de la práctica de Spark espera a que Spark History
  cargue el trabajo recién terminado en vez de mostrar 0 etapas.

## [1.1.0] - 2026-10-23

La interfaz de `full`, rediseñada: tema claro, una pantalla de inicio que dice
qué se puede hacer y qué no, y prácticas guiadas contra el cluster.

### Agregado

- **Inicio**: el estado del cluster y "Qué podés hacer ahora", con cada
  capacidad lista o con el motivo por el que no está y cómo arreglarlo
  (activar MongoDB, borrar el volumen para alta disponibilidad...), y la guía
  que la explica.
- **Prácticas** guiadas paso a paso, una por guía de la 03 a la 10 (HDFS,
  MapReduce, Pig, Hive, MariaDB y Sqoop, Spark, alta disponibilidad,
  MongoDB), que se hacen desde la interfaz y chequean cada paso contra el
  cluster.
- **HDFS**: árbol de carpetas, ver, bajar y mover archivos, réplica por fila
  y, si la carpeta está vacía, dónde están los archivos.
- **Trabajos**: plantillas con parámetros (wordcount, pi, grep, ventas con
  MapReduce, Hive sobre Tez y Spark), detalle con avance, contenedores y logs
  en vivo, y el comando equivalente.
- **Consultas** sobre Hive, MariaDB, MongoDB y Pig: catálogo, ejemplos,
  guardadas, historial, plan y exportar a CSV; "Crear tabla ventas desde
  HDFS" cuando Hive no tiene tablas.
- En Cluster, MongoDB y JupyterLab no incluidos se pueden elegir y activar
  desde el detalle.
- Server: ver, bajar y mover en HDFS, plantillas de trabajos con parámetros y
  Pig desde la API.

### Cambiado

- Tema claro con tipografía IBM Plex; el color queda para estados y
  motores, y el acento solo para lo que se toca o se elige.
- Cada pantalla, con el cluster apagado o arrancando, dice qué vas a poder
  hacer y cuánto falta; cada botón deshabilitado dice por qué y cómo
  habilitarlo.
- Cabeceras de una línea con estado y ayuda, tablas y vacíos con el mismo
  componente, skeletons mientras carga una pantalla.
- Pipeline y Machine Learning con los componentes nuevos; ML recomienda qué
  modelo conviene y lo compara con la regla real.
- Las capturas del README son de la interfaz nueva (demo).

### Arreglado

- El estilo de una pantalla ya no pisa el de otra (ML heredaba tarjetas de
  HDFS y YARN); un test lo controla.
- Con un DataNode caído, HDFS ya no dice "sano" mientras la barra dice
  "Degradado".
- Textos encimados en el sinóptico y en Configuración a 1100 px.
- Humo de `full` más estable en arm64: el `-put` grande ya no falla por los
  reintentos normales del cliente y el wordcount espera a los DataNodes y al
  log del cliente.

## [1.0.0] - 2026-10-22

Primera versión estable: tres versiones de la imagen, todas probadas en
GitHub Actions en Intel/AMD y ARM antes de publicarse.

### Agregado

- **Versiones de la imagen**, cada una un `--target` del `Dockerfile`:
  - `base` (y `latest`, la misma imagen): Ubuntu 24.04 con Hadoop 3.3.6
    (HDFS, YARN, MapReduce), Hive 4.0 sobre Tez, Spark 3.5, Pig, Sqoop con
    MySQL (MariaDB 10.11), ZooKeeper y MongoDB 8.0 (`MONGODB=si`).
  - `ml`: `base` + pandas, numpy, scikit-learn, matplotlib, pymongo y
    JupyterLab.
  - `full`: `ml` + una interfaz web en el puerto 8080 para configurar,
    prender y mirar el cluster desde el navegador: arquitectura en vivo,
    HDFS (explorador, bloques, re-replicación, fsck), YARN (contenedores,
    colas, DAG de Tez y Spark, logs), un pipeline de seis etapas, consultas a
    Hive, MySQL y MongoDB, y entrenamiento de modelos con scikit-learn o
    Spark MLlib. Con `AUTOSTART=1` el cluster arranca solo.
- El servidor de `full` (`server/`), con su API documentada en
  `server/README.md` y tests con pytest (`server.yml`).
- Arquitectura de HDFS elegible al crear el contenedor: 1 a 9 DataNodes,
  réplicas, tamaño de bloque y alta disponibilidad del NameNode
  (`NAMENODES=2` o `3`, con ZooKeeper, JournalNodes y ZKFC).
- Guías nuevas, de la instalación de Docker a MongoDB (`guias/01` a `11`),
  con todos sus comandos probados contra la imagen en cada cambio
  (`pruebas/tutoriales.py`).
- Mapa interactivo de la arquitectura en GitHub Pages (`docs/index.html`) y
  [demo de la interfaz](https://franki-678.github.io/bigdata-sandbox/demo/)
  con un cluster simulado en el navegador (`docs/demo/`).
- Archivo de la imagen para repartir en el aula sin internet (release
  `imagen`, workflow `aula.yml`).
- Humo de `full` en el CI contra el contenedor real: la API chequeo por
  chequeo y la interfaz en Chromium con Playwright, con capturas de cada
  pantalla.
- `docker-compose.yml` con todos los parámetros del cluster.
- `README.en.md`, la traducción al inglés del README, y licencia Apache 2.0.

### Cambiado

- `latest` pasa a ser `base` (Ubuntu 24.04, Python 3.12, con MongoDB).
- CI más rápido: cada arquitectura se arma en su máquina nativa (sin
  emular), con cache de capas en ghcr.io compartida entre ramas; un commit
  que ya pasó en verde en otra rama se publica sin volver a armarlo; un
  cambio solo de documentación no rearma la imagen y corre las guías contra
  la publicada.
- Se publica solo desde `main` y solo con todos los escenarios en verde
  (reinicios, alta disponibilidad, caídas, cortes de luz, volúmenes de la
  imagen anterior), en amd64 y arm64; se verifica que lo publicado sea lo que
  se probó.
- Apagado en orden con `docker stop`: primero Hive y Spark, con HDFS todavía
  arriba.

### Eliminado

- La imagen anterior sobre Ubuntu 20.04 (tag `ubuntu20`) y su respaldo en el
  release del aula. Un volumen de esa imagen se sigue abriendo con `base`
  (guía 11).

### Arreglado

- Con el cluster apagado, la interfaz de `full` ya no pide
  `/api/yarn/apps` cada 2 segundos (la consola del navegador se llenaba de
  409 y el estado quedaba en "Sin conexión con el cluster"). El humo de la
  interfaz lo prueba y después vuelve a iniciar el cluster con el botón
  "Iniciar cluster".
- MySQL de un volumen de la imagen anterior: se pone al día con
  `mariadb-upgrade` y, si se apagó de golpe, el arranque explica cómo
  arreglarlo.
- `Cluster LISTO` recién cuando todos los DataNodes se anotaron.
- Primeros arranques cortados a la mitad: el siguiente arranque los
  recupera.

[Sin publicar]: https://github.com/Franki-678/bigdata-sandbox/compare/v1.3.0...main
[1.3.0]: https://github.com/Franki-678/bigdata-sandbox/releases/tag/v1.3.0
[1.2.0]: https://github.com/Franki-678/bigdata-sandbox/releases/tag/v1.2.0
[1.1.0]: https://github.com/Franki-678/bigdata-sandbox/releases/tag/v1.1.0
[1.0.0]: https://github.com/Franki-678/bigdata-sandbox/releases/tag/v1.0.0
