# Evaluación 4. Pig

[← 3. YARN y MapReduce](03-yarn-mapreduce.md) · [Evaluación](README.md) · Teoría: [Pig](../teoria/04-pig.md) · Guía: [5. Pig](../../05-pig.md) · Siguiente: [5. Hive →](05-hive.md)

## Opción múltiple

**1.** En un script de Pig, ¿cuándo se ejecuta algo en el cluster?

- a) En cada línea, apenas se escribe.
- b) Recién cuando aparece un `DUMP` o un `STORE`: ahí Pig arma el plan con
  todo lo anterior y lo manda a YARN.
- c) En cada `FILTER`.
- d) Al final del script, aunque no haya `DUMP` ni `STORE`.

<details><summary>Respuesta</summary>

**b)** La evaluación es diferida: los `LOAD`, `FILTER`, `GROUP` solo definen
relaciones. Como el plan se arma con el script completo, Pig puede
optimizarlo (por ejemplo, filtrar antes).

- a) y c) Ejecutar paso por paso generaría un trabajo por línea.
- d) Sin `DUMP` ni `STORE` no hay nada que producir: no se ejecuta nada.

</details>

**2.** ¿Qué es una **relación** en Pig?

- a) Una tabla del metastore de Hive.
- b) El resultado con nombre de cada paso (`ventas = LOAD ...`): una bolsa de
  tuplas.
- c) Un JOIN entre dos archivos.
- d) Una clave foránea.

<details><summary>Respuesta</summary>

**b)** Cada alias es una relación, y cada paso crea una nueva a partir de
otra.

- a) Pig no usa el metastore en las guías: el esquema se declara en el `LOAD`.
- c) El JOIN es una de las operaciones que crean relaciones, no la
  definición.
- d) No hay claves foráneas en Pig.

</details>

**3.** Después de `por_producto = GROUP con_importe BY producto;`, ¿qué
tiene cada tupla de `por_producto`?

- a) El producto y la suma de sus importes.
- b) El campo `group` (el producto) y una bolsa `con_importe` con todas las
  filas de ese producto.
- c) Solo las filas del primer producto.
- d) Las filas originales, ordenadas por producto.

<details><summary>Respuesta</summary>

**b)** Es el modelo anidado de Pig: una celda puede tener una bolsa entera.
El resumen se hace después con `FOREACH ... GENERATE group,
SUM(con_importe.cantidad)`.

- a) Eso es lo que da el `FOREACH` siguiente, no el `GROUP`.
- c) Hay una tupla por cada producto.
- d) Para ordenar está `ORDER`.

</details>

**4.** ¿Para qué está `datos = FILTER ventas BY fecha != 'fecha';` en
`ventas.pig`?

- a) Para sacar las ventas sin fecha.
- b) Para sacar la línea de encabezado del CSV, que `PigStorage` lee como
  una fila más.
- c) Para quedarse con las ventas de una fecha.
- d) Es obligatorio después de cada `LOAD`.

<details><summary>Respuesta</summary>

**b)** La primera línea dice `fecha,sucursal,...`; su campo `fecha` vale
`'fecha'`. Es lo mismo que hace el mapper de Python con `campos[0] ==
"fecha"`.

- a) Todas las ventas tienen fecha.
- c) No compara con una fecha.
- d) Solo hace falta si el archivo tiene encabezado.

</details>

**5.** ¿Qué hace `pig -x local`?

- a) Corre Pig en el cluster, pero solo en el nodo local.
- b) Corre en una sola JVM, sobre archivos del disco del contenedor, sin HDFS
  ni YARN: sirve para probar rápido con datos chicos.
- c) Abre la interfaz web de Pig.
- d) Corre solo la primera línea del script.

<details><summary>Respuesta</summary>

**b)** Por eso en la guía `pig -x local` lee `ejemplos/ventas.csv` (una ruta
del disco) y `pig` a secas lee `/user/root/ventas` (de HDFS).

