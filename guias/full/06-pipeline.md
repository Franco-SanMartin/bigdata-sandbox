# 6. Pipeline: de los datos sucios al resumen y al modelo

Recorrer un pipeline de datos completo en seis etapas (ingesta, ETL,
almacenamiento, análisis, machine learning y resultados) eligiendo en cada
una la herramienta, y ver qué entra, qué hace y qué sale. Junta lo de las
guías 3, 4, 6, 7 y 8 de la materia con la limpieza de datos de `ml`.

[← 5. Lenguajes, Bases y Tablas](05-consultas.md) · [Índice de full](README.md) · Siguiente: [7. Machine Learning →](07-machine-learning.md)

La pantalla es **Pipeline** (`G P`). Casi todas las herramientas necesitan
`SERVICIOS=todo` (Python, Spark y Hive); con menos, las que no se pueden usar
aparecen con un candado y el motivo. Los comandos equivalentes van **adentro**
del contenedor, parado en `/datos`.

![Pipeline: el riel de 6 etapas, la herramienta elegida en cada una y la corrida con lo que entró y lo que salió](../../docs/capturas/pipeline.png)

## Paso 1. La pantalla

**Qué se ve.** El título *Pipeline* con "N de 6 etapas" y el botón **Empezar
de nuevo**. A la derecha, el **Riel** ("de ventas_sucias.csv al resumen"): las
seis etapas en fila, cada una con su estado (*sin hacer*, *corriendo*,
*hecha*, *falló*), la herramienta que usó y lo que dejó; entre etapa y etapa,
un cable con las filas que pasaron. Abajo del riel: **Trabaja** (qué está
corriendo), **Ahora**, **Siguiente** ("— necesita …") y **Viaja**: la ruta, el
formato, las filas y el tamaño del dato que va pasando.

En el centro, la etapa elegida (descripción, **entra** → **sale**,
**Necesita …**, las herramientas), la última **Corrida** y el **Historial**
con todas las corridas.

**Qué significa.** Un pipeline es una cadena: cada etapa usa lo que dejó la
anterior. La interfaz no deja correr una etapa sin su entrada: si falta, el
error dice qué falta y ofrece **Ir a** la etapa anterior.

## Paso 2. Ingesta: traer los datos a HDFS

**Qué se ve.** Entra "ventas_sucias.csv en la carpeta local"; sale
`/user/root/ml/ventas_sucias.csv en HDFS`. Dos herramientas:

| Herramienta | Motor | Conviene | No conviene |
|---|---|---|---|
| `hdfs dfs -put` (sugerida) | Cliente HDFS | El dato ya es un archivo (un CSV que te pasaron): se copia tal cual, cortado en bloques | Si el dato vive en una base: ahí conviene Sqoop |
| Sqoop import (MySQL → HDFS) | MapReduce | El dato está en una base relacional: Sqoop lanza un MapReduce con 4 mappers que leen la tabla en paralelo | Para este pipeline: la tabla ventas de MySQL ya está limpia, no pasa por el ETL |

**Qué hacer.** Dejá `hdfs dfs -put` y **Correr hdfs dfs -put**.

**Qué pasa.** Si `ventas_sucias.csv` no está en `/datos`, primero lo genera
(`python3 ejemplos/ml/generar_sucios.py`, 103.000 filas) y después lo sube.
La corrida muestra el avance, "N filas en /user/root/ml/ventas_sucias.csv" y,
en el trace, la acción: "Lo corta en bloques y cada bloque viaja por la
tubería de DataNodes".

**En la terminal.**

<!-- prueba: no (sube un archivo de varios MB a HDFS; lo hace la guía 3 de la materia) -->
```bash
python3 ejemplos/ml/generar_sucios.py
hdfs dfs -mkdir -p /user/root/ml
hdfs dfs -put -f ventas_sucias.csv /user/root/ml/
```

Con Sqoop, la acción es "MapReduce sin reduce: N mappers leen la tabla por
rangos de id y escriben en HDFS" (la opción **Mappers (-m)** va de 1 a 8) y
deja `/user/root/tienda/ventas`. Ese camino no sigue al ETL.

## Paso 3. ETL: limpiar

**Qué se ve.** "Limpiar: fechas en tres formatos, precios con coma,
duplicados, faltantes". Entra `ventas_sucias.csv · csv`; sale
`/user/root/ml/ventas_limpias · Parquet`. Cuatro herramientas, dos
disponibles:

