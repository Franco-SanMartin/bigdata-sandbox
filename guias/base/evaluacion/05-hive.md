# Evaluación 5. Hive

[← 4. Pig](04-pig.md) · [Evaluación](README.md) · Teoría: [Hive](../teoria/05-hive.md) · Guía: [6. Hive](../../06-hive.md) · Siguiente: [6. Sqoop →](06-sqoop.md)

## Opción múltiple

**1.** ¿Qué guarda el **metastore** de Hive?

- a) Los datos de las tablas.
- b) El esquema de cada tabla: columnas, tipos, formato y la carpeta de HDFS
  donde están sus archivos.
- c) Los resultados de las consultas.
- d) Los logs de Tez.

<details><summary>Respuesta</summary>

**b)** Los datos son archivos de HDFS; el metastore es el catálogo que dice
cómo leerlos. En la imagen es una base Derby (con `ROL=solo`), y Spark usa el
mismo.

- a) Los datos están en HDFS (`/user/root/ventas`, `/user/hive/warehouse`).
- c) Los resultados se muestran o se guardan en HDFS.
- d) Los logs están en YARN.

</details>

**2.** `ventas.hql` crea la tabla con `CREATE EXTERNAL TABLE ... LOCATION
'/user/root/ventas'`. ¿Qué pasa con los archivos si después se hace `DROP
TABLE ventas`?

- a) Se borran.
- b) Quedan: Hive solo borra el esquema del metastore.
- c) Se mueven al warehouse.
- d) Se vacían pero queda la carpeta.

<details><summary>Respuesta</summary>

**b)** Una tabla externa es solo una "vista" con esquema sobre archivos que
son de otro (los leen también Pig y Spark).

- a) Eso pasa con una tabla administrada (`CREATE TABLE` sin `EXTERNAL`).
- c) y d) Hive no toca los archivos de una tabla externa.

</details>

**3.** ¿Cuándo valida Hive que los datos respeten el esquema?

- a) Al cargar los archivos, rechazando las filas malas.
- b) Al leerlos (*schema on read*): un valor que no se puede convertir al
  tipo de la columna aparece como `NULL`.
- c) Nunca.
- d) Con un `CHECK` en cada columna.

<details><summary>Respuesta</summary>

**b)** Por eso `CREATE EXTERNAL TABLE` es instantáneo aunque los archivos sean
enormes: no lee nada.

- a) Eso es *schema on write*, el de las bases relacionales.
- c) Valida, pero tarde, y sin error: con `NULL`.
- d) Hive no aplica restricciones `CHECK` sobre archivos.

</details>

**4.** ¿Para qué está `TBLPROPERTIES ('skip.header.line.count' = '1')`?

- a) Para saltear la primera fila de cada archivo, el encabezado del CSV.
- b) Para leer solo una fila.
- c) Para que la tabla tenga una columna menos.
- d) Para contar las filas.

<details><summary>Respuesta</summary>

**a)** Sin eso, `COUNT(*)` daría 200001 y la fila `fecha,sucursal,...`
tendría `NULL` en `cantidad` y `precio`.

- b), c) y d) No hace nada de eso.

</details>

**5.** ¿Con qué motor ejecuta Hive las consultas en la imagen?

- a) MapReduce.
- b) Tez: arma la consulta como un grafo de etapas y la corre en YARN, sin
  escribir en HDFS entre etapas.
- c) Spark.
- d) Ninguno: Hive lee los archivos él solo.

<details><summary>Respuesta</summary>

**b)** En http://localhost:8088 las consultas aparecen como `TEZ`.

- a) MapReduce fue el motor original de Hive; en Hive 4 está desaconsejado y
  la imagen usa Tez.
- c) Spark tiene su propio SQL, que lee las tablas de Hive, pero no es el
  motor de Hive.
- d) Solo las consultas simples (un `LIMIT` sin agrupar) Hive las responde
  leyendo directamente.

</details>

**6.** ¿Por qué `SUM(CAST(cantidad AS BIGINT) * precio)` y no `SUM(cantidad *
precio)`?