- a) El modo local no usa el cluster.
- c) Pig no tiene interfaz web propia: sus trabajos se ven en la de YARN.
- d) Corre el script entero.

</details>

**6.** ¿Para qué sirve `-param entrada=ejemplos/texto.txt`?

- a) Para reemplazar `$entrada` en el script, que tiene `%default entrada
  '/user/root/texto.txt'`.
- b) Para pasarle un argumento a Java.
- c) Para elegir la cantidad de reducers.
- d) Para renombrar el script.

<details><summary>Respuesta</summary>

**a)** `%default` da un valor para cuando no se pasa el parámetro. Así el
mismo script sirve para HDFS y para un archivo local.

- b) Las opciones de Java van por otro lado.
- c) Eso es `PARALLEL` en Pig, o `mapreduce.job.reduces` en MapReduce.
- d) No tiene nada que ver con el nombre.

</details>

**7.** En SQL, `WHERE`, `GROUP BY` y `ORDER BY`. ¿Cuál es el equivalente en
Pig Latin?

- a) `FILTER`, `GROUP` (y después `FOREACH`) y `ORDER`.
- b) `SELECT`, `GROUP` y `SORT`.
- c) `FOREACH`, `JOIN` y `LIMIT`.
- d) `LOAD`, `STORE` y `DUMP`.

<details><summary>Respuesta</summary>

**a)** Es la tabla del final de la guía 5. En Pig el agrupar (`GROUP`) y el
resumir (`FOREACH ... GENERATE SUM(...)`) son dos pasos.

- b) `SELECT` y `SORT` no son instrucciones de Pig Latin.
- c) `FOREACH` es el `SELECT`, `JOIN` el `JOIN` y `LIMIT` el `LIMIT`.
- d) Son las de leer, guardar y mostrar.

</details>

**8.** ¿Por qué `ventas.pig` calcula el importe con `(long)cantidad * precio`?

- a) Porque Pig no multiplica enteros.
- b) Para hacer la cuenta en un entero de 64 bits: un `int` llega a poco más
  de 2.100 millones, y con datos más grandes se desbordaría.
- c) Para redondear los centavos.
- d) Para que el resultado sea texto.

<details><summary>Respuesta</summary>

**b)** Con los datos de la imagen, cada importe entra en un `int` (el mayor es
175.000), pero convertir a `long` es una precaución barata para sumas grandes.
Hive hace lo mismo con `CAST(... AS BIGINT)`.

- a) Pig multiplica `int` sin problema.
- c) `long` es entero: no hay centavos.
- d) `chararray` es el texto.

</details>

**9.** ¿Qué diferencia hay entre `DUMP r` y `STORE r INTO 'ruta'`?

- a) Ninguna.
- b) `DUMP` muestra el resultado en la pantalla; `STORE` lo guarda en una
  carpeta (de HDFS, o del disco con `-x local`). Los dos ejecutan el plan.
- c) `DUMP` ejecuta y `STORE` no.
- d) `STORE` solo sirve en modo local.

<details><summary>Respuesta</summary>

**b)** `DUMP` es para mirar mientras se prueba; `STORE` deja el resultado
para otros (Hive, Spark, `hdfs dfs -cat`).

- a) Uno muestra y el otro guarda.
- c) Los dos disparan la ejecución.
- d) `ventas.pig` hace `STORE` en HDFS.

</details>

**10.** ¿Cuál es una limitación de Pig frente a Hive o Spark hoy?

- a) No puede leer CSV.
- b) Corre sobre MapReduce (en la imagen), que escribe en disco entre
  trabajos, y casi no tiene desarrollo nuevo: los proyectos nuevos suelen usar
  Spark o SQL.
- c) No puede agrupar.
- d) Solo funciona en modo local.

<details><summary>Respuesta</summary>

**b)** Pig sigue funcionando y se ve en sistemas existentes, pero su lugar lo
ocuparon Spark (con DataFrames, también paso a paso) y los motores SQL.

- a) `PigStorage(',')` lee CSV.
- c) `GROUP` agrupa.
- d) De fábrica corre en el cluster.

