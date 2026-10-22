# BigData sandbox: HDFS + YARN + MapReduce + Pig + Hive (sobre Tez) + Spark +
# Sqoop (con una base MySQL de ejemplo), todo en UNA imagen / UN contenedor, pero con cada daemon como proceso
# separado y su UI web navegable. La arquitectura de HDFS (DataNodes,
# NameNodes, replicacion, tamano de bloque) se elige en el docker run.
# Buildea desde los tarballs oficiales de Apache sobre base Java -> corre en
# amd64 y ARM64.

ARG HADOOP_VERSION=3.3.6
ARG HIVE_VERSION=4.0.0
ARG TEZ_VERSION=0.10.3
ARG SPARK_VERSION=3.5.9
ARG ZOOKEEPER_VERSION=3.8.7
ARG PIG_VERSION=0.18.0
ARG SQOOP_VERSION=1.4.7

# ===========================================================================
# Etapa 1: bajar y desarmar los paquetes de Apache.
# Son programas Java, iguales para amd64 y ARM64. Esta etapa corre en el
# procesador de la maquina que buildea ($BUILDPLATFORM), asi al armar la
# imagen para las dos arquitecturas se bajan una sola vez y no se desarman
# emulando el otro procesador (lo que mas tarda).
# ===========================================================================
FROM --platform=$BUILDPLATFORM eclipse-temurin:8-jre-noble AS descargas
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
# tiene las ultimas), del archivo historico (lento pero tiene todas).
RUN printf '#!/bin/sh\ncurl -fSL "https://dlcdn.apache.org/$1" -o "$2" || curl -fSL "https://archive.apache.org/dist/$1" -o "$2"\n' \
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
RUN curl -fSL "https://archive.apache.org/dist/sqoop/${SQOOP_VERSION}/sqoop-${SQOOP_VERSION}.bin__hadoop-2.6.0.tar.gz" -o /tmp/sqoop.tgz \
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
# Etapa 2: la imagen final (una por arquitectura), sobre Ubuntu 24.04 (noble)
# JDK y no solo el runtime (JRE): Sqoop genera y compila una clase Java por
# cada tabla que copia.
# ===========================================================================
FROM eclipse-temurin:8-jdk-noble
ARG DEBIAN_FRONTEND=noninteractive

ENV HADOOP_HOME=/opt/hadoop \
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
COPY sandbox/                  /opt/sandbox/
COPY entrypoint.sh             /opt/entrypoint.sh
# Ejemplos (datasets y scripts): se copian a /datos/ejemplos al arrancar, para
# quien baja la imagen ya armada y no tiene el repo
COPY datos/ejemplos/           /opt/sandbox/ejemplos/
# sed: si el repo se clono en Windows con saltos CRLF, los scripts no arrancan
RUN find /opt/entrypoint.sh /opt/sandbox/lib.sh /opt/sandbox/bin /opt/sandbox/ejemplos -type f \
      -exec sed -i 's/\r$//' {} + \
 && chmod +x /opt/entrypoint.sh /opt/sandbox/bin/* && mkdir -p /datos

# HDFS: NameNodes 9870-9872, Secondary 9868, DataNodes 9901-9909, RPC 9000
#       JournalNodes 8480-8482 (solo HA)
# YARN: RM 8088, NM 8042 | MR JobHistory 19888
# Hive: Metastore 9083, HiveServer2 JDBC 10000 y UI 10002 | Spark: 18080, 4040
# MySQL (base de ejemplo para Sqoop): 3306
EXPOSE 9870-9872 9868 9901-9909 9000 8480-8482 8088 8042 19888 9083 10000 10002 18080 4040 3306

# /hadoop: datos de HDFS + metastore + base MySQL (persisten entre reinicios)
# /datos:  carpeta para compartir archivos con la compu (CSV, scripts, etc.)
VOLUME ["/hadoop"]
WORKDIR /datos

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/entrypoint.sh"]
