# BigData sandbox: HDFS + YARN + MapReduce + Hive (sobre Tez) + Spark, todo en
# UNA imagen / UN contenedor, pero con cada daemon como proceso separado y su
# UI web navegable. La arquitectura de HDFS (DataNodes, NameNodes, replicacion,
# tamano de bloque) se elige en el docker run. Buildea desde los tarballs
# oficiales de Apache sobre base Java -> corre en amd64 y ARM64.
# JRE y no JDK: para correr Hadoop/Hive/Spark alcanza el runtime de Java
# (no se compila nada adentro) y la imagen pesa menos.
FROM eclipse-temurin:8-jre-focal

ARG HADOOP_VERSION=3.3.6
ARG HIVE_VERSION=4.0.0
ARG TEZ_VERSION=0.10.3
ARG SPARK_VERSION=3.5.9
ARG ZOOKEEPER_VERSION=3.8.7

ENV HADOOP_HOME=/opt/hadoop \
    HIVE_HOME=/opt/hive \
    TEZ_HOME=/opt/tez \
    SPARK_HOME=/opt/spark \
    ZK_HOME=/opt/zookeeper \
    HADOOP_CONF_DIR=/opt/hadoop/etc/hadoop \
    YARN_CONF_DIR=/opt/hadoop/etc/hadoop \
    HIVE_CONF_DIR=/opt/hive/conf \
    PYSPARK_PYTHON=python3 \
    HDFS_NAMENODE_USER=root \
    HDFS_DATANODE_USER=root \
    HDFS_SECONDARYNAMENODE_USER=root \
    HDFS_JOURNALNODE_USER=root \
    HDFS_ZKFC_USER=root \
    YARN_RESOURCEMANAGER_USER=root \
    YARN_NODEMANAGER_USER=root \
    HADOOP_CLIENT_OPTS="-XX:+UseSerialGC -XX:TieredStopAtLevel=1"