</details>

## Desarrollo

**1.** Compará el cálculo de ventas por producto con MapReduce (guía 4) y con
Pig (guía 5). ¿Qué escribe el programador en cada caso, y qué hace la
herramienta?

<details><summary>Respuesta modelo</summary>

- Con **MapReduce** (Streaming), el programador escribe el mapper (separar
  campos, saltear el encabezado, emitir clave y valores) y el reducer
  (acumular mientras la clave no cambia). Tiene que pensar en el shuffle y en
  el formato de las líneas. Ordenar por facturación sería otro trabajo.
- Con **Pig**, escribe los pasos (`LOAD`, `FILTER`, `FOREACH`, `GROUP`,
  `FOREACH ... SUM`, `ORDER`, `STORE`) y Pig decide cuántos trabajos
  MapReduce hacen falta, qué va en el map y qué en el reduce, y los encadena.
- El resultado es el mismo (yerba 179512 y 448780000, etc.). Pig da menos
  control, pero muchas menos líneas y menos errores.

</details>

**2.** ¿Por qué la evaluación diferida es una ventaja? Dá un ejemplo con un
script de Pig.

<details><summary>Respuesta modelo</summary>

Como nada se ejecuta hasta el `DUMP` o el `STORE`, Pig ve el script completo
antes de correrlo y puede optimizarlo: mover los filtros lo más cerca posible
del `LOAD`, descartar columnas que no se usan, juntar pasos en un mismo
trabajo. Por ejemplo, en `centro.pig` el `FILTER` por `Centro` y el `FOREACH`
que calcula el importe se hacen en el mismo map, sin escribir nada
intermedio. Además, un error de sintaxis o de esquema se detecta antes de
gastar tiempo del cluster.

</details>

**3.** ¿Cuándo conviene probar con `pig -x local` y cuándo correr en el
cluster?

<details><summary>Respuesta modelo</summary>

`-x local` corre en una sola JVM, sobre archivos del disco y sin YARN: tarda
segundos y sirve para escribir y depurar el script con un archivo chico (como
`ejemplos/ventas.csv`, de 7 filas, donde se pueden verificar los resultados a
mano). El cluster se usa con los datos de verdad (`/user/root/ventas`): ahí se
reparte el trabajo, pero cada corrida paga el arranque de los trabajos en
YARN. Con `-param` el mismo script sirve para los dos.

</details>

## Ejercicios sobre la imagen

### Ejercicio 1. Ventas por sucursal, en local

Escribí un script `sucursal.pig` (guardalo en tu carpeta `datos/`) que, sobre
`ejemplos/ventas.csv`, calcule por sucursal las unidades y la facturación,
ordenado de mayor a menor facturación. Corrélo con `pig -x local sucursal.pig`
y verificá el resultado a mano con las 7 filas del archivo.

<details><summary>Solución</summary>

<!-- prueba: adentro < pig -x local {} | espera: (Centro,9,55000) -->
```pig
ventas = LOAD 'ejemplos/ventas.csv' USING PigStorage(',')
         AS (fecha:chararray, sucursal:chararray, producto:chararray,
             cantidad:int, precio:int);
datos  = FILTER ventas BY fecha != 'fecha';
con_importe = FOREACH datos GENERATE sucursal, cantidad,
              (long)cantidad * precio AS importe;
por_sucursal = GROUP con_importe BY sucursal;
resumen = FOREACH por_sucursal GENERATE
              group                     AS sucursal,
              SUM(con_importe.cantidad) AS unidades,
              SUM(con_importe.importe)  AS facturado;
ordenado = ORDER resumen BY facturado DESC;
DUMP ordenado;
```

El `DUMP` muestra una tupla por sucursal: `(Centro,9,55000)`,
`(Sur,4,22000)` y `(Norte,2,10500)`.

A mano: Centro = 3 yerba (7500) + 5 yerba (12500) + 1 termo (35000); Sur =
2 bombillas (6000) + 2 mates (16000); Norte = 1 mate (8000) + 1 yerba (2500).

