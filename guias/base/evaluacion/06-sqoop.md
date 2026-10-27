# Evaluación 6. Sqoop y bases relacionales

[← 5. Hive](05-hive.md) · [Evaluación](README.md) · Teoría: [Sqoop](../teoria/06-sqoop.md) · Guía: [7. MySQL y Sqoop](../../07-mysql-sqoop.md) · Siguiente: [7. Spark →](07-spark.md)

## Opción múltiple

**1.** ¿Qué hace Sqoop?

- a) Es una base de datos relacional que corre en HDFS.
- b) Copia tablas entre una base relacional (por JDBC) y HDFS, en los dos
  sentidos, con trabajos MapReduce.
- c) Es la consola de MySQL.
- d) Convierte SQL en Pig Latin.

<details><summary>Respuesta</summary>

**b)** `import` va de la base a HDFS y `export`, de HDFS a la base.

- a) La base es MySQL (MariaDB), aparte del cluster.
- c) La consola es `mysql`.
- d) No traduce nada: copia filas.

</details>

**2.** Un `sqoop import` aparece en http://localhost:8088 como un trabajo
MapReduce. ¿Qué tiene de particular?

- a) Solo tiene reducers.
- b) Solo tiene mappers: cada uno lee un rango de la tabla y lo escribe en un
  archivo `part-m-*`; no hay nada que agrupar.
- c) Tiene un mapper por fila.
- d) No usa YARN.

<details><summary>Respuesta</summary>

**b)** Por eso los archivos se llaman `part-m-0000N` (m de map), y con
`-m 4` hay 4.

- a) No hay reducers.
- c) Hay tantos mappers como diga `-m`.
- d) Corre en YARN como cualquier trabajo MapReduce.

</details>

**3.** Con `--table ventas -m 4`, ¿cómo reparte Sqoop las filas entre los 4
mappers?

- a) Al azar.
- b) Pide el mínimo y el máximo de la clave primaria (`id`) y parte ese rango
  en 4 tramos; cada mapper lee uno con un `WHERE id >= ... AND id < ...`.
- c) Por sucursal.
- d) Cada mapper lee la tabla entera y se queda con una de cada 4 filas.

<details><summary>Respuesta</summary>

**b)** Funciona bien si la clave está repartida pareja (como un
`AUTO_INCREMENT`). Si hay huecos grandes, algunos mappers trabajan mucho más
que otros.

- a) El reparto es por rangos, para que cada mapper haga una consulta simple.
- c) Partiría por sucursal solo con `--split-by sucursal`.
- d) Eso leería la tabla 4 veces.

</details>

**4.** Se quiere importar con `-m 4` una tabla que no tiene clave primaria.
¿Qué pasa?

- a) Sqoop la importa igual, con 4 mappers.
- b) Falla y pide una columna para partir (`--split-by`) o importar con un
  solo mapper (`-m 1`).
- c) Crea una clave primaria en MySQL.
- d) Importa solo la primera cuarta parte.

<details><summary>Respuesta</summary>

**b)** Sin una columna por la cual partir, Sqoop no sabe armar los rangos.

- a) No sabe cómo repartir.
- c) Sqoop no modifica la tabla de origen.
- d) No importa nada.

</details>

**5.** ¿Para qué sirve `--delete-target-dir`?

- a) Para borrar la tabla en MySQL después de importar.
- b) Para borrar la carpeta de HDFS de destino si ya existe; sin eso, el
  import falla igual que un MapReduce con la salida existente.
- c) Para importar sin escribir en HDFS.
- d) Para borrar los `.java` que genera Sqoop.

<details><summary>Respuesta</summary>

**b)** Permite repetir el import. Sin ella, la segunda vez falla porque la
carpeta existe.

- a) Sqoop no borra datos del origen.
- c) El import siempre escribe en HDFS.
- d) Esos archivos quedan; se borran a mano.

</details>

**6.** En el export a `resumen_categoria`, ¿por qué la guía hace antes un
`TRUNCATE TABLE`?

