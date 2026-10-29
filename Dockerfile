# BigData sandbox: HDFS + YARN + MapReduce + Pig + Hive (sobre Tez) + Spark +
# Sqoop (con una base MySQL de ejemplo) + MongoDB, todo en UNA imagen / UN
# contenedor, pero con cada daemon como proceso separado y su UI web
# navegable. La arquitectura de HDFS (DataNodes, NameNodes, replicacion,
# tamano de bloque) se elige en el docker run.
# Buildea desde los tarballs oficiales de Apache sobre base Java -> corre en
# amd64 y ARM64.
#
# Versiones de la imagen (cada una es un --target):
#   base   el stack de Hadoop + MySQL + MongoDB
#            docker build --target base -t franki678/bigdata-sandbox:base .
#   ml     base + pandas, scikit-learn, XGBoost, Spark MLlib y JupyterLab
#            docker build --target ml -t franki678/bigdata-sandbox:ml .
#   full   ml + el servidor de la interfaz web (:8080), que prende el cluster
#            docker build --target full -t franki678/bigdata-sandbox:full .
#   empresa  full + el cluster del aula: con ROL=maestro / ROL=trabajador cada
#            contenedor es un nodo de un cluster de varias PCs
#            docker build --target empresa -t franki678/bigdata-sandbox:empresa .
#   trabajador  la imagen chica de las PCs del aula (empresa con RED=wireguard):
#            solo Java, el DataNode y el NodeManager, Python con numpy y el
#            tunel. Spark y Tez le llegan desde HDFS (los sube el maestro)
#            docker build --target trabajador -t franki678/bigdata-sandbox:trabajador .
# Sin --target se arma la base.

ARG HADOOP_VERSION=3.3.6
ARG HIVE_VERSION=4.0.0
ARG TEZ_VERSION=0.10.3
ARG SPARK_VERSION=3.5.9
ARG ZOOKEEPER_VERSION=3.8.7
ARG PIG_VERSION=0.18.0
ARG SQOOP_VERSION=1.4.7
ARG MONGODB_VERSION=8.0
# wireguard-go 0.0.20250522 (el respaldo del tunel sin el modulo del kernel)
ARG WIREGUARD_GO_VERSION=v0.0.0-20250521234502-f333402bd9cb

# ===========================================================================
# Etapa 1: bajar y desarmar los paquetes de Apache.
# Son programas Java, iguales para amd64 y ARM64. Esta etapa corre en el
# procesador de la maquina que buildea ($BUILDPLATFORM), asi al armar la
# imagen para las dos arquitecturas se bajan una sola vez y no se desarman
# emulando el otro procesador (lo que mas tarda).
# Hadoop va en una etapa propia (hadoop-dist) para que la imagen trabajador lo
# tome sin bajar todo lo demas.
# ===========================================================================
FROM --platform=$BUILDPLATFORM eclipse-temurin:8-jre-noble AS hadoop-dist
ARG HADOOP_VERSION
ARG HIVE_VERSION
ARG TEZ_VERSION
ARG SPARK_VERSION
ARG ZOOKEEPER_VERSION
ARG PIG_VERSION
ARG SQOOP_VERSION

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

# Baja de la CDN de Apache (rapida); si esa version ya no esta ahi (la CDN solo
# tiene las ultimas), del archivo historico (lento pero tiene todas). El
# archivo historico a veces no contesta desde GitHub Actions: se reintenta.
RUN printf '#!/bin/sh\ncurl -fSL "https://dlcdn.apache.org/$1" -o "$2" || curl -fSL --retry 6 --retry-delay 20 --retry-all-errors --connect-timeout 30 "https://archive.apache.org/dist/$1" -o "$2"\n' \
      > /usr/local/bin/apache-dl \
 && chmod +x /usr/local/bin/apache-dl

