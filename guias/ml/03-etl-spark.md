# 3. El mismo ETL con Spark

Subir las ventas sucias a HDFS, limpiarlas con `etl_spark.py` (los mismos
ocho pasos de la guía 2, en PySpark) y comprobar que pandas y Spark dan el
mismo resumen, número por número. En el camino: qué cambia cuando los datos
están repartidos.

[← 2. Datos sucios y pandas](02-datos-sucios-pandas.md) · [Índice de ml](README.md) · Siguiente: [4. Modelos con scikit-learn →](04-modelos-sklearn.md)

## Antes de empezar

- La [guía 2](02-datos-sucios-pandas.md) hecha: hace falta
  `ventas_sucias.csv` en `/datos` (y, para comparar, la corrida de
  `etl_pandas.py`).
- `SERVICIOS=todo` (el valor por defecto): Spark corre sobre YARN.
- Lo de Spark que ya sabés de la [guía 8](../08-spark.md) vale igual: driver,
  executors, acciones y transformaciones, las páginas 4040 y 18080.
- Teoría que acompaña: [pandas contra Spark](teoria/08-pandas-vs-spark.md).

## Qué vamos a hacer y por qué

pandas necesita que **toda** la tabla entre en la memoria de una compu.
Spark reparte los datos en **particiones** y cada *executor* procesa las
suyas (en un cluster de verdad, en máquinas distintas): así se procesan datos
que no entrarían en ninguna. Con 100.000 filas no hace falta, pero hacer el
mismo ETL en los dos y comparar es la mejor forma de ver qué cambia en el
código y qué no cambia en el resultado.

## Subir el archivo a HDFS

Spark lee de HDFS (los executors no ven tu carpeta `/datos`, que está en una
sola máquina):

<!-- prueba: adentro | espera: ventas_sucias.csv -->
```bash
hdfs dfs -mkdir -p /user/root/ml
hdfs dfs -put -f ventas_sucias.csv /user/root/ml/
hdfs dfs -ls /user/root/ml
```

Con `BLOCK_SIZE=1m` (el del `docker run` de la guía 1), los ~4,5 MB quedan
en 5 bloques. Se ven en http://localhost:9870, *Utilities → Browse the file
system*, `/user/root/ml/ventas_sucias.csv`.

## Correr el ETL de Spark

<!-- prueba: adentro | espera: filas limpias | espera: 97200 | espera: 1003117916 -->
```bash
spark-submit ejemplos/ml/etl_spark.py 2> etl_spark.log | tee etl_spark.txt
```

- `2> etl_spark.log` manda los mensajes de Spark (muchísimos, en `INFO` y
  `WARN`) a un archivo: en pantalla queda solo lo que imprime el script.
  `| tee etl_spark.txt` lo muestra y lo guarda a la vez.
- Tarda bastante más que pandas (medio minuto o más): pide lugar en YARN,
  arranca los executors y cada `count()` del script es un **job** aparte.
- Mientras corre, abrí http://localhost:4040 → *Jobs*: aparecen de a uno.
  Cuando termina, quedan en http://localhost:18080.

Al principio dice cuántas filas leyó y **en cuántas particiones**. Después
muestra las primeras filas como vienen, cómo quedan, el esquema (`printSchema`)
y el mismo resumen de la guía 2: *filas limpias 97200*, *facturado total
1003117916* y las cuatro sucursales.

Deja el resultado en HDFS, no en `/datos`:

<!-- prueba: adentro | espera: _SUCCESS | espera: .parquet -->
```bash
hdfs dfs -ls /user/root/ml/ventas_limpias
```

Una **carpeta** con un archivo `part-...parquet` por partición y un
`_SUCCESS` vacío que avisa que terminó bien. Así guarda todo lo que
escribe Spark (y MapReduce): cada executor escribe lo suyo, en paralelo.

## Comparar con pandas, número por número

Se corre el de pandas guardando su salida y se comparan los dos resúmenes
(lo que va de `=== RESUMEN` a la primera línea vacía):

<!-- prueba: adentro | espera: pandas y Spark dan lo mismo -->
```bash
python3 ejemplos/ml/etl_pandas.py > etl_pandas.txt
diff <(sed -n '/=== RESUMEN/,/^$/p' etl_pandas.txt) <(sed -n '/=== RESUMEN/,/^$/p' etl_spark.txt) \
  && echo "pandas y Spark dan lo mismo"
```

`diff` no muestra nada si son iguales, y el `&&` imprime el cartel. Es la
misma comparación que hace la prueba de la imagen antes de publicarla.

## Lo que cambia en el código

Abrí `ejemplos/ml/etl_spark.py` en JupyterLab al lado de `etl_pandas.py`. Los
pasos tienen los mismos números:

