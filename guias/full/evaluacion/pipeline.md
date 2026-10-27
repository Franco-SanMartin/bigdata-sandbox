# Evaluación: el pipeline de datos

Sobre la [guía 6](../06-pipeline.md) y la teoría de
[pipelines](../teoria/pipelines.md).

[← Evaluación](README.md) · [Índice de full](../README.md)

## Opción múltiple

### 1. Querés correr el **Análisis** sin haber hecho el **ETL**. ¿Qué hace la pantalla?

- a) Corre el análisis sobre el CSV sucio.
- b) Corre el ETL sola antes del análisis.
- c) No lo corre: el error dice qué falta y ofrece ir a la etapa anterior.
- d) Lo corre y deja el resultado vacío.

<details><summary>Respuesta</summary>

**c).** Cada etapa usa lo que dejó la anterior; si falta la entrada, el
error lo dice y ofrece **Ir a** la etapa que la produce. Es la regla de
dependencias de cualquier orquestador.

- a) El análisis lee la tabla o el Parquet limpio, no el CSV.
- b) La pantalla no encadena etapas sola.
- d) No corre nada sin su entrada.
</details>

### 2. Para limpiar `ventas_sucias.csv` (4,5 MB), ¿qué herramienta sugiere la pantalla y por qué?

- a) PySpark, porque es Big Data.
- b) pandas, porque 4,5 MB entran de sobra en la memoria de una máquina y no necesita YARN.
- c) Pig, porque es la herramienta de ETL de Hadoop.
- d) Hive, porque deja una tabla.

<details><summary>Respuesta</summary>

**b).** pandas lo limpia en un par de segundos; PySpark hace exactamente lo
mismo pero solo la sesión de Spark lleva unos 15 s.

- a) Spark conviene cuando los datos no entran en una máquina.
- c), d) Pig y Hive figuran pero no están disponibles: "No hay un script de
  ETL para ventas_sucias en la imagen".
</details>

### 3. ¿De dónde lee pandas el CSV sucio en el ETL?

- a) De HDFS, por WebHDFS.
- b) De la carpeta local `/datos`, y después sube el Parquet a HDFS.
- c) De MySQL.
- d) De la tabla de Hive.

<details><summary>Respuesta</summary>

**b).** El trace lo dice: "lo lee de la carpeta local, no de HDFS". PySpark,
en cambio, lee y escribe en HDFS desde los executors. Es la diferencia entre
una herramienta de una máquina y una distribuida.

- a) Así lo hace PySpark.
- c) La tabla de MySQL es la de Sqoop, otro camino.
- d) La tabla se crea después, en Almacenamiento.
</details>

### 4. En **Almacenamiento**, creás la tabla externa de Hive. ¿Qué pasa con los archivos Parquet?

- a) Hive los copia a su warehouse.
- b) Hive los convierte a ORC.
- c) Quedan donde estaban: Hive anota en el Metastore dónde están y qué columnas tienen.
- d) Se borran de HDFS y quedan en MySQL.

<details><summary>Respuesta</summary>

**c).** Una tabla **externa** es solo la descripción. Borrarla borra la
descripción, no los archivos.

- a) Eso pasa con un `LOAD DATA` en una tabla administrada, no con una externa.
- b) No hay conversión.
- d) MySQL guarda el Metastore (la descripción), no los datos.
</details>

### 5. ¿Por qué la etapa de Machine Learning usa `clientes_senal.csv` y no las ventas?

- a) Porque las ventas son muy grandes.
- b) Porque las ventas generadas no tienen una relación que un modelo pueda aprender.
- c) Porque scikit-learn no lee Parquet.
- d) Porque las ventas están en MySQL.

<details><summary>Respuesta</summary>

**b).** La pantalla lo dice: "en las ventas no hay nada que predecir con
señal". Por eso es una **rama aparte** del pipeline.

- a) Son 4,5 MB.
- c) No es el motivo.
- d) Las ventas del pipeline están en HDFS.
</details>

### 6. El análisis deja `/user/root/resultados/por_producto` con varios `part-…`. ¿Cómo lo llevás a un único CSV para una planilla?

- a) `hdfs dfs -get`
- b) `hdfs dfs -getmerge`
- c) `sqoop export`
- d) `hdfs dfs -cat`

<details><summary>Respuesta</summary>

**b).** `getmerge` junta las partes en un solo archivo local en `/datos`.

- a) `-get` baja la carpeta con todas las partes separadas.
- c) Sqoop export lo lleva a una tabla de MySQL, no a un CSV.
- d) `-cat` lo muestra en pantalla; habría que redirigirlo a mano.
</details>

### 7. Tocás **Empezar de nuevo**. ¿Qué se borra?

- a) Los archivos de HDFS y las tablas que creó el pipeline.
- b) Solo el registro de la interfaz: los archivos y las tablas quedan.
- c) Todo el cluster.
- d) Solo el historial de corridas, pero el riel queda igual.

<details><summary>Respuesta</summary>

**b).** Es un reinicio del registro de etapas. Volver a correr una etapa
vuelve a escribir su salida.

- a), c) No toca HDFS, Hive ni el cluster.
- d) El riel también vuelve a *sin hacer*.
</details>

### 8. Sqoop import trae la tabla `ventas` de MySQL a HDFS. ¿Por qué ese camino no sigue al ETL?

- a) Porque Sqoop escribe en un formato que pandas no lee.
- b) Porque la tabla `ventas` de MySQL ya está limpia.
- c) Porque Sqoop no usa YARN.
- d) Porque deja los datos en el disco local.

<details><summary>Respuesta</summary>