# --- Hadoop ---
# Se saca lo que no usa un cluster en ejecucion (~950 MB): la documentacion,
# el SDK de AWS S3, las librerias de C para compilar programas propios
# (*.a, libhdfspp, ejemplos), la web de un catalogo de apps de YARN y el
# "minicluster" que se usa para tests.
RUN apache-dl "hadoop/common/hadoop-${HADOOP_VERSION}/hadoop-${HADOOP_VERSION}.tar.gz" /tmp/hadoop.tgz \
 && tar -xzf /tmp/hadoop.tgz -C /opt \
 && mv /opt/hadoop-${HADOOP_VERSION} /opt/hadoop \
 && rm /tmp/hadoop.tgz \
 && rm -rf /opt/hadoop/share/doc /opt/hadoop/lib/native/examples \
 && rm -f /opt/hadoop/share/hadoop/tools/lib/aws-java-sdk-bundle-*.jar \
          /opt/hadoop/lib/native/*.a /opt/hadoop/lib/native/libhdfspp* \
          /opt/hadoop/share/hadoop/yarn/hadoop-yarn-applications-catalog-webapp-*.war \
          /opt/hadoop/share/hadoop/client/hadoop-client-minicluster-*.jar

FROM hadoop-dist AS descargas
ARG HADOOP_VERSION
ARG HIVE_VERSION
ARG TEZ_VERSION
ARG SPARK_VERSION
ARG ZOOKEEPER_VERSION
ARG PIG_VERSION
ARG SQOOP_VERSION

# --- Hive ---
# Sin el driver JDBC suelto (es para clientes de afuera), sin los conectores a
# Druid y Kudu (otros sistemas, que aca no hay) y sin un parquet de ejemplo
# de 33 MB. Hive 4 trae un guava viejo que choca con el de Hadoop: alineamos.
RUN apache-dl "hive/hive-${HIVE_VERSION}/apache-hive-${HIVE_VERSION}-bin.tar.gz" /tmp/hive.tgz \
 && tar -xzf /tmp/hive.tgz -C /opt \
 && mv /opt/apache-hive-${HIVE_VERSION}-bin /opt/hive \
 && rm /tmp/hive.tgz \
 && rm -rf /opt/hive/jdbc \
 && rm -f /opt/hive/lib/hive-druid-handler-*.jar /opt/hive/lib/hive-kudu-handler-*.jar \
          /opt/hive/lib/kudu-client-*.jar /opt/hive/examples/files/web_sales.parquet \
          /opt/hive/lib/guava-*.jar \
 && cp /opt/hadoop/share/hadoop/common/lib/guava-*.jar /opt/hive/lib/

# --- Tez (motor de ejecucion de Hive 4) ---
RUN apache-dl "tez/${TEZ_VERSION}/apache-tez-${TEZ_VERSION}-bin.tar.gz" /tmp/tez.tgz \
 && tar -xzf /tmp/tez.tgz -C /opt \
 && mv /opt/apache-tez-${TEZ_VERSION}-bin /opt/tez \
 && rm /tmp/tez.tgz

# --- Spark (build con soporte Hive, para leer las tablas del metastore) ---
# Sin R, Kubernetes ni el "shuffle service" externo para YARN (74 MB, aca no
# se usa: cada executor sirve su propio shuffle).
RUN apache-dl "spark/spark-${SPARK_VERSION}/spark-${SPARK_VERSION}-bin-hadoop3.tgz" /tmp/spark.tgz \
 && tar -xzf /tmp/spark.tgz -C /opt \
 && mv /opt/spark-${SPARK_VERSION}-bin-hadoop3 /opt/spark \
 && rm /tmp/spark.tgz \
 && rm -rf /opt/spark/R /opt/spark/kubernetes /opt/spark/yarn

# --- ZooKeeper (solo arranca con NAMENODES >= 2: elige el NameNode activo) ---
RUN apache-dl "zookeeper/zookeeper-${ZOOKEEPER_VERSION}/apache-zookeeper-${ZOOKEEPER_VERSION}-bin.tar.gz" /tmp/zk.tgz \
 && tar -xzf /tmp/zk.tgz -C /opt \
 && mv /opt/apache-zookeeper-${ZOOKEEPER_VERSION}-bin /opt/zookeeper \
 && rm /tmp/zk.tgz \
 && rm -rf /opt/zookeeper/docs

# --- Pig (Pig Latin -> trabajos MapReduce sobre YARN) ---
# El paquete pesa ~600 MB; quedan ~90. Se saca: su copia propia de Hadoop (usa
# la del contenedor), el modo Spark, los conectores a HBase y Accumulo, los
# UDF en Ruby, y documentacion, codigo fuente, tests y tutorial.
RUN apache-dl "pig/pig-${PIG_VERSION}/pig-${PIG_VERSION}.tar.gz" /tmp/pig.tgz \
 && tar -xzf /tmp/pig.tgz -C /opt \
 && mv /opt/pig-${PIG_VERSION} /opt/pig \
 && rm /tmp/pig.tgz \
 && cd /opt/pig \
 && rm -rf docs src test tutorial contrib legacy lib-src ivy shims build.xml ivy.xml \
           lib/spark lib/hadoop3-runtime lib/h2 \
 && rm -f lib/hbase-*.jar lib/accumulo-*.jar lib/jruby-*.jar

# --- Sqoop (copia tablas entre una base de datos y HDFS, con MapReduce) ---
# 1.4.7 es la ultima version (el proyecto se retiro en 2021) y sigue siendo la
# que se ensena. Le faltan dos jars que Hadoop 3 ya no trae: commons-lang 2 y
# el driver JDBC de MySQL (el clasico 5.1, el que espera Sqoop). Se saca su
# codigo fuente, documentacion y tests, y un slf4j viejo que choca con el de
# Hadoop. Los avisos de "HBase/HCatalog/Accumulo no existe" se silencian: esos
# sistemas no estan y no hacen falta.
# (directo del archivo historico: la CDN redirige los proyectos retirados a
# una pagina web)
RUN curl -fSL --retry 6 --retry-delay 20 --retry-all-errors --connect-timeout 30 "https://archive.apache.org/dist/sqoop/${SQOOP_VERSION}/sqoop-${SQOOP_VERSION}.bin__hadoop-2.6.0.tar.gz" -o /tmp/sqoop.tgz \
 && tar -xzf /tmp/sqoop.tgz -C /opt \
 && mv /opt/sqoop-${SQOOP_VERSION}.bin__hadoop-2.6.0 /opt/sqoop \
 && rm /tmp/sqoop.tgz \
 && cd /opt/sqoop \
 && rm -rf docs src testdata ivy ivy.xml build.xml pom-old.xml sqoop-patch-review.py \
           sqoop-test-*.jar lib/slf4j-api-*.jar \
 && curl -fSL https://repo1.maven.org/maven2/commons-lang/commons-lang/2.6/commons-lang-2.6.jar \
         -o lib/commons-lang-2.6.jar \
 && curl -fSL https://repo1.maven.org/maven2/mysql/mysql-connector-java/5.1.49/mysql-connector-java-5.1.49.jar \
         -o lib/mysql-connector-java-5.1.49.jar \
 && sed -i -E 's/^( *)echo .*(does not exist! (HBase|HCatalog|Accumulo)|Please set \$(HBASE|HCAT|ACCUMULO|ZOOKEEPER)_HOME).*/\1:/' \
        bin/configure-sqoop