| Paso | pandas | Spark |
|---|---|---|
| 1. Leer como texto | `pd.read_csv(f, dtype=str)` | `spark.read.csv(f, header=True)` (sin `inferSchema`) |
| 2. Duplicados | `drop_duplicates(subset="ticket")` | `dropDuplicates(["ticket"])` |
| 3. Texto | `.str.strip().str.lower().str.translate(...)` | `F.translate(F.lower(F.trim(c)), "áéíóú", "aeiou")` |
| 4. Fechas | `str.fullmatch(...)` + `pd.to_datetime(..., format="%d/%m/%Y")` | `rlike("^...$")` + `F.when(...).when(...)` con `F.to_date(f, "dd/MM/yyyy")` |
| 5. Números | `str.replace` + `pd.to_numeric` | `F.regexp_replace` + `.cast("double")` |
| 6. Nulos | `fillna("desconocido")` | `fillna({"medio_pago": "desconocido"})` |
| 7. Outliers | `quantile([0.25, 0.75])`, `groupby(...).transform("median")` | `approxQuantile(..., 0)`, `groupBy(...).agg(F.median(...))` + `join` |
| 8. Cargar | `to_parquet(salida)` (un archivo) | `write.mode("overwrite").parquet(salida)` (una carpeta en HDFS) |

Y lo que cambia en la forma de pensar:

- **Nada se modifica.** En pandas, `ventas["fecha"] = ...` cambia la tabla.
  En Spark cada paso devuelve un DataFrame **nuevo**: `ventas =
  ventas.withColumn(...)`.
- **Es perezoso (*lazy*).** `withColumn`, `filter` o `join` no calculan nada:
  agregan instrucciones a un plan. Se calcula recién con una **acción**
  (`count`, `show`, `write`, `first`). Por eso el script, para contar cada
  arreglo, hace un `count()` por paso, y cada uno es un job.
- **No hay orden ni "fila 0".** Las filas están repartidas: si querés un
  orden, se pide (`orderBy`). Por eso el script muestra las filas limpias con
  `orderBy("ticket")`.
- **La mediana por producto es un JOIN.** En pandas, `transform("median")`
  pone la mediana al lado de cada fila. En Spark se calcula una tabla chica
  (un producto por fila) y se junta con las ventas.
- **Leer lo ya guardado.** Al final el script lee el Parquet que acaba de
  escribir en vez de seguir con `ventas`: si no, cada acción volvería a
  calcular todo el plan desde el CSV.

## Mirarlo desde un notebook

En un notebook nuevo, Spark contra el resultado en HDFS:

<!-- prueba: no (celda de JupyterLab) -->
```python
from pyspark.sql import SparkSession, functions as F

spark = SparkSession.builder.appName("mirar el ETL").getOrCreate()
limpias = spark.read.parquet("hdfs:///user/root/ml/ventas_limpias")
limpias.printSchema()
(limpias.groupBy("producto")
        .agg(F.sum("importe").alias("facturado"))
        .orderBy(F.desc("facturado"))
        .show())
```

El esquema viene adentro del Parquet (`fecha` de tipo `date`, `precio` e
`importe` `long`). La tabla de facturado es la misma de la guía 2.

El plan que arma Spark antes de calcular:

<!-- prueba: no (celda de JupyterLab) -->
```python
limpias.filter(F.col("producto") == "yerba").groupBy("sucursal").count().explain()
```

`explain()` no calcula nada: muestra el plan físico. Se lee de abajo hacia
arriba: leer el Parquet (con el filtro ya empujado a la lectura, `PushedFilters`),
agrupar en cada partición, repartir por sucursal (`Exchange`) y terminar de
agrupar.

De Spark a pandas, para comparar las dos tablas fila por fila:

<!-- prueba: no (celda de JupyterLab) -->
```python
import pandas as pd

de_spark = limpias.toPandas().sort_values("ticket").reset_index(drop=True)
de_pandas = pd.read_parquet("ventas_limpias.parquet")
print(len(de_spark), len(de_pandas))
print((de_spark["ticket"].values == de_pandas["ticket"].values).all(),
      (de_spark["importe"].values == de_pandas["importe"].values).all())
spark.stop()
```

`toPandas()` trae **todo** al driver (tu notebook): está bien para 97.200
filas, pero con datos grandes de verdad no entraría. Es el puente entre los
dos mundos: lo pesado en Spark, el resultado chico a pandas. La fecha llega
como objeto `date` de Python (en pandas era `datetime64`).

## ¿Cuál conviene?

| | pandas | Spark |
|---|---|---|
| Dónde corre | En la memoria de una compu | Repartido en executors (varias máquinas) |
| Con 100.000 filas | Un par de segundos | Medio minuto o más (repartir tiene un costo fijo) |
| Límite | La RAM de la compu | Agregar máquinas |
| Resultado | Un archivo | Una carpeta con un archivo por partición |
| Para | Explorar, prototipos, datos de hasta unos pocos GB | Datos que no entran en una compu, procesos que corren todos los días sobre HDFS |

La [teoría 8](teoria/08-pandas-vs-spark.md) lo desarrolla.

## Qué hiciste

- Subiste el CSV sucio a HDFS y lo limpiaste con `spark-submit
  ejemplos/ml/etl_spark.py`, que dejó un Parquet en `/user/root/ml/ventas_limpias`.
- Comprobaste con `diff` que pandas y Spark dan el mismo resumen.
- Viste el plan perezoso con `explain()` y pasaste el resultado a pandas con
  `toPandas()`.

Siguiente: [4. Modelos con scikit-learn →](04-modelos-sklearn.md)