**b).** La pantalla lo dice en *No conviene*: "la tabla ventas de MySQL ya
está limpia, no pasa por el ETL". Sirve para ver la ingesta desde una base.

- a) Escribe texto delimitado en HDFS.
- c) Sqoop lanza un MapReduce de solo maps.
- d) Deja `/user/root/tienda/ventas` en HDFS.
</details>

## Desarrollo

### 1. ¿Por qué conviene partir un proceso de datos en etapas con una salida con nombre cada una, en vez de un solo script de punta a punta?

<details><summary>Respuesta modelo</summary>

Porque permite **rehacer una parte** sin rehacer todo (si el análisis estaba
mal, no hace falta volver a traer ni limpiar), **elegir la herramienta** que
conviene en cada paso (pandas para limpiar poco, Hive para SQL, Sqoop para
una base) y **controlar** entre paso y paso: hay un dato con ruta, formato y
cantidad de filas que se puede revisar (lo que la pantalla muestra en
**Viaja** y en el cable entre etapas). Además deja un historial de qué corrió
y qué dejó, que es el linaje.

Rúbrica: al menos tres ventajas bien explicadas (1 punto cada una), un
ejemplo del sandbox (1).
</details>

### 2. Comparás el **Tardó** del análisis con Hive, Spark SQL y pandas sobre las 97.200 filas limpias. ¿Qué esperás y qué conclusión sacás?

<details><summary>Respuesta modelo</summary>

Pandas debería ser el más rápido: los datos entran en memoria y no hay costo
de arranque. Hive tarda unos segundos en arrancar el trabajo Tez (más si
abre la sesión) y Spark SQL suma la sesión de Spark. La conclusión: con datos
chicos, el costo fijo de una herramienta distribuida (pedir contenedores,
arrancar JVMs) pesa más que el cálculo; esas herramientas valen la pena
cuando los datos no entran en una máquina.

Rúbrica: orden esperado (1), explica el costo fijo (2), conclusión sobre
cuándo conviene cada una (2).
</details>

### 3. ¿Qué es un paso idempotente y por qué importa en un pipeline? Dá un ejemplo del sandbox que lo sea y uno que no.

<details><summary>Respuesta modelo</summary>

Un paso es idempotente si correrlo dos veces deja lo mismo que correrlo una.
Importa porque las etapas fallan y se reintentan: si reintentar duplica o
mezcla datos, el resultado queda mal sin que nadie lo note. `hdfs dfs -put -f`
es idempotente (pisa el archivo). Un wordcount sin *pisar la salida* no lo
es: la segunda vez falla porque la carpeta existe (MapReduce se niega a
escribir encima para no mezclar).

Rúbrica: definición (1), por qué importa (1), los dos ejemplos (2).
</details>

## Ejercicios sobre la interfaz

### Ejercicio 1. El pipeline completo

Con `SERVICIOS=todo`, corré las seis etapas con las herramientas sugeridas
y el análisis *Por producto*. Para cada etapa anotá qué dejó (lo que dice
**Dejó**) y, del historial, cuánto tardó.

<details><summary>Solución</summary>

| Etapa | Herramienta | Dejó |
|---|---|---|
| Ingesta | `hdfs dfs -put` | `/user/root/ml/ventas_sucias.csv` (103.000 filas) |
| ETL | pandas | `/user/root/ml/ventas_limpias` en Parquet |
| Almacenamiento | Tabla externa de Hive | `default.ventas_limpias` |
| Análisis | Hive | `/user/root/resultados/por_producto` |
| Machine Learning | scikit-learn | un modelo (aparece en Machine Learning) |
| Resultados | `hdfs dfs -getmerge` | un CSV en `/datos` (la carpeta `datos/` de tu compu) |

Los tiempos dependen de la máquina.

Rúbrica: cada etapa bien, 1. Un punto extra si nota que ML no usa la salida
del análisis.
</details>

### Ejercicio 2. Dos herramientas, un resultado

Corré el ETL con pandas, anotá **Qué cambió**, y después con PySpark.
¿Coinciden los números? ¿Cuál tardó más y por qué? ¿Cuál aparece en
**Trabajos en YARN**?

<details><summary>Solución</summary>

Los resúmenes tienen que coincidir: `etl_pandas.py` y `etl_spark.py` hacen
exactamente los mismos pasos. PySpark tarda más (la sesión de Spark sola
lleva unos 15 s). Solo PySpark aparece en Trabajos, porque corre en YARN;
pandas corre en una sola máquina, sin YARN.

Rúbrica: coincidencia (2), el más lento con su porqué (2), cuál aparece en
YARN (1).
</details>

### Ejercicio 3. La etapa que falta

Sin haber corrido nada (o después de **Empezar de nuevo** con los archivos
borrados a mano desde HDFS), intentá correr **Análisis**. Copiá el mensaje y
seguí el camino que ofrece la pantalla hasta poder correrlo.

<details><summary>Solución</summary>

El servidor no mira el registro de la interfaz sino lo que hay de verdad en
HDFS y en Hive. Con Hive el mensaje es "Hive necesita la tabla:
Almacenamiento → tabla externa de Hive"; con Spark SQL o pandas, "Primero
limpiá los datos (ETL)". Y si vas a Almacenamiento sin el Parquet: "Primero
limpiá los datos (ETL): no hay nada en /user/root/ml/ventas_limpias". Hay que
correr el ETL, después Almacenamiento (si el análisis va con Hive) y recién
ahí el análisis.

Rúbrica: copia el mensaje (1), sigue el orden correcto (2), nota que
Empezar de nuevo no borra los archivos y que por eso hubo que borrarlos a
mano (1).
</details>
