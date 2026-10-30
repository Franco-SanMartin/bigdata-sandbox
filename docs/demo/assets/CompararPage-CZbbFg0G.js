import{b as p,j as a,aq as O,aU as I,w as M,D as L,A as P}from"./ui-BGuQVCdD.js";import{u as F,g as k,n as m,i as v,A as U,s as B,w as q,t as y}from"./index-DgB3CnYj.js";import{d as g,R as N,c as C,C as b,e as H}from"./ecosistema-DXkvSzpq.js";import{P as w}from"./PageHeader-DNiQHXj1.js";import{G}from"./Gated-DLdIrPzM.js";import{E as _}from"./Trace-HQvXshLx.js";import"./graficos-U6iFCXIg.js";import"./HelpTip-DsP38esV.js";import"./capabilities-DAs5FLnu.js";const Y=`"""Mapper de Hadoop Streaming: ventas por producto.

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
`,$=`"""Reducer de Hadoop Streaming: ventas por producto.

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
`,V=`-- Ventas por producto, en Pig Latin.
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
`,z=`-- Ventas por producto, en Hive (SQL).
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
`,X=`"""Ventas por producto, en Spark (PySpark).

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
`;function W(e,r,t){const o=e.replace(/\r\n/g,`
`).split(`
`),n=o.findIndex(l=>r.test(l));if(n<0)return e.trim();const s=t?o.findIndex((l,c)=>c>n&&t.test(l)):-1;return o.slice(n,s<0?o.length:s+1).join(`
`).trim()}const K=(e,r)=>e.split(`
`).filter(t=>t.trim()&&!t.trim().startsWith(r)).length,h=(e,r,t,o,n)=>{const s=W(r,o,n);return{nombre:e,texto:r.replace(/\r\n/g,`
`).trim(),nucleo:s,lineas:K(s,t)}},u="/user/root/resultados",f=[{id:"streaming",nombre:"MapReduce a mano",estilo:"Escribís vos el map y el reduce, en Python",motor:"MAPREDUCE",archivos:[h("mapper.py",Y,"#",/^import sys/),h("reducer.py",$,"#",/^import sys/)],cmd:`hdfs dfs -rm -r -f ${u}/mr_por_producto
hadoop jar $HADOOP_HOME/share/hadoop/tools/lib/hadoop-streaming-*.jar \\
  -files ejemplos/mapper.py,ejemplos/reducer.py \\
  -mapper "python3 mapper.py" -reducer "python3 reducer.py" \\
  -input /user/root/ventas -output ${u}/mr_por_producto`,plantilla:"mr-ventas",salida:`${u}/mr_por_producto`,fases:[{t:"map"},{t:"shuffle"},{t:"reduce"}],faseNota:"Un trabajo: un map por bloque, el shuffle ordena y agrupa por producto y el reduce suma.",nota:"No ordena por facturación: para eso haría falta un segundo trabajo entero.",esSuya:e=>e.type==="MAPREDUCE"&&/streamjob|mapper\.py/i.test(e.name)},{id:"pig",nombre:"Pig Latin",estilo:"Describís los pasos y Pig escribe el map y el reduce por vos",motor:"MAPREDUCE",archivos:[h("ventas.pig",V,"--",/^ventas = LOAD/,/^STORE /)],cmd:"pig ejemplos/ventas.pig",salida:`${u}/pig_por_producto`,fases:[{t:"GROUP"},{t:"HDFS",disco:!0},{t:"ORDER"}],faseNota:"Varios trabajos MapReduce en fila: entre uno y otro, el resultado se escribe en HDFS.",nota:"Nada corre hasta el STORE: recién ahí Pig arma el plan entero.",esSuya:e=>e.type==="MAPREDUCE"&&/PigLatin:ventas\.pig/i.test(e.name)},{id:"hive",nombre:"HiveQL",estilo:"SQL: decís qué querés y Hive arma el plan",motor:"TEZ",archivos:[h("ventas.hql",z,"--",/^CREATE EXTERNAL TABLE/,/^ORDER BY facturado DESC;/)],cmd:"beeline -u jdbc:hive2://localhost:10000 -f ejemplos/ventas.hql",plantilla:"hive-ventas",salida:`${u}/hive_por_producto`,fases:[{t:"Map 1"},{t:"Reducer 2"},{t:"Reducer 3"}],faseNota:"Un solo DAG de Tez: agrupa y ordena sin escribir en HDFS en el medio.",nota:"Casi todo es crear la tabla, y eso se hace una sola vez: queda en el Metastore y Spark SQL la lee igual.",esSuya:e=>e.type==="TEZ"&&/^HIVE/i.test(e.name)},{id:"pyspark",nombre:"PySpark",estilo:"Código Python que encadena operaciones sobre DataFrames",motor:"SPARK",archivos:[h("ventas.py",X,"#",/^from pyspark/,/^\)\s*$/)],cmd:"spark-submit ejemplos/ventas.py",plantilla:"spark-ventas",salida:`${u}/spark_por_producto`,fases:[{t:"leer"},{t:"sumar"},{t:"ordenar"}],faseNota:"Etapas en memoria separadas por shuffles; los executors viven mientras dura el programa.",nota:"Nada corre hasta una acción (show, write): recién ahí Spark arma el plan.",esSuya:e=>e.type==="SPARK"&&/ventas por producto/i.test(e.name)}],j={MAPREDUCE:{nombre:"MapReduce",eng:"mr"},TEZ:{nombre:"Tez",eng:"tez"},SPARK:{nombre:"Spark",eng:"spark"}},A={carpeta:"/user/root/ventas"},Q=`for h in mr pig hive spark; do
  echo "== $h"
  hdfs dfs -cat "${u}/\${h}_por_producto/*" | tr '\\t' ',' | grep -v '^producto' | sort
done`;function Z(e){const r={};for(const t of f){const o=e.filter(t.esSuya).sort((n,s)=>s.submittedAt-n.submittedAt);o[0]&&(r[t.id]=o[0])}return r}const R=(e,r)=>Math.max(0,(e.finishedAt??r)-(e.startedAt??e.submittedAt)),x=e=>({__html:e}),J={streaming:"mapreduce",pig:"pig",hive:"tez",pyspark:"spark"},aa={ACCEPTED:"en la cola",RUNNING:"corriendo",FINISHED:"terminó",FAILED:"falló",KILLED:"la cortaron"},S=e=>new RegExp(`^(?:${e.trim().split(/\s+/).join("|")})$`),ea={py:S("import from for in if not is None print and or as return def"),sql:S("CREATE EXTERNAL TABLE IF NOT EXISTS ROW FORMAT DELIMITED FIELDS TERMINATED BY STORED AS LOCATION TBLPROPERTIES SELECT SUM CAST FROM GROUP ORDER DESC STRING INT BIGINT TEXTFILE"),pig:S("LOAD USING AS FILTER BY FOREACH GENERATE GROUP SUM ORDER DESC STORE INTO fs")},sa=e=>e.endsWith(".py")?"py":e.endsWith(".pig")?"pig":"sql";function na({l:e,lang:r}){const t=r==="py"?"#":"--",o=e.indexOf(t),n=o<0?e:e.slice(0,o),s=o<0?"":e.slice(o),l=n.split(/("[^"]*"|'[^']*'|\b\w+\b)/);return a.jsxs(a.Fragment,{children:[l.map((c,i)=>/^["']/.test(c)?a.jsx("span",{className:"cp-tx",children:c},i):ea[r].test(c)?a.jsx("span",{className:"cp-kw",children:c},i):a.jsx(p.Fragment,{children:c},i)),s&&a.jsx("span",{className:"cp-com",children:s}),`
`]})}function ra({archivos:e}){const[r,t]=p.useState(0),[o,n]=p.useState(!1),s=e[r],l=o?s.texto:s.nucleo;return a.jsxs("div",{className:"cp-src",children:[a.jsxs("div",{className:"cp-src-h",children:[a.jsx("div",{role:"tablist","aria-label":"Archivos",children:e.map((c,i)=>a.jsx("button",{type:"button",role:"tab","aria-selected":i===r,onClick:()=>t(i),className:"mono",children:c.nombre},c.nombre))}),a.jsx("button",{type:"button",className:"cp-src-t","aria-pressed":o,onClick:()=>n(c=>!c),children:o?"Solo la cuenta":"Archivo entero"})]}),a.jsx("pre",{className:"cp-pre mono",tabIndex:0,"aria-label":`${s.nombre}${o?"":", lo que hace la cuenta"}`,children:l.split(`
`).map((c,i)=>a.jsx(na,{l:c,lang:sa(s.nombre)},i))}),a.jsxs("div",{className:"cp-src-f",children:[a.jsxs("span",{children:["datos/ejemplos/",s.nombre]}),a.jsx(H,{texto:l})]})]})}function oa({vivos:e,ult:r}){const t=[{m:"MAPREDUCE",filas:"2 / span 2"},{m:"TEZ",filas:"4"},{m:"SPARK",filas:"5"}],o=(n,s)=>a.jsx("span",{className:"cp-fl-cap",style:{gridColumn:n,gridRow:1},children:s});return a.jsxs("section",{className:"cp-flujo","aria-label":"El recorrido de los datos en las cuatro versiones",children:[o(1,"Almacenamiento"),o(3,"Lenguaje · cómo lo pedís"),o(5,"Motor · quién hace la cuenta"),o(7,"Resultado, otra vez en HDFS"),a.jsxs("div",{className:"cp-fl-dato","data-capa":"datos",style:{gridRow:"2 / span 4"},children:[a.jsx("span",{className:"cp-fl-k",children:"El dato, una sola vez"}),a.jsx("b",{className:"mono",children:A.carpeta}),a.jsx("small",{children:"HDFS guarda ventas.csv en bloques. Ninguna versión lo copia: las cuatro leen de acá."}),a.jsxs("button",{type:"button",className:"btn btn-sm",onClick:()=>m("hdfs",A.carpeta.slice(1)),children:[a.jsx(I,{size:13}),"Ver en HDFS"]})]}),f.map((n,s)=>{const l=r[n.id],c=l&&g(l)||void 0;return a.jsxs(p.Fragment,{children:[a.jsx("i",{className:"cp-fl-w",style:{gridRow:s+2,gridColumn:2},"data-run":c,"aria-hidden":"true"}),a.jsxs("a",{className:"cp-fl-l","data-capa":"lenguajes",href:"#comparar",onClick:i=>{i.preventDefault(),document.getElementById(`cp-${n.id}`)?.scrollIntoView({behavior:"smooth",block:"start"})},style:{gridRow:s+2},children:[a.jsx("b",{children:n.nombre}),a.jsx("small",{className:"mono",children:n.archivos.map(i=>i.nombre).join(" + ")})]}),a.jsx("i",{className:"cp-fl-w",style:{gridRow:s+2,gridColumn:4},"data-run":c,"aria-hidden":"true"}),a.jsx("i",{className:"cp-fl-w",style:{gridRow:s+2,gridColumn:6},"data-run":c,"aria-hidden":"true"}),a.jsx("span",{className:"cp-fl-out mono","data-capa":"datos",style:{gridRow:s+2},children:n.salida.replace("/user/root/","")})]},n.id)}),t.map(({m:n,filas:s})=>a.jsxs("div",{className:"cp-fl-m","data-motor":j[n].eng,"data-run":e.has(n)||void 0,style:{gridRow:s},children:[a.jsx("b",{children:j[n].nombre}),a.jsx("small",{children:e.has(n)?"corriendo ahora":a.jsxs(a.Fragment,{children:["en YARN: ",a.jsx("span",{className:"mono",children:n})]})})]},n))]})}function T({valor:e,max:r,children:t}){return a.jsxs("div",{className:"cp-bar",children:[a.jsx("span",{className:"cp-bar-t",children:t}),a.jsx("span",{className:"cp-bar-0","aria-hidden":"true",children:a.jsx("i",{style:{width:`${r?Math.max(4,e/r*100):0}%`}})})]})}function ta({v:e,app:r}){const t=r?.stages.length?r.stages.map(n=>({t:n.name,n:n.tasks.length,st:n.state,disco:!1})):null,o=t??e.fases.map(n=>({t:n.t,n:0,st:void 0,disco:!!n.disco}));return a.jsxs("div",{className:"cp-fases","aria-label":`Fases de ${j[e.motor].nombre}`,children:[a.jsx("ol",{children:o.map((n,s)=>a.jsxs("li",{"data-disco":n.disco||void 0,"data-st":n.st,children:[n.t,n.n>0&&a.jsxs("small",{className:"num",children:["×",n.n]})]},s))}),a.jsxs("p",{children:[t?"Las fases de la última corrida, como las contó YARN. ":"",e.faseNota]})]})}function ca({v:e,app:r,now:t,maxLineas:o,maxT:n}){const[s,l]=p.useState(!1),c=e.archivos.reduce((d,D)=>d+D.lineas,0),i=r&&g(r),E=async()=>{if(e.plantilla){l(!0);try{const d=await q().submitJob({template:e.plantilla,params:{}});y({kind:"run",title:`${e.nombre}: enviado a YARN`,description:"La columna muestra el tiempo cuando termina",action:{label:"Ver el trabajo",run:()=>m("yarn",d)}})}catch(d){y({kind:"bad",title:`${e.nombre}: no se pudo lanzar`,description:d instanceof Error?d.message:String(d)})}finally{l(!1)}}};return a.jsxs("article",{className:"cp-col",id:`cp-${e.id}`,"data-motor":j[e.motor].eng,"data-run":i||void 0,"aria-label":e.nombre,children:[a.jsxs("header",{className:"cp-col-h","data-capa":"lenguajes",children:[a.jsx("h3",{children:e.nombre}),a.jsx(_,{engine:j[e.motor].eng}),a.jsx("p",{children:e.estilo})]}),a.jsxs("div",{className:"cp-med",children:[a.jsxs(T,{valor:c,max:o,children:[a.jsx("b",{className:"num",children:v(c)})," líneas hacen la cuenta"]}),r?a.jsxs(T,{valor:R(r,t),max:n,children:[a.jsx("b",{className:"num",children:U(R(r,t)/1e3)})," la última vez · ",a.jsxs("span",{"data-st":r.state,children:[aa[r.state],i?` ${v(r.progress)} %`:""]})]}):a.jsx("div",{className:"cp-bar cp-bar-nada",children:"Todavía no corrió en este cluster"})]}),a.jsx(ta,{v:e,app:r}),a.jsx(ra,{archivos:e.archivos}),a.jsx("p",{className:"cp-nota",children:e.nota}),a.jsxs("div",{className:"cp-acc",children:[e.plantilla?a.jsxs(G,{cap:J[e.id],className:"btn btn-sm btn-primary",busy:s,onClick:E,children:[a.jsx(M,{size:12}),"Lanzar en YARN"]}):a.jsxs("button",{type:"button",className:"btn btn-sm btn-primary",onClick:()=>m("datos"),children:[a.jsx(L,{size:13}),"Probarlo en Consultas"]}),r&&a.jsxs("button",{type:"button",className:"btn btn-sm btn-ghost",onClick:()=>m("yarn",r.id),children:["Ver el trabajo",a.jsx(P,{size:13})]}),a.jsx("button",{type:"button",className:"btn btn-sm btn-ghost",onClick:()=>m("hdfs",e.salida.slice(1)),children:"Ver el resultado"})]}),a.jsx(C,{cmd:e.cmd,bash:!0,donde:"o en la terminal, parado en /datos"})]})}function ia({sel:e}){const r=p.useRef(null),t=Math.max(0,b.findIndex(s=>s.id===e)),o=b[t],n=p.useRef(e);return p.useEffect(()=>{b.some(s=>s.id===n.current)&&r.current?.scrollIntoView({block:"start"})},[]),a.jsxs("section",{className:"cp-preg",ref:r,"aria-label":"Las preguntas de siempre",children:[a.jsx("div",{className:"cp-preg-tabs",role:"tablist","aria-label":"Qué comparar",children:b.map((s,l)=>a.jsxs("button",{type:"button",role:"tab","aria-selected":l===t,onClick:()=>B(s.id),children:[a.jsx("b",{children:s.pregunta}),a.jsx("small",{children:s.cuales})]},s.id))}),a.jsxs("div",{className:"cp-preg-body",role:"tabpanel","aria-label":o.t,children:[a.jsx("h3",{children:o.t}),a.jsx("p",{children:o.q}),a.jsx("div",{className:"cp-preg-wrap",children:a.jsxs("table",{className:"cp-tabla",children:[a.jsx("thead",{children:a.jsxs("tr",{children:[a.jsx("th",{}),o.cols.map(([s,l])=>a.jsx("th",{"data-capa":l,children:s},s))]})}),a.jsx("tbody",{children:o.rows.map(s=>a.jsxs("tr",{children:[a.jsx("th",{scope:"row",children:s[0]}),s.slice(1).map((l,c)=>a.jsx("td",{dangerouslySetInnerHTML:x(l)},c))]},s[0]))})]})})]})]})}function Ea(){const{status:e,apps:r}=F(),t=k(),o=p.useMemo(()=>Z(r),[r]);if(!e)return null;const n=new Set(r.filter(g).map(i=>i.type)),s=Math.max(...f.map(i=>i.archivos.reduce((E,d)=>E+d.lineas,0))),l=Math.max(0,...Object.values(o).map(i=>R(i,e.now))),c=N.tres.steps[N.tres.steps.length-1];return a.jsxs("div",{className:"page-in cp",children:[a.jsx(w,{title:"Comparar",sub:"La misma tarea hecha con cada herramienta: el código real, el motor que la ejecuta y en qué se diferencian."}),a.jsxs("div",{className:"cp-intro",children:[a.jsxs("div",{children:[a.jsx("h2",{children:"Ventas por producto, cuatro veces"}),a.jsx("p",{children:"Cuántas unidades se vendieron de cada producto y cuánto se facturó. El repo trae la cuenta escrita cuatro veces y las cuatro tienen que dar igual: los datos y quien reparte (YARN) son los mismos; cambia cómo la escribís y qué motor la hace."})]}),a.jsx("div",{className:"cp-intro-a",children:a.jsxs("button",{type:"button",className:"btn btn-sm",onClick:()=>m("inicio","recorrido/tres"),children:[a.jsx(O,{size:13}),"Verlo en el mapa"]})})]}),a.jsx(oa,{vivos:n,ult:o}),a.jsx("div",{className:"cp-cols",children:f.map(i=>a.jsx(ca,{v:i,app:o[i.id],now:e.now,maxLineas:s,maxT:l},i.id))}),a.jsxs("section",{className:"cp-cierre","aria-label":c.t,children:[a.jsxs("div",{children:[a.jsx("h3",{children:c.t}),a.jsx("div",{className:"cp-cierre-x",dangerouslySetInnerHTML:x(c.x)}),c.tip&&a.jsx("p",{className:"cp-cierre-tip",dangerouslySetInnerHTML:x(c.tip)})]}),a.jsxs("div",{children:[a.jsx("h3",{children:"¿Dieron lo mismo?"}),a.jsx("p",{className:"cp-cierre-p",children:"Cada una separa las columnas con otra cosa y ordena distinto: así se ven las cuatro una abajo de la otra, con el mismo formato."}),a.jsx(C,{cmd:Q,bash:!0,donde:"en la terminal del contenedor"})]})]}),a.jsxs("div",{className:"section-h cp-sec",children:[a.jsx("h2",{children:"¿Cuál uso?"}),a.jsx("span",{className:"muted",children:"Las preguntas de siempre, con una tabla cada una"})]}),a.jsx(ia,{sel:t})]})}export{Ea as CompararPage};