- a) Porque Hive no multiplica.
- b) Para hacer la cuenta en 64 bits: la suma de 200.000 importes no entra en
  un `INT` (que llega a poco más de 2.100 millones).
- c) Para redondear.
- d) Para que el resultado sea texto.

<details><summary>Respuesta</summary>

**b)** Es lo que explica la guía 6. Pig hace lo mismo con `(long)`.

- a) Multiplica, pero en el tipo de los operandos.
- c) `BIGINT` es un entero.
- d) Eso sería `STRING`.

</details>

**7.** ¿Qué es **beeline**?

- a) El servidor de Hive.
- b) Un cliente de consola que se conecta a HiveServer2 por JDBC
  (`jdbc:hive2://localhost:10000`).
- c) El metastore.
- d) Una herramienta para importar CSV.

<details><summary>Respuesta</summary>

**b)** El servidor es HiveServer2 (puerto 10000, web en 10002). Cualquier
cliente JDBC (DBeaver, por ejemplo) se conecta igual.

- a) El servidor es HiveServer2.
- c) El metastore está en el puerto 9083.
- d) Para eso está Sqoop (desde una base) o `hdfs dfs -put`.

</details>

**8.** `CREATE TABLE ventas_por_producto AS SELECT ...` (sin `EXTERNAL`).
¿Dónde quedan sus archivos?

- a) En `/user/root/ventas`.
- b) En el warehouse de Hive, `/user/hive/warehouse/ventas_por_producto`.
- c) En el disco del contenedor, fuera de HDFS.
- d) En el metastore.

<details><summary>Respuesta</summary>

**b)** Es lo que muestra `hdfs dfs -ls -R /user/hive/warehouse` en la guía.
Esos archivos sí son de Hive: `DROP TABLE` los borra.

- a) Esa es la carpeta de la tabla externa `ventas`.
- c) Hive escribe en HDFS.
- d) El metastore tiene el esquema, no los datos.

</details>

**9.** ¿Qué es una **partición** en Hive?

- a) Un bloque de HDFS.
- b) Una subcarpeta por valor de una columna (por ejemplo, `mes=2026-01/`):
  una consulta con `WHERE` sobre esa columna lee solo las carpetas que
  necesita.
- c) Un reducer.
- d) Una copia de la tabla.

<details><summary>Respuesta</summary>

**b)** Es la forma principal de no leer todo. Con demasiadas particiones
chicas vuelve el problema de los archivos chicos.

- a) Los bloques son de HDFS, por debajo de las tablas.
- c) Los reducers son de la ejecución.
- d) No copia nada.

</details>

**10.** ¿Para qué **no** conviene Hive?

- a) Para resumir millones de filas.
- b) Para buscar o modificar una fila por vez con respuesta en milisegundos,
  como una base de una aplicación.
- c) Para consultas con `JOIN`.
- d) Para analistas que saben SQL.

<details><summary>Respuesta</summary>

**b)** Cada consulta arranca trabajos en YARN y lee archivos enteros: tarda
segundos. Para eso están MySQL o MongoDB.

- a) Es justo para lo que sirve.
- c) Hace JOIN (la guía 7 lo usa).
- d) Ese es su público.

</details>

## Desarrollo

**1.** Explicá la diferencia entre una tabla externa y una administrada. ¿Por
qué las ventas de la guía son una tabla externa?

<details><summary>Respuesta modelo</summary>

- **Externa** (`CREATE EXTERNAL TABLE ... LOCATION`): Hive anota el esquema
  sobre archivos que ya existen. No los mueve ni los copia; `DROP TABLE` borra
  solo el esquema.
- **Administrada** (`CREATE TABLE`, o `CREATE TABLE ... AS SELECT`): Hive
  guarda sus archivos en el warehouse y los maneja; `DROP TABLE` borra
  también los archivos.
- Las ventas son externas porque los archivos de `/user/root/ventas` no son
  de Hive: los leen también MapReduce, Pig y Spark. Si fueran administradas,
  un `DROP TABLE` dejaría a las otras herramientas sin datos.

</details>

