# Cambios

Los cambios que importan de cada versión. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones,
[Semantic Versioning](https://semver.org/lang/es/). Las imágenes se publican
en Docker Hub como
[`franki678/bigdata-sandbox`](https://hub.docker.com/r/franki678/bigdata-sandbox),
con un tag por versión de la imagen (`latest`, `base`, `ml`, `full`).

## [Sin publicar]

### Cambiado

- El archivo del aula (release `imagen`) carga un solo nombre,
  `franki678/bigdata-sandbox:base`, y las guías, el README y el
  `docker-compose.yml` usan ese mismo con el tag escrito, para que todo ande
  sin internet después del `docker load`.

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

[Sin publicar]: https://github.com/Franki-678/bigdata-sandbox/compare/v1.1.0...main
[1.1.0]: https://github.com/Franki-678/bigdata-sandbox/releases/tag/v1.1.0
[1.0.0]: https://github.com/Franki-678/bigdata-sandbox/releases/tag/v1.0.0
