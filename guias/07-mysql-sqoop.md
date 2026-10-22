# 7. MySQL y Sqoop

Traer tablas de una base relacional a HDFS, procesarlas con Hive y devolver
el resultado a la base. Es el camino típico de los datos de una empresa: del
sistema de ventas (MySQL) al cluster, y de vuelta.

[← 6. Hive](06-hive.md) · [Índice](README.md) · Siguiente: [8. Spark →](08-spark.md)

Todo va **adentro** del contenedor, parado en `/datos`, con `SERVICIOS=todo`
(el valor por defecto).

## La base MySQL `tienda`

Adentro del contenedor corre un MySQL (MariaDB, compatible) con la base
`tienda` ya cargada: la misma empresa de las ventas de las guías anteriores.
No está en HDFS: es una base común, aparte del cluster.

| Tabla | Qué tiene |
|---|---|
| `productos` | Los 8 productos, con su categoría y su precio |
| `sucursales` | Las 4 sucursales |
| `ventas` | Las mismas 200.000 ventas de `ventas_grandes.csv`, con un `id` |
| `resumen_categoria` | Vacía: es donde Sqoop va a devolver el resultado |

La consola de MySQL se abre con `mysql tienda` y se sale con `exit`. Probá
estas consultas (también se puede pasar un archivo: `mysql tienda <
archivo.sql`):

<!-- prueba: adentro < mysql tienda | espera: 200000 | espera: infusiones -->
```sql
SHOW TABLES;
SELECT * FROM productos;
SELECT COUNT(*) FROM ventas;
SELECT * FROM ventas LIMIT 3;
```

Desde tu compu, con DBeaver o MySQL Workbench: `localhost:3306`, usuario
`alumno`, clave `alumno`, base `tienda` (el `docker run` de la
[guía 2](02-arrancar-y-apagar.md) ya expone el puerto).

## Sqoop

Sqoop copia tablas entre una base relacional y HDFS. No es un servicio: cada
`import` o `export` es un trabajo MapReduce que solo tiene mappers (se ve en
http://localhost:8088). Se conecta con JDBC, como cualquier programa:

- `--connect jdbc:mysql://localhost/tienda`: qué base.
- `--username alumno --password alumno`: con qué usuario.

Sqoop escribe muchos `WARN` (avisos de Hadoop y de la clave en la línea de
comandos): son normales. Lo que importa es el final.

### 1. Mirar la base desde Sqoop

<!-- prueba: adentro | espera: tienda | espera: resumen_categoria | espera: accesorios -->
```bash
sqoop list-databases --connect jdbc:mysql://localhost --username alumno --password alumno
sqoop list-tables --connect jdbc:mysql://localhost/tienda --username alumno --password alumno
sqoop eval --connect jdbc:mysql://localhost/tienda --username alumno --password alumno \
  --query "SELECT * FROM productos"
```

`eval` corre SQL directo en MySQL (no usa Hadoop): sirve para probar la
conexión.

### 2. Importar: MySQL → HDFS

Una tabla chica, con un solo mapper (`-m 1`) → un archivo.
`--delete-target-dir` pisa la carpeta si ya existía:

<!-- prueba: adentro | espera: yerba,infusiones,2500 -->
```bash
sqoop import --connect jdbc:mysql://localhost/tienda --username alumno --password alumno \
  --table productos \
  --target-dir /user/root/tienda/productos --delete-target-dir \
  -m 1
hdfs dfs -cat /user/root/tienda/productos/part-m-00000
```

La tabla grande, con 4 mappers en paralelo. Sqoop parte la tabla en 4 rangos
de la clave primaria (`id`) y cada mapper copia uno → 4 archivos:

<!-- prueba: adentro | espera: Retrieved 200000 records -->
```bash
sqoop import --connect jdbc:mysql://localhost/tienda --username alumno --password alumno \
  --table ventas \
  --target-dir /user/root/tienda/ventas --delete-target-dir \
  -m 4
hdfs dfs -ls /user/root/tienda/ventas
hdfs dfs -cat /user/root/tienda/ventas/part-m-00000 | head -3
```

Al final del import: `Retrieved 200000 records`. Cada tabla queda como
archivos de texto separados por comas. (Sqoop además deja un `productos.java`
y un `ventas.java` en tu carpeta: la clase que generó para leer cada tabla. Se
pueden borrar.)

### 3. Procesar en Hive: un JOIN

`ejemplos/tienda.hql` crea dos tablas externas sobre lo que trajo Sqoop y las
une: facturación por **categoría** (la categoría está en `productos`, las
ventas en `ventas`). Guarda el resultado en
`/user/root/resultados/hive_por_categoria`:

<!-- prueba: adentro | espera: 906830000 -->
```bash
beeline -u jdbc:hive2://localhost:10000 -f ejemplos/tienda.hql
hdfs dfs -cat /user/root/resultados/hive_por_categoria/*
```

### 4. Exportar: HDFS → MySQL

La tabla destino tiene que existir (acá, `resumen_categoria`). Se vacía antes
para poder repetir el ejemplo (si no, `Duplicate entry`):

<!-- prueba: adentro | espera: Exported 4 records -->
```bash
sqoop eval --connect jdbc:mysql://localhost/tienda --username alumno --password alumno \
  --query "TRUNCATE TABLE resumen_categoria"
sqoop export --connect jdbc:mysql://localhost/tienda --username alumno --password alumno \
  --table resumen_categoria \
  --export-dir /user/root/resultados/hive_por_categoria \
  -m 1
```

Y el resultado, de vuelta en MySQL:

<!-- prueba: adentro < mysql tienda | espera: 906830000 -->
```sql
SELECT * FROM resumen_categoria ORDER BY facturado DESC;
```

```text
categoria	unidades	facturado
accesorios	96228	906830000
infusiones	208983	640341500
almacen	172775	257117400
panaderia	121087	108978300
```

Los 4 pasos juntos están en `ejemplos/sqoop.sh` (`bash ejemplos/sqoop.sh`).

## Lo más usado de Sqoop

| Opción | Qué hace |
|---|---|
| `--table t` | La tabla a copiar |
| `--target-dir /carpeta` | Adónde va en HDFS (import) |
| `--export-dir /carpeta` | De dónde sale en HDFS (export) |
| `--delete-target-dir` | Pisa la carpeta destino si ya existe |
| `-m N` | Cuántos mappers en paralelo |
| `--split-by col` | Por qué columna partir la tabla (si no tiene clave primaria; si no, `-m 1`) |
| `--where "cond"` | Solo las filas que cumplen |
| `--query "SELECT ... WHERE \$CONDITIONS"` | Importar una consulta en vez de una tabla (con `--split-by` o `-m 1`) |
| `--fields-terminated-by '\t'` | Otro separador |