**2.** ¿Qué significa *schema on read*? Nombrá una ventaja y una desventaja.

<details><summary>Respuesta modelo</summary>

El esquema se aplica al **leer** los datos, no al guardarlos. Los archivos
están en HDFS tal como llegaron, y la tabla dice cómo interpretarlos.

- Ventaja: cargar es instantáneo (crear la tabla no lee nada), y sobre los
  mismos archivos puede haber varias tablas con distintos esquemas.
- Desventaja: los errores aparecen tarde y en silencio. Una fila con un texto
  donde va un número no se rechaza: queda con `NULL`, y las sumas dan menos
  sin avisar.

</details>

**3.** Una consulta de Hive tarda varios segundos aunque la tabla tenga 7
filas. ¿Por qué? ¿Cuándo vale la pena ese costo?

<details><summary>Respuesta modelo</summary>

Cada consulta con agregación se compila, se planifica y corre como una
aplicación de Tez en YARN: hay que pedir contenedores, arrancar JVMs y leer
los archivos de HDFS. Ese costo fijo es el mismo para 7 filas que para
200.000. Vale la pena cuando los datos son muchos: el trabajo se reparte en
el cluster y el costo fijo pasa a ser una parte chica del total. Para
consultas chicas y frecuentes conviene una base relacional.

</details>

## Ejercicios sobre la imagen

