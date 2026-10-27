# 5. Hive

SQL sobre los archivos de HDFS: Hive le da forma de tabla a archivos que ya
existen y traduce cada consulta a un trabajo distribuido. Es el *data
warehouse* clásico del ecosistema Hadoop.

[← 4. Pig](04-pig.md) · [Teoría](README.md) · Siguiente: [6. Sqoop →](06-sqoop.md)

## Por qué existe

En 2008 Facebook tenía sus datos en Hadoop y analistas que sabían SQL, no
Java. Hive resolvió eso: un lenguaje casi igual a SQL (**HiveQL**) que se
traduce a trabajos sobre el cluster. Con Hive, "ventas por producto" deja de
ser un mapper y un reducer y pasa a ser un `GROUP BY`.

## Conceptos

| Concepto | Qué es |
|---|---|
| **Tabla** | Un esquema (columnas y tipos) más una carpeta de HDFS con archivos. Hive **no** guarda datos propios: lee y escribe archivos |
| **Metastore** | El catálogo: bases, tablas, columnas, tipos, formato y carpeta de cada tabla, particiones. Es una base relacional (acá, Derby) con un servicio Thrift adelante |
| **HiveServer2** | El servidor que recibe el SQL de los clientes (JDBC/ODBC), lo compila y lanza los trabajos |
| **beeline** | Cliente de consola que habla JDBC con HiveServer2 |
| **Schema on read** | El esquema se aplica al **leer**: los archivos quedan como están, y una fila que no encaja da `NULL` en vez de un error al cargar |
| **Tabla externa** | Hive solo anota el esquema y la carpeta. `DROP TABLE` borra el esquema, **no** los archivos |
| **Tabla administrada** (*managed*) | Hive es dueño de los archivos, que van en el *warehouse*. `DROP TABLE` borra el esquema **y** los archivos |
| **Warehouse** | La carpeta de HDFS donde van las tablas administradas: `/user/hive/warehouse` |
| **Partición** | Una subcarpeta por valor de una columna (`.../mes=2026-01/`), para que las consultas que filtran por esa columna lean solo las carpetas que hacen falta |
| **SerDe** | *Serializer/Deserializer*: cómo convertir los bytes de un archivo en filas y columnas (`ROW FORMAT DELIMITED FIELDS TERMINATED BY ','` es el de texto delimitado) |

## Schema on write y schema on read

```text
  base relacional (schema on write)         Hive (schema on read)

  CREATE TABLE ... (tipos)                   archivos en HDFS (ya estaban)
        |                                           |
  INSERT: valida cada fila contra el        CREATE EXTERNAL TABLE ... LOCATION
  esquema; si no encaja, error al cargar    solo anota el esquema en el metastore
        |                                           |
  los datos quedan en el formato            SELECT: lee los archivos y los
  interno de la base                        interpreta con el esquema; lo que no
                                            encaja da NULL
```

- **A favor** de *schema on read*: cargar es instantáneo (no hay carga: los
  archivos ya están) y el mismo archivo se puede leer con varios esquemas, o
  desde Pig y Spark a la vez.
- **En contra**: los errores aparecen tarde, en la consulta, y en silencio
  (`NULL`). Por eso existe `skip.header.line.count`: sin esa propiedad, el
  encabezado `fecha,sucursal,...` sería una fila más, con `cantidad` = `NULL`.

## Cómo funciona por dentro

```text
  beeline -u jdbc:hive2://localhost:10000
       |  SQL por JDBC (Thrift)
       v
  +------------------- HiveServer2 --------------------+
  |  1. parser: HiveQL -> árbol de la consulta          |
  |  2. semántica: ¿existe la tabla? ¿las columnas?  ---+---> Metastore :9083
  |  3. optimizador (Calcite): reordena JOINs, empuja   |     (Derby en
  |     los filtros hacia la lectura, poda columnas y   |      /hadoop/metastore_db)
  |     particiones                                     |
  |  4. plan físico: un DAG de etapas para Tez          |
  +-----------------------------------------------------+
       |  5. lanza el trabajo
       v
  YARN: ApplicationMaster de Tez + contenedores (tipo TEZ en :8088)
       |  6. leen los archivos de la tabla en HDFS, procesan
       v
  resultado: a beeline, a una tabla, o a una carpeta (INSERT OVERWRITE DIRECTORY)
```

Hay consultas que **no lanzan ningún trabajo**: un `SELECT * ... LIMIT 5` o
un `DESCRIBE` los resuelve HiveServer2 leyendo directo el archivo o el
metastore (*fetch task*). Las que agrupan, unen u ordenan sí van a YARN.

### El metastore, compartido

El metastore es la pieza más reutilizada del ecosistema: Spark, Pig (con
HCatalog), Trino, Impala y Presto leen el mismo catálogo. En esta imagen,
Spark se conecta al mismo `thrift://localhost:9083`: por eso una tabla creada
en Hive aparece en Spark y al revés.

Derby, la base que usa acá, es **embebida**: solo un proceso a la vez puede
abrirla. Por eso todos (HiveServer2 y Spark) pasan por el servicio del
metastore en vez de abrir Derby directamente. En producción el metastore usa
MySQL, PostgreSQL u Oracle, que aceptan muchas conexiones.

## El motor de ejecución: Tez

