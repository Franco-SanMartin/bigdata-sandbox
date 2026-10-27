# 6. Sqoop y las bases relacionales

Cómo entran al cluster los datos de los sistemas de la empresa (ventas,
facturación, clientes), que viven en bases relacionales, y cómo vuelven los
resultados. Sqoop es la herramienta clásica de Hadoop para ese viaje.

[← 5. Hive](05-hive.md) · [Teoría](README.md) · Siguiente: [7. Spark →](07-spark.md)

## El problema: OLTP y OLAP

Las bases de los sistemas de gestión (MySQL, PostgreSQL, Oracle, SQL Server)
están pensadas para **OLTP** (*online transaction processing*): muchas
operaciones chicas por segundo (registrar una venta, consultar un cliente),
con transacciones y consistencia fuerte. El análisis (**OLAP**: ventas del
semestre por categoría, comparar sucursales) recorre millones de filas, y
hacerlo sobre la base de producción la frena para todos.

La solución de siempre es **copiar** los datos a otro lugar pensado para
analizar (un warehouse o un data lake) y analizarlos ahí. Ese proceso es el
**ETL** (*extract, transform, load*) o, en Big Data, más bien **ELT**: se
cargan crudos y se transforman en el cluster.

```text
  sistema de ventas            data lake (Hadoop)                 sistema de ventas
  +--------------+  import   +----------------------------+  export  +--------------------+
  | MySQL tienda | --------> | HDFS: /user/root/tienda/   | -------> | resumen_categoria  |
  |  ventas      |  (Sqoop)  | Hive: JOIN, GROUP BY       |  (Sqoop) | (para el sistema   |
  |  productos   |           | resultado en HDFS          |          |  o un tablero)     |
  +--------------+           +----------------------------+          +--------------------+
        extraer                   cargar y transformar                   devolver
```

Es exactamente el recorrido de la guía 7.

## Conceptos

| Concepto | Qué es |
|---|---|
| **JDBC** | La interfaz estándar de Java para hablar con bases relacionales. Cada base tiene su *driver* (acá, `mysql-connector-java` 5.1.49) y se nombra con una URL: `jdbc:mysql://localhost/tienda` |
| **import** | Copiar una tabla (o una consulta) de la base a archivos en HDFS |
| **export** | Copiar archivos de HDFS a una tabla que ya existe en la base |
| **Columna de partición** (*split-by*) | La columna con la que Sqoop divide la tabla en rangos, uno por mapper. De fábrica, la clave primaria |
| **Trabajo solo de mappers** | Cada import o export es un trabajo MapReduce **sin reducers**: no hay nada que agrupar, solo copiar en paralelo |
| **Clase generada** | Para leer y escribir las filas, Sqoop genera y compila una clase Java con un campo por columna (el `ventas.java` que aparece en la carpeta) |
| **Import incremental** | Traer solo lo nuevo desde la última vez (`--incremental append --check-column id --last-value N`, o por fecha de modificación con `lastmodified`) |

## Cómo funciona por dentro: import

Con `--table ventas -m 4`:

```text
  1. Sqoop se conecta por JDBC y lee la estructura de la tabla
     (columnas, tipos, clave primaria: id)
  2. genera y compila ventas.java (la clase de una fila)
  3. pregunta los límites de la columna de partición:
        SELECT MIN(id), MAX(id) FROM ventas      ->  1 .. 200000
  4. divide el rango en 4 partes parejas y lanza un trabajo MapReduce
     con 4 mappers y 0 reducers:

     mapper 1: SELECT ... FROM ventas WHERE id >= 1      AND id < 50001   -> part-m-00000
     mapper 2: SELECT ... FROM ventas WHERE id >= 50001  AND id < 100001  -> part-m-00001
     mapper 3: SELECT ... FROM ventas WHERE id >= 100001 AND id < 150001  -> part-m-00002
     mapper 4: SELECT ... FROM ventas WHERE id >= 150001 AND id <= 200000 -> part-m-00003

  5. cada mapper escribe sus filas como texto separado por comas en HDFS
```

(Los límites exactos de cada rango los calcula Sqoop; la idea es esa.)

Consecuencias de este diseño:

- El paralelismo es real: 4 conexiones a la base leyendo a la vez. Pero
  **la base es el límite**: más mappers que lo que la base aguanta solo la
  satura. En producción se elige `-m` según la base, no según el cluster.
- Si la columna de partición está **despareja** (por ejemplo, ids con un
  hueco enorme), los rangos parejos dan mappers con mucho trabajo y otros
  vacíos.
