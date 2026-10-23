# Cambios

Los cambios que importan de cada versión. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones,
[Semantic Versioning](https://semver.org/lang/es/). Las imágenes se publican
en Docker Hub como
[`franki678/bigdata-sandbox`](https://hub.docker.com/r/franki678/bigdata-sandbox),
con un tag por versión de la imagen (`latest`, `base`, `ml`, `full`).

## [Sin publicar]

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

[Sin publicar]: https://github.com/Franki-678/bigdata-sandbox/compare/v1.0.0...main
[1.0.0]: https://github.com/Franki-678/bigdata-sandbox/releases/tag/v1.0.0
