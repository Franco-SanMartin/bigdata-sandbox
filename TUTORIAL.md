# Tutorial: de cero a procesar un dataset con MapReduce, Pig, Hive y Spark

Paso a paso, desde una compu sin nada hasta procesar un dataset de 200.000
ventas con las cuatro herramientas del stack y comparar los resultados. Al
final, cómo hacer lo mismo con **tu propio** CSV.

Cada paso dice qué escribir, qué tenés que ver y qué está pasando por abajo.
Para el detalle de cada parámetro y experimento está el [README](README.md).

> **Dónde se escribe cada comando**
> - `PS>` / `C:\>` / `$` sin más: en la terminal de **tu compu** (PowerShell,
>   CMD, o la de Mac/Linux).
> - `root@...:/datos#`: **adentro** del contenedor (después del paso 4).
> - `grunt>`: adentro de Pig interactivo. `0: jdbc:hive2://...>`: adentro de
>   Hive (beeline). `>>>`: adentro de pyspark.
>
> En los bloques de código el prompt no aparece: se copia la línea tal cual.

**Índice**

1. [Instalar Docker](#1-instalar-docker)
2. [Conseguir la imagen](#2-conseguir-la-imagen)
3. [Crear el cluster](#3-crear-el-cluster)
4. [Mirar la arquitectura y entrar](#4-mirar-la-arquitectura-y-entrar)
5. [El dataset de prueba](#5-el-dataset-de-prueba)
6. [Subirlo a HDFS](#6-subirlo-a-hdfs)
7. [MapReduce con Python (Hadoop Streaming)](#7-mapreduce-con-python-hadoop-streaming)
8. [Pig](#8-pig)
9. [Hive](#9-hive)
10. [Spark](#10-spark)
11. [Comparar los cuatro resultados](#11-comparar-los-cuatro-resultados)
12. [Bajar los resultados a tu compu](#12-bajar-los-resultados-a-tu-compu)
13. [Romper cosas: se cae un DataNode](#13-romper-cosas-se-cae-un-datanode)
14. [Con tu propio dataset](#14-con-tu-propio-dataset)
15. [Apagar, prender y empezar de cero](#15-apagar-prender-y-empezar-de-cero)

---

## 1. Instalar Docker

1. Instalá **Docker Desktop** (Windows o Mac) desde https://www.docker.com/products/docker-desktop/.
   En Linux alcanza con Docker Engine.
2. Abrilo y esperá a que diga *Engine running*.
3. *Settings → Resources → Memory*: ponele **6 GB** o más (8 GB si tenés 16 GB
   de RAM). Es lo que más influye en que todo ande liso.
4. Probá en una terminal:

```bash
docker version
```

Tienen que aparecer dos bloques, *Client* y *Server*. Si dice que no se puede
conectar al *daemon*, Docker Desktop no está abierto.

## 2. Conseguir la imagen

Una sola vez. La forma más simple:

```bash
docker pull ghcr.io/franki-678/bigdata-sandbox
docker tag ghcr.io/franki-678/bigdata-sandbox bigdata-sandbox
```

- Baja ~1,5 GB. Sirve para Windows, Linux y Mac (Intel o M1–M4).
- El `tag` le pone el nombre corto `bigdata-sandbox`, que es el que usa todo el
  tutorial.
- ¿Toda la clase con el mismo wifi? Que la baje uno solo y la pase por pendrive
  (`docker save` / `docker load`, README sección 2B).

Comprobá que está:

```bash
docker images bigdata-sandbox
```

## 3. Crear el cluster

Primero creá una carpeta de trabajo y parate en ella (por ejemplo
`C:\bigdata` o `~/bigdata`). Ahí va a aparecer `datos/`: lo que pongas en
`datos/` lo ve el cluster en `/datos`, y al revés.

```bash
mkdir bigdata
cd bigdata
```

Ahora el `docker run`. Para el tutorial usamos **3 DataNodes**, cada bloque
**replicado 2 veces** y **bloques de 1 MB** (en la vida real son de 128 MB;
chicos se ven mejor: el dataset de prueba queda partido en 6 bloques).

**Mac / Linux:**

```bash
docker run -d --name bigdata \
  -e DATANODES=3 -e REPLICATION=2 -e BLOCK_SIZE=1m \
  -p 9870-9872:9870-9872 -p 9868:9868 -p 9901-9909:9901-9909 -p 8480-8482:8480-8482 \
  -p 8088:8088 -p 8042:8042 -p 19888:19888 \
  -p 10000:10000 -p 10002:10002 -p 18080:18080 -p 4040:4040 \
  -v bigdata_hadoop:/hadoop \
  -v "$(pwd)/datos:/datos" \
  bigdata-sandbox
```

**Windows, PowerShell** (una sola línea):

```powershell
docker run -d --name bigdata -e DATANODES=3 -e REPLICATION=2 -e BLOCK_SIZE=1m -p 9870-9872:9870-9872 -p 9868:9868 -p 9901-9909:9901-9909 -p 8480-8482:8480-8482 -p 8088:8088 -p 8042:8042 -p 19888:19888 -p 10000:10000 -p 10002:10002 -p 18080:18080 -p 4040:4040 -v bigdata_hadoop:/hadoop -v "${PWD}/datos:/datos" bigdata-sandbox
```

**Windows, CMD** (una sola línea):

```bat
docker run -d --name bigdata -e DATANODES=3 -e REPLICATION=2 -e BLOCK_SIZE=1m -p 9870-9872:9870-9872 -p 9868:9868 -p 9901-9909:9901-9909 -p 8480-8482:8480-8482 -p 8088:8088 -p 8042:8042 -p 19888:19888 -p 10000:10000 -p 10002:10002 -p 18080:18080 -p 4040:4040 -v bigdata_hadoop:/hadoop -v "%cd%\datos:/datos" bigdata-sandbox
```

> ¿Ya tenías un contenedor `bigdata` de antes? Docker va a decir que el nombre
> está en uso. Borralo con `docker rm -f bigdata` (tus datos de HDFS quedan en
> el volumen) y repetí el `docker run`.

Seguí el arranque:

```bash
docker logs -f bigdata
```

Vas a ver cómo se formatea HDFS, arrancan los DataNodes, YARN, Hive y Spark. A
los 1–2 minutos aparece el cartel **Cluster LISTO** con la lista de procesos.
Salís del log con `Ctrl+C` (el cluster sigue prendido).

`docker run` es **una sola vez**. Los días siguientes: `docker start bigdata`
y `docker stop bigdata` (paso 15).

## 4. Mirar la arquitectura y entrar

Abrí en el navegador:

| Página                     | Qué ver ahora                                             |
|----------------------------|-----------------------------------------------------------|
| http://localhost:9870      | NameNode. *Datanodes*: los 3 DataNodes, vivos              |
| http://localhost:8088      | YARN: acá van a aparecer todos los trabajos del tutorial  |
| http://localhost:19888     | Historial de los trabajos MapReduce (incluye Pig)         |
| http://localhost:18080     | Historial de Spark                                        |
| http://localhost:10002     | HiveServer2: sesiones y queries                           |

Entrá al cluster:

```bash
docker exec -it bigdata bash
```

El prompt cambia a `root@...:/datos#`: estás **adentro**, parado en `/datos`
(tu carpeta `datos/`). Mirá qué hay corriendo:

```bash
estado
```

Lista cada proceso (NameNode, Secondary NameNode, los 3 DataNodes,
ResourceManager, NodeManager, JobHistory, Metastore, HiveServer2, Spark
History) con su estado y su página web. Pig no es un servicio: es un comando
que manda trabajos a YARN.

```bash
ls ejemplos
```

```
generar_ventas.py  mapper.py  reducer.py  texto.txt  ventas.csv
ventas.hql  ventas.pig  ventas.py  wordcount.pig
```

| Archivo              | Qué es                                                   |
|----------------------|----------------------------------------------------------|
| `ventas.csv`         | 7 ventas, para mirar a ojo                               |
| `generar_ventas.py`  | Genera un dataset de ventas del tamaño que quieras        |
| `mapper.py`, `reducer.py` | Ventas por producto en **MapReduce** (Python)       |
| `ventas.pig`         | Lo mismo en **Pig**                                      |
| `ventas.hql`         | Lo mismo en **Hive** (SQL), y además por sucursal         |
| `ventas.py`          | Lo mismo en **Spark** (PySpark)                           |
| `texto.txt`, `wordcount.pig` | El clásico wordcount                             |

También los ves desde tu compu, en `datos/ejemplos/`: los podés abrir y editar
con cualquier editor.

## 5. El dataset de prueba

```bash
head ejemplos/ventas.csv
```

```
fecha,sucursal,producto,cantidad,precio
2026-10-01,Centro,yerba,3,2500
2026-10-01,Norte,mate,1,8000
...
```

Una venta por fila: cuándo, en qué sucursal, qué producto, cuántas unidades y
a qué precio. Siete filas no son Big Data; generamos 200.000:

```bash
python3 ejemplos/generar_ventas.py
```

```
Listo: 200000 filas en ventas_grandes.csv (5.9 MB)
```

```bash
head -4 ventas_grandes.csv
wc -l ventas_grandes.csv
```

```
fecha,sucursal,producto,cantidad,precio
2026-01-31,Sur,azucar,5,1200
2026-06-15,Centro,bombilla,5,3000
2026-06-09,Oeste,galletitas,5,1800
200001 ventas_grandes.csv
```

200.000 ventas + el encabezado. La semilla es fija: a todos les sale **el mismo
archivo** y los mismos resultados, así se pueden comparar. Para otro tamaño:
`python3 ejemplos/generar_ventas.py 1000000` (1 millón de filas, ~30 MB).

> **La pregunta que vamos a contestar con las cuatro herramientas:**
> ¿cuántas unidades se vendieron y cuánto se facturó de cada producto?
> (facturado = suma de cantidad × precio)

## 6. Subirlo a HDFS

Hasta acá el archivo está en el disco "normal" (`/datos`). Las herramientas de
Big Data leen de **HDFS**, el sistema de archivos distribuido. Le damos su
propia carpeta (Hive y Spark leen *carpetas*, no archivos sueltos):

```bash
hdfs dfs -mkdir -p /user/root/ventas
hdfs dfs -put ventas_grandes.csv /user/root/ventas/
hdfs dfs -ls /user/root/ventas
```

```
-rw-r--r--   2 root supergroup    6213191 2026-10-13 12:00 /user/root/ventas/ventas_grandes.csv
```

El `2` es la replicación: hay dos copias. ¿De qué? De cada **bloque**:

```bash
hdfs fsck /user/root/ventas/ventas_grandes.csv -files -blocks -locations
```

```
/user/root/ventas/ventas_grandes.csv 6213191 bytes, replicated: replication=2, 6 block(s):  OK
0. BP-...:blk_1073741830_1006 len=1048576 Live_repl=2  [DatanodeInfoWithStorage[127.0.0.1:9913,...], DatanodeInfoWithStorage[127.0.0.1:9911,...]]
1. BP-...:blk_1073741831_1007 len=1048576 Live_repl=2  [...]
...
```

- El archivo quedó partido en **6 bloques** de 1 MB (el último, más chico).
- Cada bloque está en **2 DataNodes distintos** (`:9911` es el DataNode 1,
  `:9912` el 2, `:9913` el 3).
- En la web: http://localhost:9870 → *Utilities → Browse the file system* →
  `user/root/ventas` → clic en el archivo → *Block information*.

Esto es lo que hace que Big Data escale: cada bloque se puede procesar en
paralelo, en la máquina donde está guardado.

Subí también el texto del wordcount:

```bash
hdfs dfs -put ejemplos/texto.txt /user/root/
```

Comandos de HDFS que vas a usar siempre:

```bash
hdfs dfs -ls /user/root              # listar
hdfs dfs -cat /user/root/texto.txt   # ver un archivo
hdfs dfs -head /user/root/ventas/ventas_grandes.csv   # el primer KB
hdfs dfs -du -h /user/root           # cuánto ocupa
hdfs dfs -rm -r /user/root/algo      # borrar
hdfs dfs -get /user/root/algo .      # bajar a /datos
```

## 7. MapReduce con Python (Hadoop Streaming)

MapReduce es el modelo original de Hadoop. Normalmente se programa en Java,
pero con **Hadoop Streaming** el mapper y el reducer pueden ser cualquier
programa que lea líneas y escriba líneas. Los nuestros son Python:

- `mapper.py`: por cada venta escribe `producto <TAB> cantidad <TAB> importe`.
- Hadoop **ordena y agrupa** todo por la primera columna (el *shuffle*).
- `reducer.py`: recibe todas las líneas de un producto juntas y las suma.

### 7.1 Probarlos sin Hadoop

Antes de mandar nada al cluster, se prueban con una tubería de Linux (el
`sort` hace de *shuffle*):

```bash
head -5 ejemplos/ventas.csv | python3 ejemplos/mapper.py
```

```
yerba	3	7500
mate	1	8000
yerba	5	12500
bombilla	2	6000
```

```bash
cat ejemplos/ventas.csv | python3 ejemplos/mapper.py | sort | python3 ejemplos/reducer.py
```

```
bombilla	2	6000
mate	3	24000
termo	1	35000
yerba	9	22500
```

### 7.2 Correrlo en el cluster

```bash
hadoop jar $HADOOP_HOME/share/hadoop/tools/lib/hadoop-streaming-3.3.6.jar \
  -files ejemplos/mapper.py,ejemplos/reducer.py \
  -mapper "python3 mapper.py" -reducer "python3 reducer.py" \
  -input /user/root/ventas -output /user/root/resultados/mr_por_producto
```

- `-files` copia los dos scripts a cada nodo que los va a correr.
- Mientras corre, mirá http://localhost:8088: aparece un trabajo **MAPREDUCE**.
- En la salida: `number of splits:6` → **6 mappers**, uno por bloque.

```bash
hdfs dfs -ls /user/root/resultados/mr_por_producto
hdfs dfs -cat /user/root/resultados/mr_por_producto/part-00000
```

```
azucar	89796	107755200
bombilla	36281	108843000
cafe	29471	191561500
facturas	121087	108978300
galletitas	82979	149362200
mate	48154	385232000
termo	11793	412755000
yerba	179512	448780000
```

Sale ordenado por producto porque así lo ordenó el *shuffle*. El `_SUCCESS`
de la carpeta indica que el trabajo terminó bien.

Después, en http://localhost:19888 está el trabajo terminado: cuánto tardó
cada mapper, cuántas líneas leyó, sus logs.

> Un trabajo MapReduce **no pisa** una carpeta de salida que ya existe. Para
> correrlo de nuevo: `hdfs dfs -rm -r /user/root/resultados/mr_por_producto`.

### 7.3 El wordcount clásico (Java)

```bash
hadoop jar $HADOOP_HOME/share/hadoop/mapreduce/hadoop-mapreduce-examples-3.3.6.jar \
  wordcount /user/root/texto.txt /user/root/wc-out
hdfs dfs -cat /user/root/wc-out/part-r-00000
```

## 8. Pig

Pig es un lenguaje (**Pig Latin**) para describir el procesamiento paso a
paso: cargar, filtrar, agrupar, sumar, ordenar. Pig lo traduce a trabajos
MapReduce y los manda a YARN. Escribís 10 líneas en vez de un mapper y un
reducer.

### 8.1 Correr el script

```bash
cat ejemplos/ventas.pig      # leelo: cada paso está comentado
pig ejemplos/ventas.pig
```

Pig escribe bastante log. Al final:

```
Success!
...
Output(s):
Successfully stored 8 records (...) in: "/user/root/resultados/pig_por_producto"
```

En http://localhost:8088 vas a ver que generó **varios** trabajos MapReduce
encadenados (el GROUP es uno; el ORDER necesita otros dos: uno para muestrear
y otro para ordenar).

```bash
hdfs dfs -cat /user/root/resultados/pig_por_producto/part-*
```

```
yerba,179512,448780000
termo,11793,412755000
mate,48154,385232000
cafe,29471,191561500
galletitas,82979,149362200
facturas,121087,108978300
bombilla,36281,108843000
azucar,89796,107755200
```

Mismos números que MapReduce, ordenados de mayor a menor facturación.

Los scripts aceptan **parámetros** (`%default` en el script):

```bash
pig -param salida=/user/root/resultados/otra_prueba ejemplos/ventas.pig
```

### 8.2 Pig interactivo (grunt)

Para explorar, Pig tiene su propia consola:

```bash
pig
```

```
grunt>
```

Probá de a una línea:

```pig
ventas = LOAD '/user/root/ventas' USING PigStorage(',') AS (fecha:chararray, sucursal:chararray, producto:chararray, cantidad:int, precio:int);
DESCRIBE ventas;
primeras = LIMIT ventas 5;
DUMP primeras;
```

- `DESCRIBE` muestra el esquema. No corre nada.
- `DUMP` **sí** corre (un trabajo en YARN) y muestra el resultado por
  pantalla: `(2026-01-31,Sur,azucar,5,1200)`...
- Pig es *lazy*: las líneas con `=` solo arman el plan. Recién `DUMP` o
  `STORE` lo ejecutan.

Ventas grandes de la sucursal Norte:

```pig
norte = FILTER ventas BY sucursal == 'Norte' AND cantidad >= 5;
por_prod = GROUP norte BY producto;
cuenta = FOREACH por_prod GENERATE group, COUNT(norte);
DUMP cuenta;
EXPLAIN cuenta;
```

`EXPLAIN` muestra cómo lo va a ejecutar: el plan lógico y los trabajos
MapReduce. Salís con `quit`.

### 8.3 Pig sin cluster (`-x local`)

Para probar un script rápido sobre archivos de `/datos`, sin HDFS ni YARN:

```bash
pig -x local -param entrada=ejemplos/texto.txt ejemplos/wordcount.pig
```

```
(datos,3)
(los,3)
(en,2)
(a,1)
...
```

Útil también con `SERVICIOS=hdfs` (YARN apagado). El mismo script contra el
cluster: `pig ejemplos/wordcount.pig` (lee `/user/root/texto.txt`).

## 9. Hive

Hive pone **SQL** arriba de los archivos de HDFS. Cada consulta se traduce a
trabajos **Tez** en YARN.

### 9.1 Correr el script

```bash
cat ejemplos/ventas.hql
beeline -u jdbc:hive2://localhost:10000 -f ejemplos/ventas.hql
```

El script:

1. Crea la tabla `ventas` como **EXTERNAL** sobre la carpeta
   `/user/root/ventas`: no copia ni mueve nada, solo le dice a Hive qué
   columnas tienen esos archivos. `skip.header.line.count` saltea el
   encabezado.
2. Ventas por producto.
3. Ventas por sucursal.
4. Guarda el resultado por producto en `/user/root/resultados/hive_por_producto`.

```
+-------------+-----------+------------+
|  producto   | unidades  | facturado  |
+-------------+-----------+------------+
| yerba       | 179512    | 448780000  |
| termo       | 11793     | 412755000  |
| mate        | 48154     | 385232000  |
...
+-----------+----------+------------+
| sucursal  | tickets  | facturado  |
+-----------+----------+------------+
| Oeste     | 50155    | 480328000  |
| Norte     | 50062    | 480187600  |
| Sur       | 49932    | 476986200  |
| Centro    | 49851    | 475765400  |
+-----------+----------+------------+
```

La primera consulta tarda más (Hive arranca su sesión de Tez en YARN); las
siguientes, menos.

### 9.2 Hive interactivo

```bash
beeline -u jdbc:hive2://localhost:10000
```

```sql
SHOW TABLES;
DESCRIBE ventas;
SELECT * FROM ventas LIMIT 5;
SELECT substr(fecha, 1, 7) AS mes, SUM(CAST(cantidad AS BIGINT) * precio) AS facturado
FROM ventas GROUP BY substr(fecha, 1, 7) ORDER BY mes;
EXPLAIN SELECT producto, COUNT(*) FROM ventas GROUP BY producto;
!quit
```

- La tabla persiste: mañana, con el contenedor prendido de nuevo, sigue ahí.
- `DROP TABLE ventas;` borra solo la definición; los archivos de HDFS quedan
  (por ser EXTERNAL).
- Desde DBeaver u otro cliente en tu compu: `jdbc:hive2://localhost:10000`,
  sin usuario ni contraseña.

## 10. Spark

Spark procesa **en memoria** y tiene API para Python, Scala y SQL. Corre sobre
el mismo YARN y lee los mismos archivos de HDFS.

### 10.1 Correr el script

```bash
cat ejemplos/ventas.py
spark-submit ejemplos/ventas.py
```

Muestra el esquema que infirió del CSV y el resultado:

```
+----------+--------+---------+
|  producto|unidades|facturado|
+----------+--------+---------+
|     yerba|  179512|448780000|
|     termo|   11793|412755000|
...
```

Y como Spark comparte el metastore con Hive, también ve la tabla `ventas` que
creó Hive en el paso 9 y corre sobre ella la consulta por sucursal, en SQL.

- Mientras corre: http://localhost:8088 → aplicación **SPARK** → *ApplicationMaster*.
- Terminado: http://localhost:18080.
- El resultado queda en `/user/root/resultados/spark_por_producto` (con
  `mode("overwrite")`: se puede correr las veces que quieras).

### 10.2 pyspark interactivo

```bash
pyspark
```

```python
ventas = spark.read.csv("hdfs:///user/root/ventas", header=True, inferSchema=True)
ventas.printSchema()
ventas.show(5)
ventas.count()
ventas.groupBy("sucursal").count().show()
ventas.filter(ventas.producto == "termo").groupBy("sucursal").sum("cantidad").show()

# SQL sobre la tabla de Hive
spark.sql("SELECT producto, AVG(cantidad) AS promedio FROM ventas GROUP BY producto").show()

# O registrar un DataFrame como vista temporal y usar SQL
ventas.createOrReplaceTempView("v")
spark.sql("SELECT fecha, COUNT(*) FROM v GROUP BY fecha ORDER BY 2 DESC LIMIT 3").show()
exit()
```

Mientras pyspark está abierto, su página es http://localhost:4040 (*Jobs*,
*Stages*, *Storage*). Ocupa memoria de YARN: cerralo (`exit()`) antes de
correr otra cosa pesada.

## 11. Comparar los cuatro resultados

Las cuatro herramientas guardaron su resultado en `/user/root/resultados`:

```bash
hdfs dfs -ls /user/root/resultados
```

```
.../resultados/hive_por_producto
.../resultados/mr_por_producto
.../resultados/pig_por_producto
.../resultados/spark_por_producto
```

Y tienen que dar **exactamente** esto:

| producto   | unidades | facturado   |
|------------|---------:|------------:|
| yerba      |  179.512 | 448.780.000 |
| termo      |   11.793 | 412.755.000 |
| mate       |   48.154 | 385.232.000 |
| cafe       |   29.471 | 191.561.500 |
| galletitas |   82.979 | 149.362.200 |
| facturas   |  121.087 | 108.978.300 |
| bombilla   |   36.281 | 108.843.000 |
| azucar     |   89.796 | 107.755.200 |

Lo mismo, cuatro formas de escribirlo:

| Herramienta | Cómo se escribe        | Cómo se ejecuta                      | Líneas |
|-------------|------------------------|--------------------------------------|-------:|
| MapReduce   | mapper + reducer (Python o Java) | 1 trabajo MapReduce        | ~25    |
| Pig         | Pig Latin, paso a paso | Varios trabajos MapReduce            | ~10    |
| Hive        | SQL                    | Trabajos Tez                         | ~6     |
| Spark       | Python (DataFrames) o SQL | Ejecutores de Spark, en memoria   | ~6     |

Para compararlos de una (normaliza separadores y orden):

```bash
for h in mr pig hive spark; do
  echo "== $h"; hdfs dfs -cat "/user/root/resultados/${h}_por_producto/*" | tr '\t' ',' | grep -v '^producto' | sort
done
```

## 12. Bajar los resultados a tu compu

```bash
mkdir -p resultados
hdfs dfs -get /user/root/resultados/pig_por_producto resultados/
hdfs dfs -getmerge /user/root/resultados/spark_por_producto resultados/spark.csv
```

- `-get` baja la carpeta tal cual (con sus `part-*`).
- `-getmerge` junta todos los `part-*` en **un solo** archivo.

Quedan en `datos/resultados/` de tu compu: el CSV se abre con Excel.

## 13. Romper cosas: se cae un DataNode

```bash
datanode stop 2
hdfs dfs -cat /user/root/ventas/ventas_grandes.csv | wc -l
```

Sigue dando `200001`: cada bloque que tenía el DataNode 2 tiene otra copia en
otro nodo. En http://localhost:9870 → *Datanodes*, el 2 pasa a **Dead** en
~40 s, y el NameNode copia sus bloques a los que quedan para volver a tener 2
réplicas. Comprobalo:

```bash
hdfs fsck /user/root/ventas/ventas_grandes.csv -files -blocks -locations
```

Los trabajos también siguen andando (probá `pig ejemplos/ventas.pig`).
Volvé a prenderlo:

```bash
datanode start 2
```

Más experimentos (NameNode caído, alta disponibilidad, cambiar la replicación):
README, sección 6.

## 14. Con tu propio dataset

La receta es la misma; lo que cambia son los nombres de las columnas.

### 14.1 Ponerlo en `datos/`

Copiá tu CSV a la carpeta `datos/` de tu compu (con el explorador de archivos).
Adentro del contenedor ya lo ves:

```bash
ls -lh /datos
```

### 14.2 Mirarlo antes de nada

```bash
head -5 mi_archivo.csv
wc -l mi_archivo.csv
file mi_archivo.csv
```

Revisá cuatro cosas:

| Qué                 | Cómo te das cuenta                                 | Arreglo |
|---------------------|----------------------------------------------------|---------|
| **Separador `;`** (Excel en español) | `head` muestra `;` entre columnas | Usar `';'` en lugar de `','` en los scripts (abajo) |
| **Fin de línea de Windows** | `file` dice `with CRLF line terminators` | `sed -i 's/\r$//' mi_archivo.csv` |
| **Acentos rotos** | `file` dice `ISO-8859` y no `UTF-8` | `iconv -f latin1 -t utf-8 mi_archivo.csv > mi_archivo_utf8.csv` |
| **Encabezado**      | La primera línea son nombres de columnas           | Saltearlo (cada script lo hace distinto, abajo) |

> Si el CSV tiene comas **adentro** de un campo entre comillas
> (`"Perez, Juan"`), Pig y Hive con un separador simple lo parten mal. Lo más
> fácil: guardarlo desde Excel/Sheets con `;` o tabulaciones como separador.

### 14.3 Subirlo a su carpeta de HDFS

Supongamos `notas.csv` con columnas `alumno,materia,nota`:

```bash
hdfs dfs -mkdir -p /user/root/notas
hdfs dfs -put notas.csv /user/root/notas/
hdfs fsck /user/root/notas -files -blocks
```

Una carpeta por dataset: si después llega `notas_2027.csv`, lo subís a la misma
carpeta y todas las herramientas lo leen junto.

### 14.4 Adaptar cada herramienta

Lo más rápido para explorar es **Spark**: infiere las columnas solo.

```bash
pyspark
```

```python
df = spark.read.csv("hdfs:///user/root/notas", header=True, inferSchema=True)   # sep=";" si hace falta
df.printSchema()
df.groupBy("materia").avg("nota").show()
```

**Hive**: copiá `ejemplos/ventas.hql` (por ejemplo a `notas.hql`) y cambiá la
tabla:

```sql
CREATE EXTERNAL TABLE IF NOT EXISTS notas (
  alumno  STRING,
  materia STRING,
  nota    DOUBLE
)
ROW FORMAT DELIMITED FIELDS TERMINATED BY ','     -- o ';'
STORED AS TEXTFILE
LOCATION '/user/root/notas'
TBLPROPERTIES ('skip.header.line.count' = '1');   -- sacalo si no tiene encabezado

SELECT materia, AVG(nota) AS promedio, COUNT(*) AS alumnos
FROM notas GROUP BY materia ORDER BY promedio DESC;
```

```bash
beeline -u jdbc:hive2://localhost:10000 -f notas.hql
```

**Pig**: copiá `ejemplos/ventas.pig` y cambiá el `LOAD` y el filtro del
encabezado:

```pig
notas = LOAD '/user/root/notas' USING PigStorage(',')      -- o ';'
        AS (alumno:chararray, materia:chararray, nota:double);
datos = FILTER notas BY alumno != 'alumno';                -- saltea el encabezado
por_materia = GROUP datos BY materia;
promedios = FOREACH por_materia GENERATE group AS materia, AVG(datos.nota) AS promedio;
DUMP promedios;
```

**MapReduce**: copiá `mapper.py` y `reducer.py`. En el mapper cambiá cuántos
campos espera, cómo se llama la primera columna del encabezado y qué emite
(clave `<TAB>` valor); en el reducer, qué hace con los valores de cada clave.
Probalo primero con la tubería del paso 7.1.

### 14.5 ¿Es muy grande para el sandbox?

- Hasta unos cientos de MB anda bien. Varios GB también, pero lento: es una
  sola compu haciendo de cluster.
- Si un trabajo se queda en `ACCEPTED`, falta memoria en YARN: cerrá los
  `pyspark` y `beeline` abiertos.
- `docker stats bigdata` muestra cuánta RAM está usando.

## 15. Apagar, prender y empezar de cero

```bash
exit                       # salir del contenedor (sigue prendido)
docker stop bigdata        # apagar: los datos de HDFS y las tablas quedan
docker start bigdata       # prender otro día (~1-2 min hasta "Cluster LISTO")
docker exec -it bigdata bash
```

Empezar de cero, borrando **todo** lo de HDFS y Hive (tus archivos de `datos/`
en la compu no se tocan):

```bash
docker rm -f bigdata
docker volume rm bigdata_hadoop
```

Y de nuevo el paso 3.

Si editaste un ejemplo y querés el original: borralo de `datos/ejemplos/` y
reiniciá el contenedor (`docker restart bigdata`); vuelve a aparecer.
