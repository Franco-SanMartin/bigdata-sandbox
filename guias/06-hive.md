# 6. Hive

SQL sobre los archivos de HDFS. Hive guarda el *esquema* de cada tabla (sus
columnas y dónde están sus archivos) en el **metastore**, y cada consulta la
corre como un trabajo **Tez** en YARN.

[← 5. Pig](05-pig.md) · [Índice](README.md) · Siguiente: [7. MySQL y Sqoop →](07-mysql-sqoop.md)

Todo va **adentro** del contenedor, parado en `/datos`. Hace falta haber subido
las ventas a `/user/root/ventas` ([guía 3](03-hdfs.md#un-dataset-de-verdad-200000-ventas))
y `SERVICIOS=todo` (el valor por defecto).

## Las piezas

| Pieza | Qué es |
|---|---|
| **Metastore** (puerto 9083) | La base de datos de Hive *sobre* los datos: tablas, columnas, ubicación en HDFS. Spark usa el mismo |
| **HiveServer2** (puerto 10000; web en http://localhost:10002) | El servidor al que se conectan los clientes SQL |
| **beeline** | El cliente de consola de HiveServer2 |
| **Tez** | El motor que ejecuta las consultas en YARN (en http://localhost:8088 aparecen como `TEZ`) |

## Ventas por producto en SQL

`ejemplos/ventas.hql` crea la tabla `ventas` sobre `/user/root/ventas` y hace
el mismo cálculo de las guías 4 y 5:

<!-- prueba: adentro | espera: 448780000 | espera: 179512 -->
```bash
beeline -u jdbc:hive2://localhost:10000 -f ejemplos/ventas.hql
```

Además de las ventas por producto, muestra las ventas por sucursal y guarda el
primer resultado en `/user/root/resultados/hive_por_producto`.

La tabla es **EXTERNAL**: Hive solo anota el esquema y que sus datos son los
archivos de `/user/root/ventas`. No mueve ni copia nada: si se borra la tabla
(`DROP TABLE`), los archivos quedan. `skip.header.line.count` saltea la línea
de encabezado del CSV.

## La consola de beeline

<!-- prueba: no (abre una consola interactiva) -->
```bash
beeline -u jdbc:hive2://localhost:10000
```

Queda el prompt `0: jdbc:hive2://localhost:10000>`. Cada consulta termina con
`;`. Se sale con `!quit`. Probá estas (también se pueden guardar en un archivo
`.sql` en tu carpeta `datos/` y correrlo con `beeline -u
jdbc:hive2://localhost:10000 -f archivo.sql`):

<!-- prueba: adentro < beeline -u jdbc:hive2://localhost:10000 -f {} | espera: 200000 | espera: Centro -->
```sql
SHOW TABLES;
DESCRIBE ventas;
SELECT COUNT(*) FROM ventas;
SELECT * FROM ventas LIMIT 5;
SELECT sucursal, COUNT(*) AS tickets, SUM(CAST(cantidad AS BIGINT) * precio) AS facturado
FROM ventas
GROUP BY sucursal
ORDER BY facturado DESC;
```

- `COUNT(*)` da **200000**: una fila por venta (sin el encabezado).
- `CAST(... AS BIGINT)`: cantidad × precio sumado en 200.000 filas no entra
  en un `INT`.
- Cada consulta con `GROUP BY` es un trabajo en YARN; las simples (`LIMIT`)
  Hive las responde leyendo el archivo directamente.

## Una tabla administrada por Hive

Con `CREATE TABLE ... AS SELECT` (sin `EXTERNAL`) Hive crea la tabla **y**
guarda sus archivos en su propia carpeta de HDFS, el *warehouse*
(`/user/hive/warehouse`). Esa sí la maneja Hive: `DROP TABLE` borra también
los archivos.

<!-- prueba: adentro < beeline -u jdbc:hive2://localhost:10000 -f {} | espera: ventas_por_producto -->
```sql
DROP TABLE IF EXISTS ventas_por_producto;
CREATE TABLE ventas_por_producto AS
SELECT producto, SUM(cantidad) AS unidades, SUM(CAST(cantidad AS BIGINT) * precio) AS facturado
FROM ventas
GROUP BY producto;
SELECT * FROM ventas_por_producto ORDER BY facturado DESC;
SHOW TABLES;
```

Sus archivos, en HDFS:

<!-- prueba: adentro | espera: ventas_por_producto -->
```bash
hdfs dfs -ls -R /user/hive/warehouse
```

## De Hive a Spark

Hive y Spark comparten el metastore: las tablas `ventas` y
`ventas_por_producto` se ven también desde Spark
([guía 8](08-spark.md#sql-sobre-las-tablas-de-hive)).

## Lo más usado

| Comando | Qué hace |
|---|---|
| `beeline -u jdbc:hive2://localhost:10000` | Consola SQL (salir: `!quit`) |
| `beeline -u jdbc:hive2://localhost:10000 -f archivo.sql` | Corre un archivo |
| `beeline -u jdbc:hive2://localhost:10000 -e "SELECT ..."` | Una consulta suelta |
| `SHOW DATABASES;` `SHOW TABLES;` | Bases y tablas |
| `DESCRIBE FORMATTED tabla;` | Columnas, si es externa o administrada, y su carpeta de HDFS |
| `CREATE EXTERNAL TABLE ... LOCATION '/carpeta'` | Tabla sobre archivos que ya están en HDFS |
| `CREATE TABLE t AS SELECT ...` | Tabla nueva, con sus archivos en el warehouse |
| `INSERT OVERWRITE DIRECTORY '/carpeta' ... SELECT ...` | Guarda un resultado como archivos en HDFS |