- a) Porque Sqoop no puede escribir en tablas con datos.
- b) Porque `categoria` es la clave primaria: si se exporta dos veces, las
  filas repetidas dan `Duplicate entry`.
- c) Para liberar espacio en HDFS.
- d) Porque la tabla tiene que tener las columnas de HDFS.

<details><summary>Respuesta</summary>

**b)** `sqoop export` hace `INSERT`. Vaciar antes deja repetir el ejemplo.
(Otra opción es `--update-key`, que actualiza en vez de insertar.)

- a) Puede, mientras no haya claves repetidas.
- c) `TRUNCATE` es de MySQL, no de HDFS.
- d) Eso es cierto, pero no es lo que resuelve el `TRUNCATE`.

</details>

**7.** ¿Qué hace `sqoop eval`?

- a) Corre una consulta SQL directo en la base y muestra el resultado, sin
  usar Hadoop.
- b) Evalúa cuánto va a tardar un import.
- c) Corre un trabajo MapReduce de prueba.
- d) Valida el esquema de HDFS.

<details><summary>Respuesta</summary>

**a)** Sirve para probar la conexión y para comandos sueltos como el
`TRUNCATE`.

- b), c) y d) No hace nada de eso.

</details>

**8.** Con `--query`, ¿para qué está `$CONDITIONS` en el `WHERE`?

- a) Es una variable de bash.
- b) Sqoop la reemplaza en cada mapper por el rango que le toca
  (`id >= ... AND id < ...`): es lo que permite repartir una consulta.
- c) Es obligatoria solo en MySQL.
- d) Filtra las filas nulas.

<details><summary>Respuesta</summary>

**b)** Por eso va escrita `\$CONDITIONS` entre comillas dobles: para que bash
no la reemplace antes. Con `--query` también hace falta `--split-by` (o
`-m 1`).

