import{i as u}from"./index-Dl_9pilw.js";const S=`"""Mapper de Hadoop Streaming: ventas por producto.

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
`,v=`"""Reducer de Hadoop Streaming: ventas por producto.

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
`,y=`-- Ventas por producto, en Pig Latin.
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
`,E=`-- Ventas por producto, en Hive (SQL).
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
`,R=`"""Ventas por producto, en Spark (PySpark).

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
`;function A(e,n,a){const o=e.replace(/\r\n/g,`
`).split(`
`),r=o.findIndex(s=>n.test(s));if(r<0)return e.trim();const t=a?o.findIndex((s,d)=>d>r&&a.test(s)):-1;return o.slice(r,t<0?o.length:t+1).join(`
`).trim()}const g=(e,n)=>e.split(`
`).filter(a=>a.trim()&&!a.trim().startsWith(n)).length,p=(e,n,a,o,r)=>{const t=A(n,o,r);return{nombre:e,texto:n.replace(/\r\n/g,`
`).trim(),nucleo:t,lineas:g(t,a)}},i="/user/root/resultados",T=[{id:"streaming",nombre:"MapReduce a mano",estilo:"Escribís vos el map y el reduce, en Python",motor:"MAPREDUCE",archivos:[p("mapper.py",S,"#",/^import sys/),p("reducer.py",v,"#",/^import sys/)],cmd:`hdfs dfs -rm -r -f ${i}/mr_por_producto
hadoop jar $HADOOP_HOME/share/hadoop/tools/lib/hadoop-streaming-*.jar \\
  -files ejemplos/mapper.py,ejemplos/reducer.py \\
  -mapper "python3 mapper.py" -reducer "python3 reducer.py" \\
  -input /user/root/ventas -output ${i}/mr_por_producto`,plantilla:"mr-ventas",salida:`${i}/mr_por_producto`,fases:[{t:"map"},{t:"shuffle"},{t:"reduce"}],faseNota:"Un trabajo: un map por bloque, el shuffle ordena y agrupa por producto y el reduce suma.",nota:"No ordena por facturación: para eso haría falta un segundo trabajo entero.",esSuya:e=>e.type==="MAPREDUCE"&&/streamjob|mapper\.py/i.test(e.name)},{id:"pig",nombre:"Pig Latin",estilo:"Describís los pasos y Pig escribe el map y el reduce por vos",motor:"MAPREDUCE",archivos:[p("ventas.pig",y,"--",/^ventas = LOAD/,/^STORE /)],cmd:"pig ejemplos/ventas.pig",plantilla:"pig-ventas",salida:`${i}/pig_por_producto`,fases:[{t:"GROUP"},{t:"HDFS",disco:!0},{t:"ORDER"}],faseNota:"Varios trabajos MapReduce en fila: entre uno y otro, el resultado se escribe en HDFS.",nota:"Nada corre hasta el STORE: recién ahí Pig arma el plan entero.",esSuya:e=>e.type==="MAPREDUCE"&&/PigLatin:ventas\.pig/i.test(e.name)},{id:"hive",nombre:"HiveQL",estilo:"SQL: decís qué querés y Hive arma el plan",motor:"TEZ",archivos:[p("ventas.hql",E,"--",/^CREATE EXTERNAL TABLE/,/^ORDER BY facturado DESC;/)],cmd:`beeline -u jdbc:hive2://localhost:10000 --hiveconf hive.tez.exec.print.summary=true \\
  -f ejemplos/ventas.hql`,plantilla:"hive-ventas",salida:`${i}/hive_por_producto`,fases:[{t:"Map 1"},{t:"Reducer 2"},{t:"Reducer 3"}],faseNota:"Un solo DAG de Tez: agrupa y ordena sin escribir en HDFS en el medio.",nota:"Casi todo es crear la tabla, y eso se hace una sola vez: queda en el Metastore y Spark SQL la lee igual.",esSuya:e=>e.type==="TEZ"&&/^HIVE/i.test(e.name)},{id:"pyspark",nombre:"PySpark",estilo:"Código Python que encadena operaciones sobre DataFrames",motor:"SPARK",archivos:[p("ventas.py",R,"#",/^from pyspark/,/^\)\s*$/)],cmd:"spark-submit ejemplos/ventas.py",plantilla:"spark-ventas",salida:`${i}/spark_por_producto`,fases:[{t:"leer"},{t:"sumar"},{t:"ordenar"}],faseNota:"Etapas en memoria separadas por shuffles; los executors viven mientras dura el programa.",nota:"Nada corre hasta una acción (show, write): recién ahí Spark arma el plan.",esSuya:e=>e.type==="SPARK"&&/ventas por producto/i.test(e.name)}],O={MAPREDUCE:{nombre:"MapReduce",eng:"mr"},TEZ:{nombre:"Tez",eng:"tez"},SPARK:{nombre:"Spark",eng:"spark"}},M={carpeta:"/user/root/ventas"},P=`for h in mr pig hive spark; do
  echo "== $h"
  hdfs dfs -cat "${i}/\${h}_por_producto/*" | tr '\\t' ',' | grep -v '^producto' | sort
done`,I=(e,n)=>Math.max(0,(e.finishedAt??n)-(e.startedAt??e.submittedAt));function C(e){const n={};for(const a of T){const o=e.filter(a.esSuya).sort((t,s)=>s.submittedAt-t.submittedAt);if(!o.length)continue;const r=[o[0]];if(a.id==="pig")for(const t of o.slice(1)){if(t.finishedAt==null||r[r.length-1].submittedAt-t.finishedAt>3e4)break;r.push(t)}n[a.id]=r.reverse()}return n}const N=(e,n)=>Math.max(0,(e[e.length-1].finishedAt??n)-(e[0].startedAt??e[0].submittedAt));function L(e){const n=e.filter(o=>!o.error&&o.state==="FINISHED");if(!n.length||n.length<e.length)return;const a=o=>n.every(r=>typeof r[o]=="number")?n.reduce((r,t)=>r+t[o],0):void 0;return{trabajos:n.length,ms:a("elapsedMs")??0,mbSeconds:a("mbSeconds")??0,leido:a("hdfsReadBytes"),escrito:a("hdfsWrittenBytes"),shuffle:a("shuffleBytes"),discoLocal:a("localDiskBytes"),tareas:a("tasks")}}const b=e=>e<1024*1024?`${u(e/1024,e<10240?1:0)} KB`:`${u(e/1048576,1)} MB`,l=e=>e<1024?`${u(e)} bytes`:b(e);function k(e){const n=[],a=e.streaming,o=e.pyspark,r=e.pig,t=e.hive,s=[r?.shuffle!=null&&["Pig",r.shuffle],t?.shuffle!=null&&["Hive",t.shuffle],o?.shuffle!=null&&["PySpark",o.shuffle]].filter(Boolean);if(a?.shuffle!=null&&s.length&&s.every(([,c])=>a.shuffle>c*10)){const c=s.map(([m])=>m),f=c.length>1?`${c.slice(0,-1).join(", ")} y ${c.at(-1)}`:c[0];n.push(`MapReduce a mano mandó ${l(a.shuffle)} por el shuffle y ${s.map(([m,h])=>`${m} ${l(h)}`).join(", ")}: mapper.py emite una línea por venta, y ${f} ${s.length>1?"suman":"suma"} por producto en cada partición antes de mandar.`)}const d=a?.leido;return d&&o?.leido&&o.leido>d*1.8&&n.push(`PySpark leyó ${l(o.leido)} de HDFS, ${u(o.leido/d,1)} veces la entrada: inferSchema la recorre entera para adivinar los tipos y cada acción (show, write) la vuelve a leer, porque no hay cache().`),a?.discoLocal!=null&&o?.discoLocal!=null&&a.discoLocal>o.discoLocal*10&&n.push(`MapReduce escribió ${l(a.discoLocal)} en el disco local de los nodos (los spills del map y la mezcla del reduce); PySpark, ${l(o.discoLocal)}.`),r&&r.trabajos>1&&n.push(`Pig lanzó ${r.trabajos} trabajos MapReduce para un solo script: uno agrupa y suma, y ORDER BY necesita otros (muestrear las claves y ordenar).`),n}export{M as D,O as M,T as V,p as a,l as b,R as c,I as d,N as e,P as f,g as l,k as o,L as s,C as u,E as v};