Suponen la tabla `ventas` de la [guía 6](../../06-hive.md#ventas-por-producto-en-sql).
Las consultas se pueden guardar en un archivo `.sql` de tu carpeta `datos/` y
correr con `beeline -u jdbc:hive2://localhost:10000 -f archivo.sql`.

### Ejercicio 1. Facturación por mes

Calculá, para cada mes, la cantidad de ventas, las unidades y la facturación,
ordenado por mes. ¿Qué mes facturó más y cuál menos?

<details><summary>Solución</summary>

La fecha es un `STRING` con formato `2026-01-31`: sus primeros 7 caracteres
son el mes.

<!-- prueba: adentro < beeline -u jdbc:hive2://localhost:10000 -f {} | espera: 330992000 | espera: 294766600 -->
```sql
SELECT substr(fecha, 1, 7)                     AS mes,
       COUNT(*)                                AS ventas,
       SUM(cantidad)                           AS unidades,
       SUM(CAST(cantidad AS BIGINT) * precio)  AS facturado
FROM ventas
GROUP BY substr(fecha, 1, 7)
ORDER BY mes;
```

| mes | ventas | unidades | facturado |
|---|---:|---:|---:|
| 2026-01 | 34778 | 104122 | 330992000 |
| 2026-02 | 30876 | 92357 | 294766600 |
| 2026-03 | 34039 | 102241 | 328358900 |
| 2026-04 | 32950 | 98619 | 317441300 |
| 2026-05 | 34163 | 102777 | 329053100 |
| 2026-06 | 33194 | 98957 | 312655300 |

Enero facturó más y febrero menos. Las ventas suman 200.000 y la facturación,
1.913.267.200.

</details>

**Rúbrica (10 puntos)**

| Criterio | Puntos |
|---|---:|
| Extrae el mes (`substr`, `date_format` u otra forma correcta) | 3 |
| Agrupa por la misma expresión | 2 |
| Usa `BIGINT` en la suma | 1 |
| Resultado exacto | 3 |
| Responde mayor y menor | 1 |

### Ejercicio 2. La yerba en la sucursal Centro

¿Cuántas ventas de yerba hubo en Centro, cuántas unidades, cuánto facturaron y
cuál fue el importe promedio por venta (con dos decimales)?

<details><summary>Solución</summary>

<!-- prueba: adentro < beeline -u jdbc:hive2://localhost:10000 -f {} | espera: 111935000 | espera: 7459.85 -->
```sql
SELECT COUNT(*)                                       AS ventas,
       SUM(cantidad)                                  AS unidades,
       SUM(CAST(cantidad AS BIGINT) * precio)         AS facturado,
       ROUND(AVG(CAST(cantidad AS BIGINT) * precio), 2) AS promedio
FROM ventas
WHERE producto = 'yerba' AND sucursal = 'Centro';
```

| ventas | unidades | facturado | promedio |
|---:|---:|---:|---:|
| 15005 | 44774 | 111935000 | 7459.85 |

Como la yerba cuesta siempre 2500, el promedio es 2500 por las unidades
promedio de cada venta (44774 / 15005, casi 3).

</details>

**Rúbrica (8 puntos)**: las dos condiciones en el `WHERE` (2), las cuatro
columnas (3), resultado exacto (2), redondeo a dos decimales (1).

### Ejercicio 3. Las ventas grandes

¿Cuántas ventas tienen un importe (cantidad por precio) de 35.000 o más? ¿De
qué productos son? Guardá el resultado por producto en una tabla administrada
`ventas_grandes`.

<details><summary>Solución</summary>

<!-- prueba: adentro < beeline -u jdbc:hive2://localhost:10000 -f {} | espera: 3945 | espera: 3101 -->
```sql
SELECT COUNT(*) AS ventas
FROM ventas
WHERE CAST(cantidad AS BIGINT) * precio >= 35000;

DROP TABLE IF EXISTS ventas_grandes;
CREATE TABLE ventas_grandes AS
SELECT producto, COUNT(*) AS ventas, SUM(CAST(cantidad AS BIGINT) * precio) AS facturado
FROM ventas
WHERE CAST(cantidad AS BIGINT) * precio >= 35000
GROUP BY producto;
SELECT * FROM ventas_grandes ORDER BY ventas DESC;
```

- Son **7046** ventas.
- Por producto: **termo 3945** (412.755.000: todas las ventas de termo,
  porque uno solo ya cuesta 35.000) y **mate 3101** (124.040.000: solo las
  de 5 mates, que dan 40.000; con 4 son 32.000).
- `ventas_grandes` queda con sus archivos en `/user/hive/warehouse`.

</details>

**Rúbrica (8 puntos)**: filtro sobre el importe calculado (2), cantidad total
correcta (2), desglose por producto con su explicación (2), tabla creada con
`CREATE TABLE ... AS SELECT` (2).

### Ejercicio 4. ¿Externa o administrada?

Con `DESCRIBE FORMATTED`, compará la tabla `ventas` con `ventas_grandes` (o
`ventas_por_producto` de la guía): ¿qué tipo de tabla es cada una y dónde
están sus archivos? Después borrá `ventas_grandes` y comprobá en HDFS qué pasó
con sus archivos.

<details><summary>Solución</summary>

<!-- prueba: adentro < beeline -u jdbc:hive2://localhost:10000 -f {} | espera: EXTERNAL_TABLE | espera: /user/root/ventas -->
```sql
DESCRIBE FORMATTED ventas;
DESCRIBE FORMATTED ventas_grandes;
```

- `ventas`: en `Table Type` dice `EXTERNAL_TABLE`, y su `Location` termina en
  `/user/root/ventas`.
- `ventas_grandes`: su `Location` está adentro de `/user/hive/warehouse`. Es
  una tabla que maneja Hive: el `Table Type` dice `MANAGED_TABLE` (en Hive 4,
  según la configuración del metastore, puede figurar como `EXTERNAL_TABLE`
  con la propiedad `external.table.purge` en `TRUE`, que se comporta igual: el
  `DROP` borra los archivos).

Para borrarla y mirar HDFS:

<!-- prueba: adentro -->
```bash
beeline -u jdbc:hive2://localhost:10000 -e "DROP TABLE ventas_grandes;"
hdfs dfs -ls /user/hive/warehouse
hdfs dfs -ls /user/root/ventas
```

La carpeta `ventas_grandes` desapareció del warehouse; los archivos de
`/user/root/ventas` siguen ahí, porque no son de Hive.

</details>

**Rúbrica (8 puntos)**: usa `DESCRIBE FORMATTED` (2), identifica tipo y
ubicación de cada tabla (3), comprueba en HDFS que el `DROP` borró los
archivos de la administrada y no los de la externa (3).