- a) Es de Sqoop; el `\` es justamente para que bash no la toque.
- c) Es de Sqoop, para cualquier base.
- d) No filtra nulos.

</details>

**9.** ¿En qué formato quedan en HDFS las tablas importadas en la guía?

- a) Parquet.
- b) Archivos de texto, una fila por línea, con los campos separados por
  comas.
- c) Un archivo `.sql` con los `INSERT`.
- d) Tablas de Hive administradas.

<details><summary>Respuesta</summary>

**b)** Por eso después se pueden leer con una tabla externa de Hive
(`FIELDS TERMINATED BY ','`), igual que el CSV de ventas.

- a) Se puede con `--as-parquetfile`, pero la guía usa el formato de fábrica.
- c) No genera SQL.
- d) Quedan como archivos; la tabla de Hive la crea `tienda.hql`.

</details>

**10.** ¿Por qué copiar las ventas de MySQL a HDFS en vez de calcular todo
en MySQL?

- a) Porque MySQL no sabe hacer `GROUP BY`.
- b) Porque el cluster reparte el cálculo, guarda el historial completo sin
  cargar a la base de la aplicación, y lo junta con datos de otras fuentes;
  la base sigue atendiendo a los usuarios.
- c) Porque HDFS es más rápido para buscar una fila.
- d) Porque Sqoop borra las filas de MySQL.

<details><summary>Respuesta</summary>

**b)** Es el camino típico de los datos de una empresa: el sistema operativo
(OLTP) en la base, el análisis (OLAP) en el cluster. Con 200.000 filas MySQL
alcanza; la idea se justifica con volúmenes mucho mayores.

- a) MySQL sabe agrupar.
- c) Para buscar una fila, la base con su índice es mucho más rápida.
- d) Sqoop no borra nada.

</details>

## Desarrollo

**1.** Describí el recorrido completo de la guía 7: de qué tabla salen los
datos, dónde quedan en cada paso y adónde vuelven.

<details><summary>Respuesta modelo</summary>

1. **MySQL** (`tienda`): las tablas `productos` (8 filas) y `ventas`
   (200.000 filas con `id`).
2. **Import** con Sqoop a HDFS: `/user/root/tienda/productos` (`-m 1`, un
   archivo) y `/user/root/tienda/ventas` (`-m 4`, cuatro archivos).
3. **Hive** (`tienda.hql`): dos tablas externas sobre esas carpetas y un JOIN
   que calcula la facturación por categoría. El resultado se guarda en
   `/user/root/resultados/hive_por_categoria`.
4. **Export** con Sqoop de esa carpeta a la tabla `resumen_categoria` de
   MySQL, vaciada antes. Quedan 4 filas (accesorios 906.830.000, la mayor).

El JOIN hace falta porque la categoría está en `productos` y las ventas en
`ventas`.

</details>

**2.** ¿Qué cuidados hay que tener al usar Sqoop contra la base de producción
de una empresa?

<details><summary>Respuesta modelo</summary>

- **Carga**: cada mapper es una conexión que lee un rango; con muchos mappers
  se puede saturar la base que usan los clientes. Conviene pocos mappers y
  horarios de baja actividad.
- **Consistencia**: las filas que cambian durante el import pueden quedar a
  medias entre mappers. Para cargas periódicas, Sqoop tiene import
  incremental (`--incremental append` con `--check-column`).
- **Claves**: pasar la clave en la línea de comandos queda en el historial y
  en la lista de procesos (por eso el `WARN`); hay opciones como
  `--password-file`.
- **Export**: escribe en la base; hay que definir qué pasa con las filas
  repetidas (vaciar antes, o `--update-key`).

</details>

## Ejercicios sobre la imagen

Suponen `SERVICIOS=todo` y, para el ejercicio 4, la tabla `ventas` de Hive
([guía 6](../../06-hive.md#ventas-por-producto-en-sql)).

### Ejercicio 1. Las sucursales

Importá la tabla `sucursales` a `/user/root/tienda/sucursales` con un solo
mapper y mostrá el archivo. ¿Cuántos archivos `part-m-*` hay? ¿Por qué?

<details><summary>Solución</summary>

<!-- prueba: adentro | espera: Centro,Laura Gomez,2015-03-01 -->
```bash
sqoop import --connect jdbc:mysql://localhost/tienda --username alumno --password alumno \
  --table sucursales \
  --target-dir /user/root/tienda/sucursales --delete-target-dir \
  -m 1
hdfs dfs -ls /user/root/tienda/sucursales
hdfs dfs -cat /user/root/tienda/sucursales/part-m-00000
```

Hay un solo `part-m-00000` (más `_SUCCESS`), porque hubo un mapper. Tiene 4
líneas, una por sucursal, con su encargado y su fecha de apertura (por
ejemplo, `Centro,Laura Gomez,2015-03-01`).

</details>

**Rúbrica (6 puntos)**: comando correcto con `-m 1` (2), muestra el archivo
(2), explica la relación mappers-archivos (2).

### Ejercicio 2. Solo una sucursal

Importá solo las ventas de la sucursal **Centro** a
`/user/root/tienda/ventas_centro`, con 4 mappers. ¿Cuántas filas trajo?

<details><summary>Solución</summary>

<!-- prueba: no (solución de ejercicio: --where no se usa en las guías probadas) -->
```bash
sqoop import --connect jdbc:mysql://localhost/tienda --username alumno --password alumno \
  --table ventas --where "sucursal='Centro'" \
  --target-dir /user/root/tienda/ventas_centro --delete-target-dir \
  -m 4