# HADOOP_CLIENT_OPTS: los comandos (hdfs dfs, hive, beeline...) arrancan una
# JVM nueva cada vez; con estas opciones arrancan mas rapido y ocupan menos.
# Spark al final del PATH: trae su propio 'beeline' y tiene que ganar el de Hive
ENV PATH=/opt/sandbox/bin:$HADOOP_HOME/bin:$HADOOP_HOME/sbin:$HIVE_HOME/bin:$ZK_HOME/bin:$PATH:$SPARK_HOME/bin

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl procps net-tools less python3 \
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
 && mv /opt/hadoop-${HADOOP_VERSION} ${HADOOP_HOME} \
 && rm /tmp/hadoop.tgz \
 && rm -rf ${HADOOP_HOME}/share/doc ${HADOOP_HOME}/lib/native/examples \
 && rm -f ${HADOOP_HOME}/share/hadoop/tools/lib/aws-java-sdk-bundle-*.jar \
          ${HADOOP_HOME}/lib/native/*.a ${HADOOP_HOME}/lib/native/libhdfspp* \
          ${HADOOP_HOME}/share/hadoop/yarn/hadoop-yarn-applications-catalog-webapp-*.war \
          ${HADOOP_HOME}/share/hadoop/client/hadoop-client-minicluster-*.jar

# --- Hive ---
# Sin el driver JDBC suelto (es para clientes de afuera), sin los conectores a
# Druid y Kudu (otros sistemas, que aca no hay) y sin un parquet de ejemplo
# de 33 MB. Hive 4 trae un guava viejo que choca con el de Hadoop: alineamos.
RUN apache-dl "hive/hive-${HIVE_VERSION}/apache-hive-${HIVE_VERSION}-bin.tar.gz" /tmp/hive.tgz \
 && tar -xzf /tmp/hive.tgz -C /opt \
 && mv /opt/apache-hive-${HIVE_VERSION}-bin ${HIVE_HOME} \
 && rm /tmp/hive.tgz \
 && rm -rf ${HIVE_HOME}/jdbc \
 && rm -f ${HIVE_HOME}/lib/hive-druid-handler-*.jar ${HIVE_HOME}/lib/hive-kudu-handler-*.jar \
          ${HIVE_HOME}/lib/kudu-client-*.jar ${HIVE_HOME}/examples/files/web_sales.parquet \
          ${HIVE_HOME}/lib/guava-*.jar \
 && cp ${HADOOP_HOME}/share/hadoop/common/lib/guava-*.jar ${HIVE_HOME}/lib/

# --- Tez (motor de ejecucion de Hive 4) ---
RUN apache-dl "tez/${TEZ_VERSION}/apache-tez-${TEZ_VERSION}-bin.tar.gz" /tmp/tez.tgz \
 && tar -xzf /tmp/tez.tgz -C /opt \
 && mv /opt/apache-tez-${TEZ_VERSION}-bin ${TEZ_HOME} \
 && rm /tmp/tez.tgz

# --- Spark (build con soporte Hive, para leer las tablas del metastore) ---
# Sin R, Kubernetes ni el "shuffle service" externo para YARN (74 MB, aca no
# se usa: cada executor sirve su propio shuffle).
RUN apache-dl "spark/spark-${SPARK_VERSION}/spark-${SPARK_VERSION}-bin-hadoop3.tgz" /tmp/spark.tgz \
 && tar -xzf /tmp/spark.tgz -C /opt \
 && mv /opt/spark-${SPARK_VERSION}-bin-hadoop3 ${SPARK_HOME} \
 && rm /tmp/spark.tgz \
 && rm -rf ${SPARK_HOME}/R ${SPARK_HOME}/kubernetes ${SPARK_HOME}/yarn

# --- ZooKeeper (solo arranca con NAMENODES >= 2: elige el NameNode activo) ---
RUN apache-dl "zookeeper/zookeeper-${ZOOKEEPER_VERSION}/apache-zookeeper-${ZOOKEEPER_VERSION}-bin.tar.gz" /tmp/zk.tgz \
 && tar -xzf /tmp/zk.tgz -C /opt \
 && mv /opt/apache-zookeeper-${ZOOKEEPER_VERSION}-bin ${ZK_HOME} \
 && rm /tmp/zk.tgz \
 && rm -rf ${ZK_HOME}/docs

# tini como proceso 1: recoge los procesos que mueren (ej. 'datanode stop').
# Sin el, quedan zombies que Hadoop sigue viendo como vivos.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

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
COPY sandbox/                  /opt/sandbox/
COPY entrypoint.sh             /opt/entrypoint.sh
# Archivos de ejemplo: se copian a /datos al arrancar, para quien baja la
# imagen ya armada y no tiene el repo
COPY datos/ventas.csv datos/texto.txt /opt/sandbox/ejemplos/
# sed: si el repo se clono en Windows con saltos CRLF, los scripts no arrancan
RUN sed -i 's/\r$//' /opt/entrypoint.sh /opt/sandbox/lib.sh /opt/sandbox/bin/* \
 && chmod +x /opt/entrypoint.sh /opt/sandbox/bin/* && mkdir -p /datos

# HDFS: NameNodes 9870-9872, Secondary 9868, DataNodes 9901-9909, RPC 9000
#       JournalNodes 8480-8482 (solo HA)
# YARN: RM 8088, NM 8042 | MR JobHistory 19888
# Hive: Metastore 9083, HiveServer2 JDBC 10000 y UI 10002 | Spark: 18080, 4040
EXPOSE 9870-9872 9868 9901-9909 9000 8480-8482 8088 8042 19888 9083 10000 10002 18080 4040

# /hadoop: datos de HDFS + metastore (persisten entre reinicios)
# /datos:  carpeta para compartir archivos con la compu (CSV, scripts, etc.)
VOLUME ["/hadoop"]
WORKDIR /datos

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/entrypoint.sh"]