- Sin clave primaria hay que decir por dónde partir (`--split-by`) o usar un
  solo mapper (`-m 1`).
- Cada mapper hace su propia consulta, en su propia transacción: si la tabla
  cambia durante el import, el resultado no es una foto exacta de un mismo
  instante.

Con `--query`, la consulta tiene que tener `WHERE $CONDITIONS`: es el lugar
donde Sqoop pone el rango de cada mapper.

## Cómo funciona por dentro: export

```text
  archivos en HDFS (/user/root/resultados/hive_por_categoria)
        |  cada mapper lee una parte de los archivos
        v
  mapper: arma INSERT INTO resumen_categoria VALUES (...), (...) ...
        |  en tandas, cada una con su commit
        v
  tabla en MySQL (tiene que existir, con columnas compatibles)
```

- La tabla destino **tiene que existir**: Sqoop no la crea.
- No es atómico: si el trabajo falla a la mitad, quedan cargadas algunas
  tandas. Para eso existe `--staging-table` (cargar en una tabla auxiliar y
  pasar todo junto al final).
- Si se repite sobre una tabla con clave primaria sin vaciarla, falla con
  `Duplicate entry`. Por eso la guía hace un `TRUNCATE` antes.

## Ventajas y limitaciones

**Ventajas**

- Una línea de comando para copiar una tabla entera, en paralelo, con
  tolerancia a fallas (es un trabajo de YARN).
- Funciona con cualquier base que tenga driver JDBC.
- Ida y vuelta: import y export.
- Import incremental para no traer todo cada vez.

**Limitaciones**

- **Batch**: copia el estado de la tabla en un momento. Lo que cambie
  después llega en la próxima corrida.
- Los incrementales ven filas nuevas o modificadas, pero **no las borradas**.
- Carga sobre la base de producción mientras corre.
- Integración vieja con Hive: `--hive-import` de Sqoop 1.4.7 es anterior a
  Hive 4 y no está garantizado que funcione. En la guía se importa a una
  carpeta y se crea encima una tabla externa.
- **El proyecto está retirado**: pasó al *Attic* de Apache en 2021, y la
  1.4.7 es su última versión.

## Lo que se usa hoy

- **Spark leyendo por JDBC** (`spark.read.jdbc(...)`, con particiones por
  columna igual que Sqoop): la misma idea, sin MapReduce.
- **Herramientas de ingesta**: Apache NiFi, Airbyte, Fivetran, servicios de
  la nube como AWS DMS o Azure Data Factory.
- **CDC** (*change data capture*): en vez de consultar la tabla, se lee el
  registro de cambios de la base (el *binlog* de MySQL) y se manda cada
  INSERT, UPDATE y DELETE apenas pasa, normalmente a Kafka (Debezium). Ve los
  borrados, no carga la base con consultas grandes y llega en segundos, no al
  día siguiente.

El problema que resuelve Sqoop (llevar los datos de los sistemas al lugar de
análisis) es el mismo. Cambió la herramienta.

## En la guía 7 lo ves cuando...

- **[La base MySQL `tienda`](../../07-mysql-sqoop.md#la-base-mysql-tienda)**:
  una base OLTP común, aparte del cluster, con las mismas 200.000 ventas y un
  `id` como clave primaria.
- **[1. Mirar la base desde Sqoop](../../07-mysql-sqoop.md#1-mirar-la-base-desde-sqoop)**:
  `list-databases`, `list-tables` y `eval` hablan JDBC directo, sin Hadoop.
- **[2. Importar](../../07-mysql-sqoop.md#2-importar-mysql--hdfs)**: con
  `-m 1` un archivo; con `-m 4`, cuatro `part-m-*` (cuatro rangos de `id`), en
  http://localhost:8088 un trabajo sin reducers, y el `ventas.java` en la
  carpeta.
- **[3. Procesar en Hive](../../07-mysql-sqoop.md#3-procesar-en-hive-un-join)**:
  la transformación ocurre en el cluster, no en la base (ELT).
- **[4. Exportar](../../07-mysql-sqoop.md#4-exportar-hdfs--mysql)**: la tabla
  destino ya existía, y el `TRUNCATE` previo evita el `Duplicate entry`.

Para repasar: [evaluación de Sqoop](../evaluacion/06-sqoop.md). Comandos:
referencia de [Sqoop](../referencia.md#sqoop) y de
[MySQL](../referencia.md#mysql-mariadb).