# ===========================================================================
# Version "base" (franki678/bigdata-sandbox:base): todo el stack de Hadoop,
# MySQL para Sqoop y MongoDB. Una imagen por arquitectura, sobre Ubuntu 24.04.
# JDK y no solo el runtime (JRE): Sqoop genera y compila una clase Java por
# cada tabla que copia.
# ===========================================================================
FROM eclipse-temurin:8-jdk-noble AS base
ARG DEBIAN_FRONTEND=noninteractive
ARG MONGODB_VERSION

ENV SANDBOX_VERSION=base \
    HADOOP_HOME=/opt/hadoop \
    HIVE_HOME=/opt/hive \
    TEZ_HOME=/opt/tez \
    SPARK_HOME=/opt/spark \
    ZK_HOME=/opt/zookeeper \
    PIG_HOME=/opt/pig \
    SQOOP_HOME=/opt/sqoop \
    HADOOP_COMMON_HOME=/opt/hadoop \
    HADOOP_MAPRED_HOME=/opt/hadoop \
    ZOOKEEPER_HOME=/opt/zookeeper \
    HADOOP_CONF_DIR=/opt/hadoop/etc/hadoop \
    YARN_CONF_DIR=/opt/hadoop/etc/hadoop \
    HIVE_CONF_DIR=/opt/hive/conf \
    PYSPARK_PYTHON=python3 \
    PIG_HEAPSIZE=512 \
    HDFS_NAMENODE_USER=root \
    HDFS_DATANODE_USER=root \
    HDFS_SECONDARYNAMENODE_USER=root \
    HDFS_JOURNALNODE_USER=root \
    HDFS_ZKFC_USER=root \
    YARN_RESOURCEMANAGER_USER=root \
    YARN_NODEMANAGER_USER=root \
    HADOOP_CLIENT_OPTS="-XX:+UseSerialGC -XX:TieredStopAtLevel=1"