hdfs dfs -ls /user/root/tienda/ventas_centro
```

Al final dice `Retrieved 49851 records`: las ventas de Centro. El filtro lo
hace MySQL (cada mapper agrega la condición a su consulta), así que por la red
viajan solo esas filas. Para comprobarlo en la base:

<!-- prueba: adentro < mysql tienda | espera: 49851 -->
```sql
SELECT COUNT(*) FROM ventas WHERE sucursal = 'Centro';
```

</details>

**Rúbrica (6 puntos)**: usa `--where` con las comillas bien puestas (3),
cantidad correcta (2), la comprueba en MySQL (1).

### Ejercicio 3. Importar una consulta

Importá, con 2 mappers, el `id`, la fecha, la sucursal y la cantidad de las
ventas de **termo**, a `/user/root/tienda/ventas_termo`. ¿Cuántas filas son?

<details><summary>Solución</summary>

<!-- prueba: no (solución de ejercicio: --query y --split-by no se usan en las guías probadas) -->
```bash
sqoop import --connect jdbc:mysql://localhost/tienda --username alumno --password alumno \
  --query "SELECT id, fecha, sucursal, cantidad FROM ventas WHERE producto = 'termo' AND \$CONDITIONS" \
  --split-by id \
  --target-dir /user/root/tienda/ventas_termo --delete-target-dir \
  -m 2
hdfs dfs -ls /user/root/tienda/ventas_termo
```

- `Retrieved 3945 records`: todas las ventas de termo.
- Hay dos `part-m-*`, uno por mapper. `\$CONDITIONS` va con `\` para que bash
  no la reemplace; Sqoop la cambia en cada mapper por su rango de `id`.
- Con `--query`, `--target-dir` es obligatorio (no hay nombre de tabla del que
  sacar la carpeta) y `--split-by` también, si hay más de un mapper.

</details>

**Rúbrica (8 puntos)**: consulta con `$CONDITIONS` escapado (3), `--split-by`
(2), cantidad correcta (2), explica para qué sirve `$CONDITIONS` (1).

### Ejercicio 4. Devolver un resultado a MySQL

Calculá en Hive la cantidad de ventas y la facturación por sucursal, guardalo
en `/user/root/resultados/hive_por_sucursal` y exportalo a una tabla nueva
`resumen_sucursal` de MySQL. Mostrá la tabla desde MySQL.

<details><summary>Solución</summary>

Primero, la tabla destino en MySQL; después, el resultado de Hive como
archivos; por último, el export:

<!-- prueba: adentro | espera: Exported 4 records -->
```bash
mysql tienda -e "DROP TABLE IF EXISTS resumen_sucursal;
  CREATE TABLE resumen_sucursal (sucursal VARCHAR(20) PRIMARY KEY, tickets INT NOT NULL, facturado BIGINT NOT NULL);"
beeline -u jdbc:hive2://localhost:10000 -e "INSERT OVERWRITE DIRECTORY '/user/root/resultados/hive_por_sucursal'
  ROW FORMAT DELIMITED FIELDS TERMINATED BY ','
  SELECT sucursal, COUNT(*), SUM(CAST(cantidad AS BIGINT) * precio) FROM ventas GROUP BY sucursal;"
sqoop export --connect jdbc:mysql://localhost/tienda --username alumno --password alumno \
  --table resumen_sucursal \
  --export-dir /user/root/resultados/hive_por_sucursal \
  -m 1
```

<!-- prueba: adentro < mysql tienda | espera: 480328000 -->
```sql
SELECT * FROM resumen_sucursal ORDER BY facturado DESC;
```

| sucursal | tickets | facturado |
|---|---:|---:|
| Oeste | 50155 | 480328000 |
| Norte | 50062 | 480187600 |
| Sur | 49932 | 476986200 |
| Centro | 49851 | 475765400 |

- Las columnas del archivo tienen que estar en el mismo orden que las de la
  tabla de MySQL: Sqoop las inserta por posición.
- Como la tabla se crea de nuevo, se puede repetir sin `Duplicate entry`.

</details>

**Rúbrica (10 puntos)**

| Criterio | Puntos |
|---|---:|
| Tabla destino con tipos adecuados (`BIGINT` para la facturación) | 2 |
| Resultado de Hive guardado como archivos separados por comas | 3 |
| `sqoop export` correcto (`Exported 4 records`) | 3 |
| Resultado verificado en MySQL | 2 |