| Herramienta | Motor | Conviene | No conviene |
|---|---|---|---|
| pandas (sugerida) | Una sola máquina | 4,5 MB entran de sobra en la memoria de una máquina: pandas lo limpia en un par de segundos y sin YARN | Cuando el archivo no entra en la memoria de una máquina (decenas de GB) |
| PySpark | Spark | Los mismos pasos que pandas, repartidos en executors de YARN: es lo que escala a datos grandes | Con 4,5 MB tarda mucho más que pandas: la sesión de Spark sola lleva 15 segundos |
| Pig | MapReduce | — | No disponible: "No hay un script de ETL para ventas_sucias en la imagen" |
| Hive (INSERT … SELECT) | Tez | — | No disponible, mismo motivo |

**Qué hacer.** **Correr pandas**.

**Qué se ve.** En la corrida, **Qué cambió**: el resumen que imprime el
script (filas leídas, duplicados eliminados, fechas convertidas, filas
limpias, facturado total...). El mensaje queda como "103.000 → N filas, en
Parquet" y el trace muestra **Antes** (las primeras filas sucias) y
**Después**.

**Qué significa.** Las dos herramientas hacen **exactamente** lo mismo
(`etl_pandas.py` y `etl_spark.py` tienen que dar el mismo resumen). Ojo con
un detalle: pandas lee el CSV de la **carpeta local** `/datos`, no de HDFS (el
trace lo dice: "lo lee de la carpeta local, no de HDFS"), y después sube el
Parquet; PySpark lee de HDFS y escribe en HDFS desde los executors. Es la
diferencia entre una herramienta de una máquina y una distribuida.

**En la terminal.**

<!-- prueba: no (necesita SERVICIOS=todo; lo recorre la guía de ml) -->
```bash
python3 ejemplos/ml/etl_pandas.py
spark-submit --master yarn ejemplos/ml/etl_spark.py
```

## Paso 4. Almacenamiento: dejarlo consultable

**Qué se ve.** Entra el Parquet; sale "tabla default.ventas_limpias o los
Parquet".

| Herramienta | Conviene | No conviene |
|---|---|---|
| Tabla externa de Hive (sugerida) | Para consultarlo con SQL: Hive anota en el Metastore dónde están los archivos y qué columnas tienen, sin moverlos | Si solo lo vas a leer desde Spark o pandas: alcanza con los archivos |
| Archivos Parquet en HDFS | Parquet guarda por columna y comprimido: Spark y pandas leen solo las columnas que usan | Si querés SQL desde Hive: le falta la tabla |

**Qué significa.** "Almacenar" en Big Data casi nunca es copiar a una base:
los datos ya están en HDFS. Lo que se agrega es la **descripción** (el
esquema) en el Metastore para que un motor SQL los encuentre.

<!-- prueba: no (necesita que el ETL haya corrido) -->
```bash
hdfs dfs -ls /user/root/ml/ventas_limpias
```

## Paso 5. Análisis: resumir

**Qué se ve.** "Resumir: facturado por sucursal, producto, mes o medio de
pago", con la opción **Agrupar por** (*Por sucursal*, *Por producto*, *Por
mes*, *Por medio de pago*). Sale `/user/root/resultados/por_<campo>`.

| Herramienta | Motor | Conviene | No conviene |
|---|---|---|---|
| Hive (sugerida) | Tez | SQL de siempre sobre archivos de HDFS: HiveServer2 lo convierte en un trabajo Tez | Para algo interactivo y chico: arrancar el trabajo Tez lleva unos segundos |
| Spark SQL | Spark | El mismo SQL, en executors de Spark: conviene si después seguís con Spark | Para una sola consulta chica: la sesión de Spark tarda más que la consulta |
| pandas | Una sola máquina | 97.200 filas entran en memoria: groupby tarda milisegundos | Cuando los datos no entran en una máquina |

**Qué hacer.** Corré el mismo análisis con Hive y con Spark SQL y compará el
**Tardó** del historial y lo que aparece en Trabajos.

**En la terminal.** El SQL de *Por producto*:

<!-- prueba: no (necesita la tabla ventas_limpias) -->
```bash
beeline -u jdbc:hive2://localhost:10000 -e "SELECT producto, SUM(cantidad) AS unidades, SUM(importe) AS facturado FROM ventas_limpias GROUP BY producto ORDER BY facturado DESC"
spark-sql -e "SELECT producto, SUM(cantidad) AS unidades, SUM(importe) AS facturado FROM ventas_limpias GROUP BY producto ORDER BY facturado DESC"
```

## Paso 6. Machine Learning: una rama aparte