# HADOOP_CLIENT_OPTS: los comandos (hdfs dfs, hive, beeline, pig...) arrancan
# una JVM nueva cada vez; con estas opciones arrancan mas rapido y ocupan menos.
# Spark al final del PATH: trae su propio 'beeline' y tiene que ganar el de Hive
ENV PATH=/opt/sandbox/bin:$HADOOP_HOME/bin:$HADOOP_HOME/sbin:$HIVE_HOME/bin:$PIG_HOME/bin:$SQOOP_HOME/bin:$ZK_HOME/bin:$PATH:$SPARK_HOME/bin

# tini como proceso 1: recoge los procesos que mueren (ej. 'datanode stop').
# Sin el, quedan zombies que Hadoop sigue viendo como vivos.
# python3: PySpark y los scripts de Hadoop Streaming.
# mariadb-server: la base MySQL de ejemplo para Sqoop. Su base de datos vacia
# de fabrica se borra: la real se crea en el volumen (/hadoop/mysql) al
# arrancar por primera vez.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl procps net-tools less python3 tini \
      mariadb-server \
 && rm -rf /var/lib/apt/lists/* /var/lib/mysql/*

# MongoDB (se prende con MONGODB=si): el servidor (mongod) y la consola
# (mongosh), del repositorio oficial de MongoDB porque Ubuntu no lo trae. Se
# saca la libreria de cifrado de mongosh (95 MB, para cifrar campos del lado
# del cliente, que aca no se usa). Su base vacia se crea en el volumen
# (/hadoop/mongodb) al arrancar por primera vez.
RUN curl -fsSL "https://pgp.mongodb.com/server-${MONGODB_VERSION}.asc" -o /usr/share/keyrings/mongodb.asc \
 && echo "deb [signed-by=/usr/share/keyrings/mongodb.asc] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/${MONGODB_VERSION} multiverse" \
      > /etc/apt/sources.list.d/mongodb-org.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends mongodb-org-server mongodb-mongosh \
 && rm -rf /var/lib/apt/lists/* /var/lib/mongodb/* /usr/lib/mongosh_crypt_v1.so

COPY --from=descargas /opt/hadoop    ${HADOOP_HOME}
COPY --from=descargas /opt/hive      ${HIVE_HOME}
COPY --from=descargas /opt/tez       ${TEZ_HOME}
COPY --from=descargas /opt/spark     ${SPARK_HOME}
COPY --from=descargas /opt/zookeeper ${ZK_HOME}
COPY --from=descargas /opt/pig       ${PIG_HOME}
COPY --from=descargas /opt/sqoop     ${SQOOP_HOME}

# JAVA_HOME explicito para los scripts de Hadoop
RUN echo "export JAVA_HOME=${JAVA_HOME}" >> ${HADOOP_CONF_DIR}/hadoop-env.sh

# core-site, tez-site y spark-defaults son plantillas: la direccion de HDFS
# cambia segun haya 1 NameNode o varios. hdfs-site se genera entero al arrancar.
COPY conf/core-site.xml conf/tez-site.xml conf/spark-defaults.conf /opt/sandbox/templates/
COPY conf/yarn-site.xml        ${HADOOP_CONF_DIR}/yarn-site.xml
COPY conf/mapred-site.xml      ${HADOOP_CONF_DIR}/mapred-site.xml
COPY conf/hive-site.xml        ${HIVE_CONF_DIR}/hive-site.xml
COPY conf/spark-hive-site.xml  ${SPARK_HOME}/conf/hive-site.xml
COPY conf/zoo.cfg              ${ZK_HOME}/conf/zoo.cfg
COPY conf/mysql.cnf            /etc/mysql/mariadb.conf.d/99-sandbox.cnf
COPY conf/mongod.conf          /etc/mongod.conf
COPY conf/mongosh.conf         /etc/mongosh.conf
COPY sandbox/                  /opt/sandbox/
COPY entrypoint.sh             /opt/entrypoint.sh
# Ejemplos (datasets y scripts): se copian a /datos/ejemplos al arrancar, para
# quien baja la imagen ya armada y no tiene el repo. Los de ejemplos/ml
# necesitan las librerias de la version ml: van recien ahi.
COPY datos/ejemplos/           /opt/sandbox/ejemplos/
# sed: si el repo se clono en Windows con saltos CRLF, los scripts no arrancan.
# ls, df y du: BLOCK_SIZE (-e BLOCK_SIZE=1m) es el tamano de bloque de HDFS,
# pero ls, df y du de Linux leen una variable con el mismo nombre y mostrarian
# todo en MB. Estos tres (primeros en el PATH) la ignoran y llaman al original.
RUN rm -rf /opt/sandbox/ejemplos/ml \
 && find /opt/entrypoint.sh /opt/sandbox/lib.sh /opt/sandbox/bin /opt/sandbox/ejemplos -type f \
      -exec sed -i 's/\r$//' {} + \
 && for c in ls df du; do \
      printf '#!/bin/sh\nunset BLOCK_SIZE\nexec /usr/bin/%s "$@"\n' "$c" > /opt/sandbox/bin/$c; \
    done \
 && chmod +x /opt/entrypoint.sh /opt/sandbox/bin/* && mkdir -p /datos

# HDFS: NameNodes 9870-9872, Secondary 9868, DataNodes 9901-9909, RPC 9000
#       JournalNodes 8480-8482 (solo HA)
# YARN: RM 8088, NM 8042 | MR JobHistory 19888
# Hive: Metastore 9083, HiveServer2 JDBC 10000 y UI 10002 | Spark: 18080, 4040
# MySQL (base de ejemplo para Sqoop): 3306 | MongoDB: 27017
EXPOSE 9870-9872 9868 9901-9909 9000 8480-8482 8088 8042 19888 9083 10000 10002 18080 4040 3306 27017

# /hadoop: datos de HDFS + metastore + bases MySQL y MongoDB (persisten entre reinicios)
# /datos:  carpeta para compartir archivos con la compu (CSV, scripts, etc.)
VOLUME ["/hadoop"]
WORKDIR /datos

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/entrypoint.sh"]

# ===========================================================================
# Version "ml" (franki678/bigdata-sandbox:ml): la base + Python para datos:
# pandas y numpy para ETL, scikit-learn y Spark MLlib para modelos, graficos
# con matplotlib, pymongo para MongoDB y JupyterLab (notebooks en :8888).
# ===========================================================================
FROM base AS ml
ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3-pip \
 && rm -rf /var/lib/apt/lists/*

# Las librerias, con versiones fijas (conf/requirements-ml.txt dice por que
# cada una). Ubuntu no deja instalar con pip "encima" de su Python
# (--break-system-packages): en un contenedor que es solo para esto, no hay
# nada que romper. Se sacan los tests de cada libreria (~150 MB que solo
# sirven para desarrollarlas) y los archivos para compilar extensiones de pyarrow.
COPY conf/requirements-ml.txt /opt/sandbox/requirements-ml.txt
RUN pip install --no-cache-dir --break-system-packages -r /opt/sandbox/requirements-ml.txt \
 && cd /usr/local/lib/python3.12/dist-packages \
 && find numpy pandas pyarrow scipy sklearn matplotlib -depth -type d \( -name tests -o -name test \) \
      -exec rm -rf {} + \
 && rm -rf pyarrow/include pyarrow/src \
 && find pyarrow -name '*.pyx' -o -name '*.pxd' -o -name '*.h' | xargs rm -f

# PYTHONPATH: que "import pyspark" ande en cualquier python3 (JupyterLab, un
# script suelto), no solo con spark-submit o pyspark; y "import sandbox_ml",
# el apoyo del estudio de ML (ver mas abajo).
# PIP_BREAK_SYSTEM_PACKAGES: que "pip install <libreria>" ande adentro sin
# tener que agregar la opcion.
ENV SANDBOX_VERSION=ml \
    PYTHONPATH=/opt/sandbox/ml:/opt/spark/python:/opt/spark/python/lib/py4j-0.10.9.7-src.zip \
    PIP_BREAK_SYSTEM_PACKAGES=1

# JupyterLab sin contrasena y sin el cartel de noticias de Jupyter. El primer
# import de matplotlib arma la lista de fuentes (tarda): se hace ahora.
COPY conf/jupyter_server_config.py /etc/jupyter/jupyter_server_config.py
RUN jupyter labextension disable "@jupyterlab/apputils-extension:announcements" \
 && python3 -c "import pyspark, py4j, numpy, pandas, pyarrow, sklearn, xgboost, pymongo, matplotlib.pyplot"

COPY datos/ejemplos/ml/ /opt/sandbox/ejemplos/ml/
RUN find /opt/sandbox/ejemplos/ml -type f -exec sed -i 's/\r$//' {} +

# sandbox_ml: el apoyo del estudio de ML (ml/sandbox_ml en el repo): catalogo
# de modelos con sus hiperparametros, recetas, el codigo que generan, perfil
# de datos y registro de experimentos en /hadoop/ml/experimentos. Lo usan los
# scripts que arma la pantalla de ML de la full, y desde JupyterLab:
# "from sandbox_ml import receta, codigo, estudio". Python puro, ~150 KB.
# Tambien lee cualquier formato de HDFS (fuentes), perfila con Spark a escala
# (perfil_spark) y arma la receta de limpieza columna por columna (limpieza,
# con el paso Limpiar del Pipeline en transformadores_spark).
COPY ml/sandbox_ml/ /opt/sandbox/ml/sandbox_ml/
RUN find /opt/sandbox/ml -name '*.py' -exec sed -i 's/\r$//' {} + \
 && python3 -c "import sandbox_ml.catalogo, sandbox_ml.receta, sandbox_ml.codigo, sandbox_ml.estudio, sandbox_ml.perfil, sandbox_ml.fuentes, sandbox_ml.limpieza, sandbox_ml.perfil_spark, sandbox_ml.transformadores_spark"

# spark-avro: Spark lee y escribe Avro (spark.read.format("avro")) con este
# modulo, que no viene en el paquete de Spark. 200 KB, de Maven Central; entra
# en spark-libs.jar (lo que los trabajos de YARN bajan de HDFS) al arrancar.
ARG SPARK_VERSION
RUN curl -fsSL --retry 3 "https://repo1.maven.org/maven2/org/apache/spark/spark-avro_2.12/${SPARK_VERSION}/spark-avro_2.12-${SPARK_VERSION}.jar" \
      -o "/opt/spark/jars/spark-avro_2.12-${SPARK_VERSION}.jar"

EXPOSE 8888

# ===========================================================================
# Version "full" (franki678/bigdata-sandbox:full): ml + el servidor de la
# interfaz web en :8080 (server/). El contenedor arranca solo el servidor; el
# cluster se prende desde la interfaz («Iniciar»), con el mismo entrypoint.sh
# de las otras versiones. Con -e AUTOSTART=1 arranca solo, con las variables
# de siempre (DATANODES, SERVICIOS...).
# ===========================================================================
# La interfaz (ui/) se compila en una etapa con Node, en el procesador de la
# maquina que buildea (el resultado es HTML/JS/CSS, igual en amd64 y ARM64).
# A la imagen final solo pasa ui/dist: no lleva Node.
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS interfaz
WORKDIR /ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY ui/ ./
RUN npm run build

FROM ml AS full

# Starlette + uvicorn: todo Python puro (el mismo wheel en amd64 y ARM64).
# Resuelven junto con JupyterLab sin cambiar ninguna version de ml.
COPY server/requirements.txt /opt/sandbox/server/requirements.txt
RUN pip install --no-cache-dir --break-system-packages -r /opt/sandbox/server/requirements.txt

COPY server/sandbox_server/ /opt/sandbox/server/sandbox_server/
RUN find /opt/sandbox/server -name '*.py' -exec sed -i 's/\r$//' {} + \
 && python3 -c "import sys; sys.path.insert(0, '/opt/sandbox/server'); import sandbox_server.app"

# UI_DIR: la interfaz compilada (ui/dist), que el servidor sirve en :8080.
# Si no esta, el servidor anda igual (la API en /api) y en / avisa que falta.
COPY --from=interfaz /ui/dist/ /opt/sandbox/ui/
ENV SANDBOX_VERSION=full \
    PYTHONPATH=/opt/sandbox/server:/opt/sandbox/ml:/opt/spark/python:/opt/spark/python/lib/py4j-0.10.9.7-src.zip \
    UI_DIR=/opt/sandbox/ui \
    AUTOSTART=0
EXPOSE 8080

# docker stop: tini le pasa el SIGTERM al servidor, que apaga el cluster en
# orden (apagar_en_orden de sandbox/lib.sh) antes de salir. Conviene darle
# 20 s (docker stop -t 20, o stop_grace_period: 20s en el compose).
ENTRYPOINT ["/usr/bin/tini", "--", "python3", "-m", "sandbox_server"]

# ===========================================================================
# Version "empresa" (franki678/bigdata-sandbox:empresa): la full, mas el
# cluster del aula. Sin ROL (o ROL=solo) es igual a la full. Con ROL=maestro
# el contenedor es el nodo del profe (NameNode, ResourceManager, Hive, Spark
# History y un DataNode que guarda una copia de todo); con ROL=trabajador es
# una PC del aula (un DataNode y un NodeManager) que se suma al maestro.
# ===========================================================================
# wireguard-go: WireGuard en espacio de usuario, por si el kernel de Docker no
# trae el modulo (Docker Desktop lo trae: la sonda lo encontro en 11 de 11
# PCs). Es Go puro: se compila una vez, en el procesador de la maquina que
# buildea, para la arquitectura de la imagen (sin C, asi no depende de libc).
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS wireguard-go
ARG TARGETARCH
ARG WIREGUARD_GO_VERSION
RUN CGO_ENABLED=0 GOOS=linux GOARCH=$TARGETARCH \
      go install -trimpath -ldflags='-s -w' "golang.zx2c4.com/wireguard@${WIREGUARD_GO_VERSION}" \
 && find /go/bin -name wireguard -type f -exec mv {} /usr/local/bin/wireguard-go \; \
 && test -x /usr/local/bin/wireguard-go

FROM full AS empresa
ARG DEBIAN_FRONTEND=noninteractive

# El tunel del aula (RED=wireguard): wg para el hub e ip para la interfaz
RUN apt-get update \
 && apt-get install -y --no-install-recommends wireguard-tools iproute2 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=wireguard-go /usr/local/bin/wireguard-go /usr/local/bin/wireguard-go

COPY empresa/arranque.sh /opt/sandbox/arranque-empresa.sh
COPY empresa/aula/ /opt/sandbox/aula/
RUN find /opt/sandbox/arranque-empresa.sh /opt/sandbox/aula -type f -exec sed -i 's/\r$//' {} + \
 && chmod +x /opt/sandbox/arranque-empresa.sh /opt/sandbox/aula/*.sh
ENV SANDBOX_VERSION=empresa

# DataNode 9866/9867, NodeManager 8041/8031 (RPC entre nodos del aula)
# Con RED=wireguard, en el maestro: UDP 51820 (el hub) y TCP 8099 (inscripcion)
EXPOSE 9864 9866 9867 8031 8041 10020 51820/udp 8099

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/sandbox/arranque-empresa.sh"]

# ===========================================================================
# Version "trabajador" (franki678/bigdata-sandbox:trabajador): la imagen
# chica de las PCs del aula. El reset del laboratorio borra todo cada dia y
# la red es lenta (unos 50 Mbit/s hacia la PC del profe, medido el 27/10): la
# empresa entera (1,6 GB comprimida) tardaria mas de una hora en llegar a 20
# PCs. Esta trae solo lo que corre en una PC: Java 8 (el runtime, sin JDK),
# Hadoop recortado al DataNode y al NodeManager (con lo que necesitan las
# tareas de MapReduce y Tez), Python con numpy para los executors de PySpark
# y el tunel (wireguard-tools y wireguard-go). Spark y Tez le llegan desde
# HDFS (spark.yarn.archive y tez.lib.uris, que sube el maestro).
# ===========================================================================
# Hadoop sin lo que no usan el DataNode ni el NodeManager: los clientes
# empaquetados (client), las herramientas (tools: S3, Azure, distcp...), el
# Timeline Service v2 (con HBase adentro), la interfaz nueva de YARN (ui2),
# los tests, los fuentes y la documentacion de la API (jdiff, sources), los
# routers de HDFS y YARN, y los jars de hdfs/lib que ya estan en common/lib.
FROM --platform=$BUILDPLATFORM hadoop-dist AS hadoop-trabajador
RUN cd /opt/hadoop/share/hadoop \
 && rm -rf client tools yarn/timelineservice yarn/csi yarn/webapps yarn/test yarn/yarn-service-examples \
           */jdiff */sources mapreduce/lib-examples \
 && rm -f */*-tests.jar hdfs/hadoop-hdfs-rbf-*.jar hdfs/hadoop-hdfs-httpfs-*.jar hdfs/hadoop-hdfs-nfs-*.jar \
          common/hadoop-nfs-*.jar common/hadoop-kms-*.jar yarn/hadoop-yarn-server-router-*.jar \
          mapreduce/hadoop-mapreduce-client-nativetask-*.jar mapreduce/hadoop-mapreduce-client-uploader-*.jar \
 && for j in hdfs/lib/*.jar; do if [ -e "common/lib/${j##*/}" ]; then rm "$j"; fi; done \
 && du -sh /opt/hadoop