Hive empezó generando trabajos **MapReduce**. Una consulta con un JOIN, un
GROUP BY y un ORDER BY eran tres trabajos encadenados, cada uno escribiendo su
resultado en HDFS para que lo lea el siguiente. **Tez** ejecuta la consulta
entera como **un solo trabajo**, organizado como un grafo de etapas (*DAG*):

```text
  MapReduce (3 trabajos)                       Tez (1 trabajo, un DAG)

  [map lee ventas]   [map lee productos]       [lee ventas]  [lee productos]
         \               /                           \          /
       reduce: JOIN                                  [JOIN]
            |                                           |
       escribe en HDFS  <- disco + réplicas        [GROUP BY]   <- los datos pasan
            |                                           |          de etapa a etapa
  map lee -> reduce: GROUP BY                       [ORDER BY]     sin ir a HDFS
            |                                           |
       escribe en HDFS                             resultado
            |
  map lee -> reduce: ORDER BY -> resultado
```

Lo que gana Tez:

- Sin escrituras intermedias en HDFS (ni sus réplicas).
- Etapas que no tienen que ser "map" o "reduce": un reduce puede alimentar a
  otro reduce directamente.
- Reusa contenedores entre tareas y entre consultas de una misma sesión, en
  vez de lanzar una JVM nueva para cada una.

Es la misma idea que lleva Spark más lejos, con los datos en memoria.

## Tablas externas y administradas

| | Externa | Administrada |
|---|---|---|
| Cómo se crea | `CREATE EXTERNAL TABLE ... LOCATION '/carpeta'` | `CREATE TABLE ...` o `CREATE TABLE ... AS SELECT` |
| Dónde están los archivos | Donde ya estaban | En el warehouse, `/user/hive/warehouse/<tabla>` |
| `DROP TABLE` | Borra solo el esquema | Borra esquema y archivos |
| Para qué | Datos que comparten otras herramientas o que llegan de afuera (un data lake) | Resultados que produce y maneja solo Hive |

En la guía, `ventas` es externa porque sus archivos los usan también
MapReduce, Pig y Spark; `ventas_por_producto` es administrada porque es un
resultado de Hive.

### Particiones y formatos

- **Particiones**: una tabla `PARTITIONED BY (mes STRING)` guarda cada mes en
  su subcarpeta. `WHERE mes = '2026-03'` lee solo esa carpeta (*partition
  pruning*): con 6 meses, se lee un sexto. El costo es que demasiadas
  particiones chicas reproducen el problema de los archivos chicos de HDFS.
- **Formatos**: la guía usa texto (CSV), que es fácil de mirar pero lento.
  En producción se usan formatos **columnares** como ORC o Parquet: guardan
  cada columna junta y comprimida, con estadísticas por bloque, así una
  consulta que usa 2 de 20 columnas lee solo esas 2 y saltea los bloques que
  no pueden cumplir el filtro.
- Desde Hive 3 hay tablas **transaccionales** (ACID, con `UPDATE` y `DELETE`)
  sobre ORC. Las tablas de las guías son de texto.

## Ventajas y limitaciones

**Ventajas**

- SQL: lo conoce cualquier analista, y lo hablan las herramientas de BI por
  JDBC/ODBC.
- Schema on read: sin carga, sobre los mismos archivos del data lake.
- El metastore como catálogo común para todo el ecosistema.
- Con Tez, ORC y particiones, consultas batch sobre terabytes en tiempos
  razonables.

**Limitaciones**

- **Latencia**: cada consulta que agrupa lanza un trabajo en YARN (segundos,
  como mínimo). No es para consultas interactivas de un usuario ni para
  sistemas transaccionales.
- Los errores de formato aparecen como `NULL`, en silencio.
- Muchas piezas: metastore, su base, HiveServer2, Tez, YARN y HDFS.
- Para SQL interactivo sobre el mismo data lake hoy se usan Trino/Presto,
  Impala o Spark SQL, y en la nube, los warehouses administrados (BigQuery,
  Snowflake, Redshift).

## En la guía 6 lo ves cuando...

- **[Ventas por producto en SQL](../../06-hive.md#ventas-por-producto-en-sql)**:
  `CREATE EXTERNAL TABLE ... LOCATION '/user/root/ventas'` no mueve nada. Es
  *schema on read* sobre los mismos archivos de las guías 3 a 5, con
  `skip.header.line.count` para el encabezado.
- **[La consola de beeline](../../06-hive.md#la-consola-de-beeline)**: el
  `LIMIT 5` responde al instante y el `GROUP BY` aparece en
  http://localhost:8088 como `TEZ`.
- **[Una tabla administrada por Hive](../../06-hive.md#una-tabla-administrada-por-hive)**:
  `CREATE TABLE ... AS SELECT` deja sus archivos en `/user/hive/warehouse`.
- **[De Hive a Spark](../../06-hive.md#de-hive-a-spark)** y la
  [guía 8](../../08-spark.md#sql-sobre-las-tablas-de-hive): las mismas tablas
  desde Spark, por el metastore compartido.
- **[Guía 7](../../07-mysql-sqoop.md#3-procesar-en-hive-un-join)**: un JOIN
  entre dos tablas externas sobre lo que trajo Sqoop.

Para repasar: [evaluación de Hive](../evaluacion/05-hive.md). Comandos y
configuración: [referencia de Hive](../referencia.md#hive) y de
[Tez](../referencia.md#tez).
