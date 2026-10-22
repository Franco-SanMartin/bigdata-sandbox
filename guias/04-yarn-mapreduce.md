# 4. YARN y MapReduce

El modelo MapReduce, primero sin Hadoop (para entenderlo) y después en el
cluster: el clásico *wordcount* en Java y las ventas por producto en Python
con Hadoop Streaming.

[← 3. HDFS](03-hdfs.md) · [Índice](README.md) · Siguiente: [5. Pig →](05-pig.md)

Todo va **adentro** del contenedor, parado en `/datos`. Hace falta haber subido
las ventas a `/user/root/ventas` ([guía 3](03-hdfs.md#un-dataset-de-verdad-200000-ventas)).

## Quién hace qué

- **YARN** reparte la memoria y la CPU del cluster entre los trabajos. Su
  *ResourceManager* tiene la página http://localhost:8088: ahí aparece
  **todo** trabajo que corra (MapReduce, Pig, Hive, Spark, Sqoop).
- **MapReduce** es un modelo en tres pasos:
  1. **map**: cada *mapper* lee un pedazo de la entrada (un bloque de HDFS) y
     emite pares *clave → valor*.
  2. **shuffle**: Hadoop junta y ordena todos los pares por clave.
  3. **reduce**: cada *reducer* recibe todos los valores de una clave y los
     resume (suma, cuenta...).

## MapReduce sin Hadoop

`ejemplos/mapper.py` y `ejemplos/reducer.py` calculan las ventas por producto.
Son Python común: leen líneas por la entrada estándar y escriben líneas. Se
pueden probar con una tubería, donde `sort` hace de *shuffle*:

<!-- prueba: adentro | espera: yerba	9	22500 -->
```bash
head -4 ejemplos/ventas.csv | python3 ejemplos/mapper.py
echo ----
cat ejemplos/ventas.csv | python3 ejemplos/mapper.py | sort | python3 ejemplos/reducer.py
```

```text
yerba	3	7500
mate	1	8000
yerba	5	12500
----
bombilla	2	6000
mate	3	24000
termo	1	35000
yerba	9	22500
```

El mapper emite `producto  cantidad  importe` por cada venta; el reducer
suma mientras el producto no cambia.

## Wordcount en el cluster

El ejemplo clásico, que viene con Hadoop (en Java): cuántas veces aparece cada
palabra en `ejemplos/texto.txt`.

<!-- prueba: adentro | espera: datos -->
```bash
hdfs dfs -put -f ejemplos/texto.txt /user/root/
hdfs dfs -rm -r -f /user/root/wc-out
hadoop jar $HADOOP_HOME/share/hadoop/mapreduce/hadoop-mapreduce-examples-3.3.6.jar \
  wordcount /user/root/texto.txt /user/root/wc-out
hdfs dfs -ls /user/root/wc-out
hdfs dfs -cat /user/root/wc-out/part-r-00000
```

- Mientras corre, en http://localhost:8088 aparece como `word count`, tipo
  `MAPREDUCE`. Terminado, su detalle (mappers, reducers, tiempos, logs) está
  en http://localhost:19888.
- `datos 3`: "datos" aparece en 3 de las 4 líneas.
- MapReduce **no pisa** resultados: si la carpeta de salida ya existe, falla
  con `Output directory ... already exists`. Por eso el `-rm -r -f` de antes.
- La salida es una carpeta: un `part-r-NNNNN` por reducer y un `_SUCCESS`
  vacío que dice que terminó bien.

## Ventas por producto con Hadoop Streaming

Streaming corre **cualquier programa** como mapper y reducer: los mismos dos
scripts de Python de antes, ahora sobre las 200.000 ventas y repartidos en el
cluster. `-files` manda los scripts a cada nodo.

<!-- prueba: adentro | espera: 448780000 -->
```bash
hdfs dfs -rm -r -f /user/root/resultados/mr_por_producto
hadoop jar $HADOOP_HOME/share/hadoop/tools/lib/hadoop-streaming-3.3.6.jar \
  -files ejemplos/mapper.py,ejemplos/reducer.py \
  -mapper "python3 mapper.py" -reducer "python3 reducer.py" \
  -input /user/root/ventas -output /user/root/resultados/mr_por_producto
hdfs dfs -cat /user/root/resultados/mr_por_producto/part-*
```

Tiene que dar (producto, unidades, facturado; el orden puede variar):

```text
azucar	89796	107755200
bombilla	36281	108843000
cafe	29471	191561500
facturas	121087	108978300
galletitas	82979	149362200
mate	48154	385232000
termo	11793	412755000
yerba	179512	448780000
```

Mirá en el log del trabajo la línea `number of splits:6`: hubo 6 mappers, uno
por cada bloque de 1 MB del archivo ([guía 3](03-hdfs.md#bloques-y-réplicas)).
Con el bloque de 128 MB habría sido uno solo.

Estos mismos números tienen que salir con Pig, Hive y Spark en las guías que
siguen: es el mismo cálculo con cuatro herramientas.

## YARN desde la terminal

<!-- prueba: adentro | espera: RUNNING | espera: FINISHED -->
```bash
yarn node -list
yarn application -list -appStates FINISHED
```

| Comando | Qué hace |
|---|---|
| `yarn node -list` | Los NodeManagers (acá, uno) |
| `yarn application -list` | Los trabajos que están corriendo |
| `yarn application -list -appStates FINISHED` | Los que terminaron |
| `yarn application -kill <id>` | Corta un trabajo (el id es `application_...`) |
| `yarn logs -applicationId <id>` | Los logs de un trabajo terminado |
| `mapred job -list` | Los trabajos MapReduce corriendo |