FROM ubuntu:24.04 AS trabajador
ARG DEBIAN_FRONTEND=noninteractive

ENV SANDBOX_VERSION=trabajador \
    ROL=trabajador \
    JAVA_HOME=/opt/java/openjdk \
    HADOOP_HOME=/opt/hadoop \
    HADOOP_COMMON_HOME=/opt/hadoop \
    HADOOP_MAPRED_HOME=/opt/hadoop \
    HADOOP_CONF_DIR=/opt/hadoop/etc/hadoop \
    YARN_CONF_DIR=/opt/hadoop/etc/hadoop \
    PYSPARK_PYTHON=python3 \
    HDFS_DATANODE_USER=root \
    YARN_NODEMANAGER_USER=root \
    HADOOP_CLIENT_OPTS="-XX:+UseSerialGC -XX:TieredStopAtLevel=1" \
    LANG=C.UTF-8
ENV PATH=/opt/sandbox/bin:$JAVA_HOME/bin:$HADOOP_HOME/bin:$HADOOP_HOME/sbin:$PATH

# tini (PID 1), ps/pgrep, netstat, ip, ping, curl, wg, y Python con numpy
# para los executors de PySpark. El numpy de Ubuntu es la misma version que el
# del maestro (la de conf/requirements-ml.txt: se verifica abajo, porque los
# dos lados se pasan arrays con pickle) y usa el BLAS de referencia en vez del
# openblas de 37 MB de la rueda de pip: lo pesado de MLlib corre en Java.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini procps net-tools iproute2 iputils-ping curl \
      wireguard-tools python3 python3-numpy \
 && rm -rf /var/lib/apt/lists/* /usr/share/doc /usr/share/man /usr/share/locale \
 && find /usr/lib/python3/dist-packages/numpy -depth -type d -name tests -exec rm -rf {} +

COPY --from=eclipse-temurin:8-jre-noble /opt/java/openjdk /opt/java/openjdk
COPY --from=hadoop-trabajador /opt/hadoop /opt/hadoop
COPY --from=wireguard-go /usr/local/bin/wireguard-go /usr/local/bin/wireguard-go
RUN echo "export JAVA_HOME=${JAVA_HOME}" >> ${HADOOP_CONF_DIR}/hadoop-env.sh

COPY conf/core-site.xml        /opt/sandbox/templates/core-site.xml
COPY conf/yarn-site.xml        ${HADOOP_CONF_DIR}/yarn-site.xml
COPY conf/mapred-site.xml      ${HADOOP_CONF_DIR}/mapred-site.xml
COPY sandbox/                  /opt/sandbox/
COPY entrypoint.sh             /opt/entrypoint.sh
COPY empresa/arranque.sh       /opt/sandbox/arranque-empresa.sh
COPY empresa/aula/             /opt/sandbox/aula/
COPY conf/requirements-ml.txt  /tmp/requirements-ml.txt
RUN find /opt/entrypoint.sh /opt/sandbox -type f -exec sed -i 's/\r$//' {} + \
 && for c in ls df du; do \
      printf '#!/bin/sh\nunset BLOCK_SIZE\nexec /usr/bin/%s "$@"\n' "$c" > /opt/sandbox/bin/$c; \
    done \
 && chmod +x /opt/entrypoint.sh /opt/sandbox/bin/* /opt/sandbox/arranque-empresa.sh /opt/sandbox/aula/*.sh \
 && mkdir -p /datos \
 && maestro=$(sed -n 's/^numpy==//Ip' /tmp/requirements-ml.txt) \
 && python3 -c "import numpy; print('numpy', numpy.__version__)" \
 && python3 -c "import numpy, sys; sys.exit(numpy.__version__ != sys.argv[1])" "$maestro" \
 && rm /tmp/requirements-ml.txt \
 && java -version 2>&1 | head -1 && hadoop version | head -1 && wireguard-go --version

# Nada que publicar: la PC solo hace conexiones salientes (por el tunel)
VOLUME ["/hadoop"]
WORKDIR /datos
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/sandbox/arranque-empresa.sh"]

# ===========================================================================
# Sin --target, "docker build ." arma la version base
# ===========================================================================
FROM base
