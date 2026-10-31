import{b as h,j as e,as as B,aW as H,y as q,d as U,A as $}from"./ui-ByniZyJA.js";import{i as x,u as w,g as G,n as g,w as k,A as Y,s as _,t as L}from"./index-C6oIQygi.js";import{C as F,a as V}from"./Comando-o8L9VX9r.js";import{P as z}from"./PageHeader-E4Mp9y20.js";import{G as W}from"./Gated-CJDmr8Zm.js";import{E as Q}from"./Trace-ChGVogsK.js";import{c as O,R as M,C as A}from"./ecosistema-VCggkRQG.js";import"./graficos-U6iFCXIg.js";import"./HelpTip-BEMsdCDP.js";import"./capabilities-CtBGp8Sv.js";const X=`"""Mapper de Hadoop Streaming: ventas por producto.

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
`,K=`"""Reducer de Hadoop Streaming: ventas por producto.

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
`,Z=`-- Ventas por producto, en Pig Latin.
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
`,J=`-- Ventas por producto, en Hive (SQL).
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
`,ee=`"""Ventas por producto, en Spark (PySpark).

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
`;function ae(a,s,t){const r=a.replace(/\r\n/g,`
`).split(`
`),n=r.findIndex(i=>s.test(i));if(n<0)return a.trim();const o=t?r.findIndex((i,l)=>l>n&&t.test(i)):-1;return r.slice(n,o<0?r.length:o+1).join(`
`).trim()}const se=(a,s)=>a.split(`
`).filter(t=>t.trim()&&!t.trim().startsWith(s)).length,v=(a,s,t,r,n)=>{const o=ae(s,r,n);return{nombre:a,texto:s.replace(/\r\n/g,`
`).trim(),nucleo:o,lineas:se(o,t)}},y="/user/root/resultados",T=[{id:"streaming",nombre:"MapReduce a mano",estilo:"Escribís vos el map y el reduce, en Python",motor:"MAPREDUCE",archivos:[v("mapper.py",X,"#",/^import sys/),v("reducer.py",K,"#",/^import sys/)],cmd:`hdfs dfs -rm -r -f ${y}/mr_por_producto
hadoop jar $HADOOP_HOME/share/hadoop/tools/lib/hadoop-streaming-*.jar \\
  -files ejemplos/mapper.py,ejemplos/reducer.py \\
  -mapper "python3 mapper.py" -reducer "python3 reducer.py" \\
  -input /user/root/ventas -output ${y}/mr_por_producto`,plantilla:"mr-ventas",salida:`${y}/mr_por_producto`,fases:[{t:"map"},{t:"shuffle"},{t:"reduce"}],faseNota:"Un trabajo: un map por bloque, el shuffle ordena y agrupa por producto y el reduce suma.",nota:"No ordena por facturación: para eso haría falta un segundo trabajo entero.",esSuya:a=>a.type==="MAPREDUCE"&&/streamjob|mapper\.py/i.test(a.name)},{id:"pig",nombre:"Pig Latin",estilo:"Describís los pasos y Pig escribe el map y el reduce por vos",motor:"MAPREDUCE",archivos:[v("ventas.pig",Z,"--",/^ventas = LOAD/,/^STORE /)],cmd:"pig ejemplos/ventas.pig",salida:`${y}/pig_por_producto`,fases:[{t:"GROUP"},{t:"HDFS",disco:!0},{t:"ORDER"}],faseNota:"Varios trabajos MapReduce en fila: entre uno y otro, el resultado se escribe en HDFS.",nota:"Nada corre hasta el STORE: recién ahí Pig arma el plan entero.",esSuya:a=>a.type==="MAPREDUCE"&&/PigLatin:ventas\.pig/i.test(a.name)},{id:"hive",nombre:"HiveQL",estilo:"SQL: decís qué querés y Hive arma el plan",motor:"TEZ",archivos:[v("ventas.hql",J,"--",/^CREATE EXTERNAL TABLE/,/^ORDER BY facturado DESC;/)],cmd:"beeline -u jdbc:hive2://localhost:10000 -f ejemplos/ventas.hql",plantilla:"hive-ventas",salida:`${y}/hive_por_producto`,fases:[{t:"Map 1"},{t:"Reducer 2"},{t:"Reducer 3"}],faseNota:"Un solo DAG de Tez: agrupa y ordena sin escribir en HDFS en el medio.",nota:"Casi todo es crear la tabla, y eso se hace una sola vez: queda en el Metastore y Spark SQL la lee igual.",esSuya:a=>a.type==="TEZ"&&/^HIVE/i.test(a.name)},{id:"pyspark",nombre:"PySpark",estilo:"Código Python que encadena operaciones sobre DataFrames",motor:"SPARK",archivos:[v("ventas.py",ee,"#",/^from pyspark/,/^\)\s*$/)],cmd:"spark-submit ejemplos/ventas.py",plantilla:"spark-ventas",salida:`${y}/spark_por_producto`,fases:[{t:"leer"},{t:"sumar"},{t:"ordenar"}],faseNota:"Etapas en memoria separadas por shuffles; los executors viven mientras dura el programa.",nota:"Nada corre hasta una acción (show, write): recién ahí Spark arma el plan.",esSuya:a=>a.type==="SPARK"&&/ventas por producto/i.test(a.name)}],R={MAPREDUCE:{nombre:"MapReduce",eng:"mr"},TEZ:{nombre:"Tez",eng:"tez"},SPARK:{nombre:"Spark",eng:"spark"}},P={carpeta:"/user/root/ventas"},ne=`for h in mr pig hive spark; do
  echo "== $h"
  hdfs dfs -cat "${y}/\${h}_por_producto/*" | tr '\\t' ',' | grep -v '^producto' | sort
done`;function oe(a){const s={};for(const t of T){const r=a.filter(t.esSuya).sort((o,i)=>i.submittedAt-o.submittedAt);if(!r.length)continue;const n=[r[0]];if(t.id==="pig")for(const o of r.slice(1)){if(o.finishedAt==null||n[n.length-1].submittedAt-o.finishedAt>3e4)break;n.push(o)}s[t.id]=n.reverse()}return s}const D=(a,s)=>Math.max(0,(a[a.length-1].finishedAt??s)-(a[0].startedAt??a[0].submittedAt));function re(a){const s=a.filter(r=>!r.error&&r.state==="FINISHED");if(!s.length||s.length<a.length)return;const t=r=>s.every(n=>typeof n[r]=="number")?s.reduce((n,o)=>n+o[r],0):void 0;return{trabajos:s.length,ms:t("elapsedMs")??0,mbSeconds:t("mbSeconds")??0,leido:t("hdfsReadBytes"),escrito:t("hdfsWrittenBytes"),shuffle:t("shuffleBytes"),discoLocal:t("localDiskBytes"),tareas:t("tasks")}}const te=a=>a<1024*1024?`${x(a/1024,a<10240?1:0)} KB`:`${x(a/1048576,1)} MB`,S=a=>a<1024?`${x(a)} bytes`:te(a);function ce(a){const s=[],t=a.streaming,r=a.pyspark,n=a.pig;t?.shuffle!=null&&r?.shuffle!=null&&t.shuffle>r.shuffle*10&&s.push(`MapReduce a mano mandó ${S(t.shuffle)} por el shuffle y PySpark ${S(r.shuffle)}: mapper.py emite una línea por venta, y Spark suma por producto en cada partición antes de mandar.`);const o=t?.leido;return o&&r?.leido&&r.leido>o*1.8&&s.push(`PySpark leyó ${S(r.leido)} de HDFS, ${x(r.leido/o,1)} veces la entrada: inferSchema la recorre entera para adivinar los tipos y cada acción (show, write) la vuelve a leer, porque no hay cache().`),t?.discoLocal!=null&&r?.discoLocal!=null&&t.discoLocal>r.discoLocal*10&&s.push(`MapReduce escribió ${S(t.discoLocal)} en el disco local de los nodos (los spills del map y la mezcla del reduce); PySpark, ${S(r.discoLocal)}.`),n&&n.trabajos>1&&s.push(`Pig lanzó ${n.trabajos} trabajos MapReduce para un solo script: uno agrupa y suma, y ORDER BY necesita otros (muestrear las claves y ordenar).`),s}const I=a=>({__html:a}),ie={streaming:"mapreduce",pig:"pig",hive:"tez",pyspark:"spark"},le={ACCEPTED:"en la cola",RUNNING:"corriendo",FINISHED:"terminó",FAILED:"falló",KILLED:"la cortaron"},C=a=>new RegExp(`^(?:${a.trim().split(/\s+/).join("|")})$`),de={py:C("import from for in if not is None print and or as return def"),sql:C("CREATE EXTERNAL TABLE IF NOT EXISTS ROW FORMAT DELIMITED FIELDS TERMINATED BY STORED AS LOCATION TBLPROPERTIES SELECT SUM CAST FROM GROUP ORDER DESC STRING INT BIGINT TEXTFILE"),pig:C("LOAD USING AS FILTER BY FOREACH GENERATE GROUP SUM ORDER DESC STORE INTO fs")},pe=a=>a.endsWith(".py")?"py":a.endsWith(".pig")?"pig":"sql";function ue({l:a,lang:s}){const t=s==="py"?"#":"--",r=a.indexOf(t),n=r<0?a:a.slice(0,r),o=r<0?"":a.slice(r),i=n.split(/("[^"]*"|'[^']*'|\b\w+\b)/);return e.jsxs(e.Fragment,{children:[i.map((l,p)=>/^["']/.test(l)?e.jsx("span",{className:"cp-tx",children:l},p):de[s].test(l)?e.jsx("span",{className:"cp-kw",children:l},p):e.jsx(h.Fragment,{children:l},p)),o&&e.jsx("span",{className:"cp-com",children:o}),`
`]})}function me({archivos:a}){const[s,t]=h.useState(0),[r,n]=h.useState(!1),o=a[s],i=r?o.texto:o.nucleo;return e.jsxs("div",{className:"cp-src",children:[e.jsxs("div",{className:"cp-src-h",children:[e.jsx("div",{role:"tablist","aria-label":"Archivos",children:a.map((l,p)=>e.jsx("button",{type:"button",role:"tab","aria-selected":p===s,onClick:()=>t(p),className:"mono",children:l.nombre},l.nombre))}),e.jsx("button",{type:"button",className:"cp-src-t","aria-pressed":r,onClick:()=>n(l=>!l),children:r?"Solo la cuenta":"Archivo entero"})]}),e.jsx("pre",{className:"cp-pre mono",tabIndex:0,"aria-label":`${o.nombre}${r?"":", lo que hace la cuenta"}`,children:i.split(`
`).map((l,p)=>e.jsx(ue,{l,lang:pe(o.nombre)},p))}),e.jsxs("div",{className:"cp-src-f",children:[e.jsxs("span",{children:["datos/ejemplos/",o.nombre]}),e.jsx(V,{texto:i})]})]})}function he({vivos:a,ult:s}){const t=[{m:"MAPREDUCE",filas:"2 / span 2"},{m:"TEZ",filas:"4"},{m:"SPARK",filas:"5"}],r=(n,o)=>e.jsx("span",{className:"cp-fl-cap",style:{gridColumn:n,gridRow:1},children:o});return e.jsxs("section",{className:"cp-flujo","aria-label":"El recorrido de los datos en las cuatro versiones",children:[r(1,"Almacenamiento"),r(3,"Lenguaje · cómo lo pedís"),r(5,"Motor · quién hace la cuenta"),r(7,"Resultado, otra vez en HDFS"),e.jsxs("div",{className:"cp-fl-dato","data-capa":"datos",style:{gridRow:"2 / span 4"},children:[e.jsx("span",{className:"cp-fl-k",children:"El dato, una sola vez"}),e.jsx("b",{className:"mono",children:P.carpeta}),e.jsx("small",{children:"HDFS guarda ventas.csv en bloques. Ninguna versión lo copia: las cuatro leen de acá."}),e.jsxs("button",{type:"button",className:"btn btn-sm",onClick:()=>g("hdfs",P.carpeta.slice(1)),children:[e.jsx(H,{size:13}),"Ver en HDFS"]})]}),T.map((n,o)=>{const i=s[n.id],l=i&&O(i)||void 0;return e.jsxs(h.Fragment,{children:[e.jsx("i",{className:"cp-fl-w",style:{gridRow:o+2,gridColumn:2},"data-run":l,"aria-hidden":"true"}),e.jsxs("a",{className:"cp-fl-l","data-capa":"lenguajes",href:"#comparar",onClick:p=>{p.preventDefault(),document.getElementById(`cp-${n.id}`)?.scrollIntoView({behavior:"smooth",block:"start"})},style:{gridRow:o+2},children:[e.jsx("b",{children:n.nombre}),e.jsx("small",{className:"mono",children:n.archivos.map(p=>p.nombre).join(" + ")})]}),e.jsx("i",{className:"cp-fl-w",style:{gridRow:o+2,gridColumn:4},"data-run":l,"aria-hidden":"true"}),e.jsx("i",{className:"cp-fl-w",style:{gridRow:o+2,gridColumn:6},"data-run":l,"aria-hidden":"true"}),e.jsx("span",{className:"cp-fl-out mono","data-capa":"datos",style:{gridRow:o+2},children:n.salida.replace("/user/root/","")})]},n.id)}),t.map(({m:n,filas:o})=>e.jsxs("div",{className:"cp-fl-m","data-motor":R[n].eng,"data-run":a.has(n)||void 0,style:{gridRow:o},children:[e.jsx("b",{children:R[n].nombre}),e.jsx("small",{children:a.has(n)?"corriendo ahora":e.jsxs(e.Fragment,{children:["en YARN: ",e.jsx("span",{className:"mono",children:n})]})})]},n))]})}function E({valor:a,max:s,children:t}){return e.jsxs("div",{className:"cp-bar",children:[e.jsx("span",{className:"cp-bar-t",children:t}),e.jsx("span",{className:"cp-bar-0","aria-hidden":"true",children:e.jsx("i",{style:{width:`${s?Math.max(4,a/s*100):0}%`}})})]})}function fe({v:a,app:s}){const t=s?.stages.length?s.stages.map(n=>({t:n.name,n:n.tasks.length,st:n.state,disco:!1})):null,r=t??a.fases.map(n=>({t:n.t,n:0,st:void 0,disco:!!n.disco}));return e.jsxs("div",{className:"cp-fases","aria-label":`Fases de ${R[a.motor].nombre}`,children:[e.jsx("ol",{children:r.map((n,o)=>e.jsxs("li",{"data-disco":n.disco||void 0,"data-st":n.st,children:[n.t,n.n>0&&e.jsxs("small",{className:"num",children:["×",n.n]})]},o))}),e.jsxs("p",{children:[t?"Las fases de la última corrida, como las contó YARN. ":"",a.faseNota]})]})}function je({v:a,mov:s,max:t}){return e.jsxs("div",{className:"cp-mov","aria-label":"Lo que movió la última corrida",children:[e.jsxs("span",{className:"cp-mov-h",children:["Lo que movió",s.trabajos>1?` · ${s.trabajos} trabajos`:""]}),s.leido!=null&&e.jsxs(E,{valor:s.leido,max:t.leido,children:[e.jsx("b",{className:"num",children:S(s.leido)})," leídos de HDFS"]}),s.shuffle!=null&&e.jsxs(E,{valor:s.shuffle,max:t.shuffle,children:[e.jsx("b",{className:"num",children:S(s.shuffle)})," por el shuffle, de una fase a otra"]}),s.discoLocal!=null&&e.jsxs(E,{valor:s.discoLocal,max:t.discoLocal,children:[e.jsx("b",{className:"num",children:S(s.discoLocal)})," al disco local de los nodos"]}),e.jsxs(E,{valor:s.mbSeconds,max:t.mbSeconds,children:[e.jsxs("b",{className:"num",title:"Los MB de cada contenedor por los segundos que estuvo vivo, sumados",children:[x(s.mbSeconds/1024,1)," GB·s"]})," de memoria × tiempo en YARN"]}),s.leido==null&&e.jsx("p",{className:"cp-mov-no",children:a.motor==="TEZ"?"Tez no guarda contadores sin Timeline Server: de esta corrida YARN solo sabe cuánto tardó y cuánta memoria usó.":"Los contadores todavía no llegaron al historial."})]})}function be({v:a,run:s,mov:t,maxMov:r,now:n,maxLineas:o,maxT:i}){const[l,p]=h.useState(!1),f=a.archivos.reduce((c,m)=>c+m.lineas,0),u=s?.at(-1),j=u&&O(u),d=async()=>{if(a.plantilla){p(!0);try{const c=await k().submitJob({template:a.plantilla,params:{}});L({kind:"run",title:`${a.nombre}: enviado a YARN`,description:"La columna muestra el tiempo cuando termina",action:{label:"Ver el trabajo",run:()=>g("yarn",c)}})}catch(c){L({kind:"bad",title:`${a.nombre}: no se pudo lanzar`,description:c instanceof Error?c.message:String(c)})}finally{p(!1)}}};return e.jsxs("article",{className:"cp-col",id:`cp-${a.id}`,"data-motor":R[a.motor].eng,"data-run":j||void 0,"aria-label":a.nombre,children:[e.jsxs("header",{className:"cp-col-h","data-capa":"lenguajes",children:[e.jsx("h3",{children:a.nombre}),e.jsx(Q,{engine:R[a.motor].eng}),e.jsx("p",{children:a.estilo})]}),e.jsxs("div",{className:"cp-med",children:[e.jsxs(E,{valor:f,max:o,children:[e.jsx("b",{className:"num",children:x(f)})," líneas hacen la cuenta"]}),u&&s?e.jsxs(E,{valor:D(s,n),max:i,children:[e.jsx("b",{className:"num",children:Y(D(s,n)/1e3)})," la última vez · ",e.jsxs("span",{"data-st":u.state,children:[le[u.state],j?` ${x(u.progress)} %`:""]})]}):e.jsx("div",{className:"cp-bar cp-bar-nada",children:"Todavía no corrió en este cluster"}),t&&e.jsx(je,{v:a,mov:t,max:r})]}),e.jsx(fe,{v:a,app:u}),e.jsx(me,{archivos:a.archivos}),e.jsx("p",{className:"cp-nota",children:a.nota}),e.jsxs("div",{className:"cp-acc",children:[a.plantilla?e.jsxs(W,{cap:ie[a.id],className:"btn btn-sm btn-primary",busy:l,onClick:d,children:[e.jsx(q,{size:12}),"Lanzar en YARN"]}):e.jsxs("button",{type:"button",className:"btn btn-sm btn-primary",onClick:()=>g("lenguajes","pig"),children:[e.jsx(U,{size:13}),"Probarlo en Lenguajes"]}),u&&e.jsxs("button",{type:"button",className:"btn btn-sm btn-ghost",onClick:()=>g("yarn",u.id),children:["Ver el trabajo",e.jsx($,{size:13})]}),e.jsx("button",{type:"button",className:"btn btn-sm btn-ghost",onClick:()=>g("hdfs",a.salida.slice(1)),children:"Ver el resultado"})]}),e.jsx(F,{cmd:a.cmd,bash:!0,donde:"o en la terminal, parado en /datos"})]})}function Se({sel:a}){const s=h.useRef(null),t=Math.max(0,A.findIndex(o=>o.id===a)),r=A[t],n=h.useRef(a);return h.useEffect(()=>{A.some(o=>o.id===n.current)&&s.current?.scrollIntoView({block:"start"})},[]),e.jsxs("section",{className:"cp-preg",ref:s,"aria-label":"Las preguntas de siempre",children:[e.jsx("div",{className:"cp-preg-tabs",role:"tablist","aria-label":"Qué comparar",children:A.map((o,i)=>e.jsxs("button",{type:"button",role:"tab","aria-selected":i===t,onClick:()=>_(o.id),children:[e.jsx("b",{children:o.pregunta}),e.jsx("small",{children:o.cuales})]},o.id))}),e.jsxs("div",{className:"cp-preg-body",role:"tabpanel","aria-label":r.t,children:[e.jsx("h3",{children:r.t}),e.jsx("p",{children:r.q}),e.jsx("div",{className:"cp-preg-wrap",children:e.jsxs("table",{className:"cp-tabla",children:[e.jsx("thead",{children:e.jsxs("tr",{children:[e.jsx("th",{}),r.cols.map(([o,i])=>e.jsx("th",{"data-capa":i,children:o},o))]})}),e.jsx("tbody",{children:r.rows.map(o=>e.jsxs("tr",{children:[e.jsx("th",{scope:"row",children:o[0]}),o.slice(1).map((i,l)=>e.jsx("td",{dangerouslySetInnerHTML:I(i)},l))]},o[0]))})]})})]})]})}function ye(a,s){const[t,r]=h.useState({}),[n,o]=h.useState(0),i=h.useRef({}),l=Object.values(a).filter(d=>d.every(c=>!O(c))).flatMap(d=>d.map(c=>c.id)),p=d=>!d||d.source==="rm"&&d.type!=="TEZ"&&d.state==="FINISHED",f=l.filter(d=>p(t[d])&&(i.current[d]??0)<6),u=f.join(",");h.useEffect(()=>{if(!s||!f.length)return;let d=!0;const c=setTimeout(()=>{f.forEach(m=>{i.current[m]=(i.current[m]??0)+1}),k().yarnMetrics(f.slice(0,12)).then(m=>{d&&(r(b=>({...b,...Object.fromEntries(m.map(N=>[N.id,N]))})),o(b=>b+1))},()=>{})},n?5e3:0);return()=>{d=!1,clearTimeout(c)}},[u,s,n]);const j={};for(const[d,c]of Object.entries(a)){const m=c.map(N=>t[N.id]),b=m.every(Boolean)?re(m):void 0;b&&(j[d]=b)}return j}function De(){const{status:a,apps:s}=w(),t=G(),r=h.useMemo(()=>oe(s),[s]),n=ye(r,a?.phase==="running");if(!a)return null;const o=new Set(s.filter(O).map(c=>c.type)),i=Object.fromEntries(Object.entries(r).map(([c,m])=>[c,m.at(-1)])),l=Math.max(...T.map(c=>c.archivos.reduce((m,b)=>m+b.lineas,0))),p=Math.max(0,...Object.values(r).map(c=>D(c,a.now))),f=Object.values(n),u={leido:Math.max(0,...f.map(c=>c.leido??0)),shuffle:Math.max(0,...f.map(c=>c.shuffle??0)),discoLocal:Math.max(0,...f.map(c=>c.discoLocal??0)),mbSeconds:Math.max(0,...f.map(c=>c.mbSeconds))},j=ce(n),d=M.tres.steps[M.tres.steps.length-1];return e.jsxs("div",{className:"page-in cp",children:[e.jsx(z,{title:"Comparar",sub:"La misma tarea hecha con cada herramienta: el código real, el motor que la ejecuta y en qué se diferencian."}),e.jsxs("div",{className:"cp-intro",children:[e.jsxs("div",{children:[e.jsx("h2",{children:"Ventas por producto, cuatro veces"}),e.jsx("p",{children:"Cuántas unidades se vendieron de cada producto y cuánto se facturó. El repo trae la cuenta escrita cuatro veces y las cuatro tienen que dar igual: los datos y quien reparte (YARN) son los mismos; cambia cómo la escribís y qué motor la hace."})]}),e.jsx("div",{className:"cp-intro-a",children:e.jsxs("button",{type:"button",className:"btn btn-sm",onClick:()=>g("inicio","recorrido/tres"),children:[e.jsx(B,{size:13}),"Verlo en el mapa"]})})]}),e.jsx(he,{vivos:o,ult:i}),e.jsx("div",{className:"cp-cols",children:T.map(c=>e.jsx(be,{v:c,run:r[c.id],mov:n[c.id],maxMov:u,now:a.now,maxLineas:l,maxT:p},c.id))}),j.length>0&&e.jsxs("section",{className:"cp-obs","aria-label":"Qué muestran los números",children:[e.jsx("h3",{children:"Qué muestran los números"}),e.jsx("ul",{children:j.map(c=>e.jsx("li",{children:c},c))}),e.jsx("p",{children:"Salen de la última corrida de cada una: el tiempo y la memoria, de YARN; lo leído, el shuffle y el disco local, de JobHistory (MapReduce) y de Spark History."})]}),e.jsxs("section",{className:"cp-cierre","aria-label":d.t,children:[e.jsxs("div",{children:[e.jsx("h3",{children:d.t}),e.jsx("div",{className:"cp-cierre-x",dangerouslySetInnerHTML:I(d.x)}),d.tip&&e.jsx("p",{className:"cp-cierre-tip",dangerouslySetInnerHTML:I(d.tip)})]}),e.jsxs("div",{children:[e.jsx("h3",{children:"¿Dieron lo mismo?"}),e.jsx("p",{className:"cp-cierre-p",children:"Cada una separa las columnas con otra cosa y ordena distinto: así se ven las cuatro una abajo de la otra, con el mismo formato."}),e.jsx(F,{cmd:ne,bash:!0,donde:"en la terminal del contenedor"})]})]}),e.jsxs("div",{className:"section-h cp-sec",children:[e.jsx("h2",{children:"¿Cuál uso?"}),e.jsx("span",{className:"muted",children:"Las preguntas de siempre, con una tabla cada una"})]}),e.jsx(Se,{sel:t})]})}export{De as CompararPage};
