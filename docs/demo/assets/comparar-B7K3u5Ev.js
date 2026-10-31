import{i as p}from"./index-C1RT_82Y.js";const u=`"""Mapper de Hadoop Streaming: ventas por producto.

MapReduce "a mano" en Python: Hadoop le pasa a este script las lineas del CSV
por la entrada estandar (un mapper por cada bloque del archivo) y el script
emite pares clave <TAB> valor. Hadoop los ordena por clave y se los pasa al
reducer.

Por cada venta emite:  producto <TAB> cantidad <TAB> importe

Probarlo sin Hadoop:
    head ejemplos/ventas.csv | python3 ejemplos/mapper.py
"""
import sys

for linea in sys.stdin:
    campos = linea.strip().split(",")
    if len(campos) != 5 or campos[0] == "fecha":  # encabezado o linea rota
        continue
    fecha, sucursal, producto, cantidad, precio = campos
    print(f"{producto}\\t{cantidad}\\t{int(cantidad) * int(precio)}")
`,m=`"""Reducer de Hadoop Streaming: ventas por producto.

Recibe las lineas del mapper YA ORDENADAS por clave (producto): todas las de un
mismo producto llegan juntas. Suma mientras la clave no cambia y, cuando
cambia, emite el total del producto anterior.

Emite:  producto <TAB> unidades <TAB> facturado

Probarlo sin Hadoop (el sort hace de "shuffle"):
    cat ejemplos/ventas.csv | python3 ejemplos/mapper.py | sort | python3 ejemplos/reducer.py
"""
import sys

actual, unidades, facturado = None, 0, 0

for linea in sys.stdin:
    producto, cantidad, importe = linea.rstrip("\\n").split("\\t")
    if producto != actual:
        if actual is not None:
            print(f"{actual}\\t{unidades}\\t{facturado}")
        actual, unidades, facturado = producto, 0, 0
    unidades += int(cantidad)
    facturado += int(importe)

if actual is not None:
    print(f"{actual}\\t{unidades}\\t{facturado}")
`,f=`-- Ventas por producto, en Pig Latin.
-- Mismo calculo que mapper.py/reducer.py (MapReduce), ventas.hql (Hive) y
-- ventas.py (Spark): los cuatro tienen que dar el mismo resultado.
--
-- Uso (adentro del contenedor, parado en /datos):
--   pig ejemplos/ventas.pig
--   pig -param entrada=/user/root/otra_carpeta ejemplos/ventas.pig
--
-- Cada paso es un "alias" (una relacion). Pig no ejecuta nada hasta el STORE
-- (o un DUMP): ahi arma el plan completo y lo corre como trabajos MapReduce
-- en YARN (se ven en http://localhost:8088).

%default entrada '/user/root/ventas'
%default salida  '/user/root/resultados/pig_por_producto'

-- 1. Leer el CSV (todos los archivos de la carpeta), con su esquema
ventas = LOAD '$entrada' USING PigStorage(',')
         AS (fecha:chararray, sucursal:chararray, producto:chararray,
             cantidad:int, precio:int);

-- 2. Sacar la fila de encabezado (fecha,sucursal,...)
datos = FILTER ventas BY fecha != 'fecha';

-- 3. Importe de cada venta
con_importe = FOREACH datos GENERATE producto, cantidad,
              (long)cantidad * precio AS importe;

-- 4. Agrupar por producto y sumar
por_producto = GROUP con_importe BY producto;
resumen = FOREACH por_producto GENERATE
              group                   AS producto,
              SUM(con_importe.cantidad) AS unidades,
              SUM(con_importe.importe)  AS facturado;

-- 5. Ordenar de mayor a menor facturacion
ordenado = ORDER resumen BY facturado DESC;

-- 6. Guardar en HDFS (si ya existia de una corrida anterior, se borra antes)
fs -rm -r -f $salida;
STORE ordenado INTO '$salida' USING PigStorage(',');
`,h=`-- Ventas por producto, en Hive (SQL).
-- Mismo calculo que ventas.pig (Pig), mapper.py/reducer.py (MapReduce) y
-- ventas.py (Spark).
--
-- Uso (adentro del contenedor, parado en /datos):
--   beeline -u jdbc:hive2://localhost:10000 -f ejemplos/ventas.hql
--
-- Cada consulta corre como un trabajo TEZ en YARN (http://localhost:8088).

-- Tabla EXTERNA: Hive solo guarda el esquema en su metastore; los datos siguen
-- siendo los archivos de /user/root/ventas en HDFS, los mismos que leen Pig y
-- Spark. Si borras la tabla (DROP TABLE), los archivos quedan.
CREATE EXTERNAL TABLE IF NOT EXISTS ventas (
  fecha    STRING,
  sucursal STRING,
  producto STRING,
  cantidad INT,
  precio   INT
)
ROW FORMAT DELIMITED FIELDS TERMINATED BY ','
STORED AS TEXTFILE
LOCATION '/user/root/ventas'
TBLPROPERTIES ('skip.header.line.count' = '1');

-- Ventas por producto
SELECT producto,
       SUM(cantidad)                   AS unidades,
       SUM(CAST(cantidad AS BIGINT) * precio) AS facturado
FROM ventas
GROUP BY producto
ORDER BY facturado DESC;

-- Ventas por sucursal
SELECT sucursal,
       COUNT(*)                        AS tickets,
       SUM(CAST(cantidad AS BIGINT) * precio) AS facturado
FROM ventas
GROUP BY sucursal
ORDER BY facturado DESC;

-- Guardar el resultado por producto como archivo en HDFS
INSERT OVERWRITE DIRECTORY '/user/root/resultados/hive_por_producto'
ROW FORMAT DELIMITED FIELDS TERMINATED BY ','
SELECT producto,
       SUM(cantidad)                   AS unidades,
       SUM(CAST(cantidad AS BIGINT) * precio) AS facturado
FROM ventas
GROUP BY producto
ORDER BY facturado DESC;
`,S=`"""Ventas por producto, en Spark (PySpark).

Mismo calculo que ventas.pig (Pig), mapper.py/reducer.py (MapReduce) y
ventas.hql (Hive).

Uso (adentro del contenedor, parado en /datos):

    spark-submit ejemplos/ventas.py

Corre como aplicacion SPARK en YARN (http://localhost:8088) y al terminar
queda en el historial (http://localhost:18080).
"""
from pyspark.sql import SparkSession, functions as F

spark = SparkSession.builder.appName("ventas por producto").getOrCreate()

# 1. Leer el CSV directo de HDFS (todos los archivos de la carpeta)
ventas = spark.read.csv("hdfs:///user/root/ventas", header=True, inferSchema=True)
ventas.printSchema()

# 2. Mismo calculo, con la API de DataFrames
resumen = (
    ventas.withColumn("importe", F.col("cantidad").cast("long") * F.col("precio"))
    .groupBy("producto")
    .agg(F.sum("cantidad").alias("unidades"), F.sum("importe").alias("facturado"))
    .orderBy(F.desc("facturado"))
)
resumen.show()

# 3. Guardarlo en HDFS (pisa el de una corrida anterior)
resumen.write.mode("overwrite").csv("hdfs:///user/root/resultados/spark_por_producto", header=True)

# 4. Lo mismo en SQL, sobre la tabla de Hive (si ya corriste ventas.hql):
#    Spark y Hive comparten el metastore
if spark.catalog.tableExists("ventas"):
    spark.sql("""
        SELECT sucursal, COUNT(*) AS tickets, SUM(CAST(cantidad AS BIGINT) * precio) AS facturado
        FROM ventas GROUP BY sucursal ORDER BY facturado DESC
    """).show()

spark.stop()
`;function v(a,n,e){const o=a.replace(/\r\n/g,`
`).split(`
`),r=o.findIndex(i=>n.test(i));if(r<0)return a.trim();const t=e?o.findIndex((i,l)=>l>r&&e.test(i)):-1;return o.slice(r,t<0?o.length:t+1).join(`
`).trim()}const y=(a,n)=>a.split(`
`).filter(e=>e.trim()&&!e.trim().startsWith(n)).length,c=(a,n,e,o,r)=>{const t=v(n,o,r);return{nombre:a,texto:n.replace(/\r\n/g,`
`).trim(),nucleo:t,lineas:y(t,e)}},s="/user/root/resultados",E=[{id:"streaming",nombre:"MapReduce a mano",estilo:"Escribís vos el map y el reduce, en Python",motor:"MAPREDUCE",archivos:[c("mapper.py",u,"#",/^import sys/),c("reducer.py",m,"#",/^import sys/)],cmd:`hdfs dfs -rm -r -f ${s}/mr_por_producto
hadoop jar $HADOOP_HOME/share/hadoop/tools/lib/hadoop-streaming-*.jar \\
  -files ejemplos/mapper.py,ejemplos/reducer.py \\
  -mapper "python3 mapper.py" -reducer "python3 reducer.py" \\
  -input /user/root/ventas -output ${s}/mr_por_producto`,plantilla:"mr-ventas",salida:`${s}/mr_por_producto`,fases:[{t:"map"},{t:"shuffle"},{t:"reduce"}],faseNota:"Un trabajo: un map por bloque, el shuffle ordena y agrupa por producto y el reduce suma.",nota:"No ordena por facturación: para eso haría falta un segundo trabajo entero.",esSuya:a=>a.type==="MAPREDUCE"&&/streamjob|mapper\.py/i.test(a.name)},{id:"pig",nombre:"Pig Latin",estilo:"Describís los pasos y Pig escribe el map y el reduce por vos",motor:"MAPREDUCE",archivos:[c("ventas.pig",f,"--",/^ventas = LOAD/,/^STORE /)],cmd:"pig ejemplos/ventas.pig",salida:`${s}/pig_por_producto`,fases:[{t:"GROUP"},{t:"HDFS",disco:!0},{t:"ORDER"}],faseNota:"Varios trabajos MapReduce en fila: entre uno y otro, el resultado se escribe en HDFS.",nota:"Nada corre hasta el STORE: recién ahí Pig arma el plan entero.",esSuya:a=>a.type==="MAPREDUCE"&&/PigLatin:ventas\.pig/i.test(a.name)},{id:"hive",nombre:"HiveQL",estilo:"SQL: decís qué querés y Hive arma el plan",motor:"TEZ",archivos:[c("ventas.hql",h,"--",/^CREATE EXTERNAL TABLE/,/^ORDER BY facturado DESC;/)],cmd:"beeline -u jdbc:hive2://localhost:10000 -f ejemplos/ventas.hql",plantilla:"hive-ventas",salida:`${s}/hive_por_producto`,fases:[{t:"Map 1"},{t:"Reducer 2"},{t:"Reducer 3"}],faseNota:"Un solo DAG de Tez: agrupa y ordena sin escribir en HDFS en el medio.",nota:"Casi todo es crear la tabla, y eso se hace una sola vez: queda en el Metastore y Spark SQL la lee igual.",esSuya:a=>a.type==="TEZ"&&/^HIVE/i.test(a.name)},{id:"pyspark",nombre:"PySpark",estilo:"Código Python que encadena operaciones sobre DataFrames",motor:"SPARK",archivos:[c("ventas.py",S,"#",/^from pyspark/,/^\)\s*$/)],cmd:"spark-submit ejemplos/ventas.py",plantilla:"spark-ventas",salida:`${s}/spark_por_producto`,fases:[{t:"leer"},{t:"sumar"},{t:"ordenar"}],faseNota:"Etapas en memoria separadas por shuffles; los executors viven mientras dura el programa.",nota:"Nada corre hasta una acción (show, write): recién ahí Spark arma el plan.",esSuya:a=>a.type==="SPARK"&&/ventas por producto/i.test(a.name)}],T={MAPREDUCE:{nombre:"MapReduce",eng:"mr"},TEZ:{nombre:"Tez",eng:"tez"},SPARK:{nombre:"Spark",eng:"spark"}},g={carpeta:"/user/root/ventas"},b=`for h in mr pig hive spark; do
  echo "== $h"
  hdfs dfs -cat "${s}/\${h}_por_producto/*" | tr '\\t' ',' | grep -v '^producto' | sort
done`,D=(a,n)=>Math.max(0,(a.finishedAt??n)-(a.startedAt??a.submittedAt));function O(a){const n={};for(const e of E){const o=a.filter(e.esSuya).sort((t,i)=>i.submittedAt-t.submittedAt);if(!o.length)continue;const r=[o[0]];if(e.id==="pig")for(const t of o.slice(1)){if(t.finishedAt==null||r[r.length-1].submittedAt-t.finishedAt>3e4)break;r.push(t)}n[e.id]=r.reverse()}return n}const M=(a,n)=>Math.max(0,(a[a.length-1].finishedAt??n)-(a[0].startedAt??a[0].submittedAt));function P(a){const n=a.filter(o=>!o.error&&o.state==="FINISHED");if(!n.length||n.length<a.length)return;const e=o=>n.every(r=>typeof r[o]=="number")?n.reduce((r,t)=>r+t[o],0):void 0;return{trabajos:n.length,ms:e("elapsedMs")??0,mbSeconds:e("mbSeconds")??0,leido:e("hdfsReadBytes"),escrito:e("hdfsWrittenBytes"),shuffle:e("shuffleBytes"),discoLocal:e("localDiskBytes"),tareas:e("tasks")}}const R=a=>a<1024*1024?`${p(a/1024,a<10240?1:0)} KB`:`${p(a/1048576,1)} MB`,d=a=>a<1024?`${p(a)} bytes`:R(a);function I(a){const n=[],e=a.streaming,o=a.pyspark,r=a.pig;e?.shuffle!=null&&o?.shuffle!=null&&e.shuffle>o.shuffle*10&&n.push(`MapReduce a mano mandó ${d(e.shuffle)} por el shuffle y PySpark ${d(o.shuffle)}: mapper.py emite una línea por venta, y Spark suma por producto en cada partición antes de mandar.`);const t=e?.leido;return t&&o?.leido&&o.leido>t*1.8&&n.push(`PySpark leyó ${d(o.leido)} de HDFS, ${p(o.leido/t,1)} veces la entrada: inferSchema la recorre entera para adivinar los tipos y cada acción (show, write) la vuelve a leer, porque no hay cache().`),e?.discoLocal!=null&&o?.discoLocal!=null&&e.discoLocal>o.discoLocal*10&&n.push(`MapReduce escribió ${d(e.discoLocal)} en el disco local de los nodos (los spills del map y la mezcla del reduce); PySpark, ${d(o.discoLocal)}.`),r&&r.trabajos>1&&n.push(`Pig lanzó ${r.trabajos} trabajos MapReduce para un solo script: uno agrupa y suma, y ORDER BY necesita otros (muestrear las claves y ordenar).`),n}export{g as D,T as M,E as V,M as a,d as b,b as c,D as d,I as o,P as s,O as u};