</details>

**Rúbrica (10 puntos)**

| Criterio | Puntos |
|---|---:|
| `LOAD` con el esquema y filtro del encabezado | 2 |
| Importe calculado por fila | 2 |
| `GROUP` por sucursal y `SUM` de la bolsa | 3 |
| `ORDER ... DESC` | 1 |
| Resultado correcto, verificado a mano | 2 |

### Ejercicio 2. La yerba en cada sucursal, en el cluster

Sobre las 200.000 ventas de `/user/root/ventas`, calculá para la **yerba**:
por sucursal, la cantidad de ventas (tickets), las unidades y la facturación.
Corrélo en el cluster (`pig`, sin `-x local`). ¿Qué sucursal vendió más
yerba?

<details><summary>Solución</summary>

<!-- prueba: adentro < pig {} | espera: (Sur,15037,45034,112585000) -->
```pig
ventas = LOAD '/user/root/ventas' USING PigStorage(',')
         AS (fecha:chararray, sucursal:chararray, producto:chararray,
             cantidad:int, precio:int);
datos  = FILTER ventas BY fecha != 'fecha';
yerba  = FILTER datos BY producto == 'yerba';
con_importe = FOREACH yerba GENERATE sucursal, cantidad,
              (long)cantidad * precio AS importe;
por_sucursal = GROUP con_importe BY sucursal;
resumen = FOREACH por_sucursal GENERATE
              group                     AS sucursal,
              COUNT(con_importe)        AS tickets,
              SUM(con_importe.cantidad) AS unidades,
              SUM(con_importe.importe)  AS facturado;
ordenado = ORDER resumen BY facturado DESC;
DUMP ordenado;
```

El `DUMP` muestra una tupla por sucursal, por ejemplo
`(Sur,15037,45034,112585000)`:

| sucursal | tickets | unidades | facturado |
|---|---:|---:|---:|
| Sur | 15037 | 45034 | 112585000 |
| Norte | 15059 | 44909 | 112272500 |
| Oeste | 15058 | 44795 | 111987500 |
| Centro | 15005 | 44774 | 111935000 |

Sur es la que más facturó con yerba, aunque Norte tuvo más tickets. Las
cuatro suman 179.512 unidades y 448.780.000, lo mismo que la yerba en la guía.
Mientras corre, los trabajos aparecen en http://localhost:8088.

</details>

**Rúbrica (10 puntos)**: lee de HDFS y corre en el cluster (2), filtra por
producto (2), `COUNT` y los dos `SUM` sobre la bolsa (3), resultado exacto
(2), comprueba que la suma coincide con la guía (1).

### Ejercicio 3. El mismo script, dos entradas

Sin modificar `ejemplos/ventas.pig`, corrélo en modo local sobre
`ejemplos/ventas.csv`, guardando el resultado en `/tmp/pig_chico`. ¿Qué
producto facturó más en el archivo chico? ¿Por qué no hizo falta editar el
script?

<details><summary>Solución</summary>

<!-- prueba: adentro | espera: termo,1,35000 -->
```bash
pig -x local -param entrada=ejemplos/ventas.csv -param salida=/tmp/pig_chico ejemplos/ventas.pig
cat /tmp/pig_chico/part-*
```

| producto | unidades | facturado |
|---|---:|---:|
| termo | 1 | 35000 |
| mate | 3 | 24000 |
| yerba | 9 | 22500 |
| bombilla | 2 | 6000 |

(En el archivo, separados por comas: `termo,1,35000`...)

- El termo facturó más (una sola venta de 35.000), aunque la yerba tuvo más
  unidades.
- No hizo falta editar el script porque la entrada y la salida son parámetros
  (`%default entrada` y `%default salida`): `-param` los reemplaza. En modo
  local, `salida` es una carpeta del disco del contenedor y el `fs -rm -r -f`
  del script la borra ahí.

</details>

**Rúbrica (6 puntos)**: usa `-x local` y los dos `-param` (3), resultado
correcto (2), explica `%default` (1).