**Qué se ve.** "Entrenar un modelo. Usa clientes_senal.csv: en las ventas no
hay nada que predecir con señal". En el riel, el cable que entra a esta etapa
dice *clientes_senal.csv* y el que sale, "el resumen sigue desde análisis".

| Herramienta | Problema | Conviene | No conviene |
|---|---|---|---|
| scikit-learn (sugerida) | Regresión: cuánto gasta / Clasificación: si vuelve / Agrupamiento: qué grupos hay | 20.000 filas: entrena en milisegundos en una máquina | Cuando los datos no entran en memoria |
| Spark MLlib | Regresión / Clasificación / Agrupamiento | Los mismos modelos, repartidos en executors | Con 20.000 filas: pide 3 GB a YARN y tarda mucho más |

**Qué significa.** Un pipeline real no es siempre una línea: acá el modelo usa
otro conjunto de datos, porque las ventas generadas no tienen una relación que
un modelo pueda aprender. El modelo entrenado aparece en **Machine Learning**
(el botón **Modelo** de la corrida lleva ahí) y se explica en la
[guía 7](07-machine-learning.md).

<!-- prueba: no (necesita SERVICIOS=todo; lo recorre la guía de ml) -->
```bash
python3 ejemplos/ml/modelos_sklearn.py
```

## Paso 7. Resultados: llevarlo a donde se usa

**Qué se ve.** "Llevar el resumen a donde se usa: un CSV o una tabla de
MySQL". Sale "un CSV local o tienda.resumen_<campo>".

| Herramienta | Motor | Conviene | No conviene |
|---|---|---|---|
| `hdfs dfs -getmerge` (sugerida) | Cliente HDFS | Junta las partes del resultado en un solo CSV local, para abrirlo en una planilla | Si el resultado lo tiene que leer otra aplicación desde una base |
| Sqoop export (HDFS → MySQL) | MapReduce | El resumen lo consume una aplicación que lee MySQL | Para mirarlo una vez: getmerge es inmediato |

**Qué significa.** El resultado de un trabajo distribuido son **varios
archivos** (`part-…`, uno por reducer o tarea). `getmerge` los junta en uno
solo en `/datos`, que ves en la carpeta `datos/` de tu compu. Sqoop export
hace el camino inverso del import: de HDFS a una tabla de MySQL, que después
podés consultar en [Lenguajes](05-consultas.md).

<!-- prueba: no (necesita el resumen del análisis) -->
```bash
hdfs dfs -getmerge /user/root/resultados/por_producto por_producto.csv
```

## Paso 8. La corrida y el historial

**Qué se ve.** El panel **Corrida pN** con la etapa y la herramienta, el
estado (*Corriendo*, *Terminó*, *Falló*), la barra de avance con el mensaje
("Esperando contenedores de YARN", "Arrancando el ApplicationMaster",
"Corriendo en YARN (N %)"...), **Motor**, **Empezó**, **Tardó**, **YARN** (el
id del trabajo, que lleva a Trabajos), **Dejó** (ruta, filas y tamaño) y el
trace completo. Si terminó bien, **Seguir con <la etapa siguiente>**.

El **Historial** ("todas las corridas, la última arriba") tiene Corrida,
Etapa, Herramienta, Estado, Tardó y Salida; un clic en una fila la vuelve a
abrir.

**Qué significa.** Cada corrida corre de verdad con las herramientas de la
imagen; lo que imprime queda en la [Consola](10-consola.md) con el comando
exacto.

## Paso 9. Empezar de nuevo

**Qué hacer.** **Empezar de nuevo**.

**Qué se ve.** Una confirmación: "El riel vuelve a la primera etapa y se
vacía el historial de corridas. Lo que ya está en HDFS, Hive y MySQL queda
como estaba.", con *Etapas hechas*, *Corridas* y "Equivale a POST
/api/pipeline/reset".

**Qué significa.** Reiniciar el pipeline solo borra el **registro** de la
interfaz. Los archivos, la tabla y el resumen exportado siguen ahí; si querés
borrarlos, es con `hdfs dfs -rm -r` y `DROP TABLE`, como siempre.

## Dónde se usa esto en la industria

Lo que hace esta pantalla a mano lo hacen los **orquestadores**: **Apache
Airflow** (el más usado), **Apache NiFi** (para ingesta), **Oozie** (el
clásico de Hadoop, que Ambari y Cloudera Manager traían integrado), **Dagster**
o **Prefect**. Todos dibujan las etapas como un grafo, guardan cada corrida
con su log y no corren una etapa si la anterior falló. La teoría está en
[pipelines](teoria/pipelines.md).
