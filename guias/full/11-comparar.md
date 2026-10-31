# 11. Comparar: la misma cuenta con cuatro herramientas

Ventas por producto escrita cuatro veces: MapReduce a mano, Pig, Hive y
PySpark. La pantalla las pone una al lado de la otra con el código real, el
motor que corre cada una y lo que movió en el cluster, y al final dice en
palabras qué muestran los números. Es la tabla "la misma tarea, con varias
herramientas" del [glosario](../glosario.md#la-misma-tarea-con-varias-herramientas),
corriendo.

[← 10. La Consola](10-consola.md) · [Índice de full](README.md)

La pantalla es **Comparar** (`G K`), en el grupo *Procesamiento* de la barra.
Los comandos van **adentro** del contenedor, parado en `/datos`.

## Paso 1. El recorrido de los datos

**Qué se ve.** Arriba, un esquema en cuatro columnas: el dato **una sola vez**
en HDFS (`/user/root/ventas`), los cuatro lenguajes (`mapper.py +
reducer.py`, `ventas.pig`, `ventas.hql`, `ventas.py`), los tres motores
(MapReduce, que usan dos de ellos, Tez y Spark) y las cuatro carpetas de
resultado. Mientras una versión corre, su fila se anima con el color de su
motor.

**Qué significa.** Lo que cambia entre las cuatro es **cómo se escribe** y
**quién hace la cuenta**; los datos y quien reparte la máquina (YARN) son los
mismos. Hive y Pig son lenguajes; MapReduce, Tez y Spark son motores.

## Paso 2. Una columna por herramienta

**Qué se ve.** Cada columna tiene:

- cuántas líneas hacen la cuenta (19, 14, 17 y 10), en la misma escala para
  las cuatro;
- cuánto tardó la última vez en YARN, o "Todavía no corrió en este cluster";
- las fases que arma el motor (map → shuffle → reduce, los vértices de Tez o
  las etapas de Spark), con las tareas reales de la última corrida si YARN
  las trae;
- el código, con "Solo la cuenta" o "Archivo entero";
- **Lanzar en YARN** (MapReduce, Hive y Spark) o **Probarlo en Lenguajes**
  (Pig), **Ver el trabajo**, **Ver el resultado** y el comando para la
  terminal.

**Qué hacer.** Si `/user/root/ventas` está vacío, lanzar cualquiera lo sube
primero. Lanzá las tres desde la pantalla, o desde la terminal:

<!-- prueba: no (necesita SERVICIOS=todo; tarda 1 o 2 minutos) -->
```bash
spark-submit ejemplos/ventas.py
beeline -u jdbc:hive2://localhost:10000 -f ejemplos/ventas.hql
pig ejemplos/ventas.pig
```

## Paso 3. Lo que movió cada corrida

**Qué se ve.** Cuando todos los trabajos de una versión terminan, su columna
suma *Lo que movió*: lo leído de HDFS, lo que pasó por el **shuffle**, lo que
se escribió en el **disco local** de los nodos y la **memoria por tiempo** que
ocupó en YARN (GB·s). Pig lanza varios trabajos por script y la columna los
suma. Debajo de las columnas, *Qué muestran los números* lo dice en palabras.

Con las salidas reales del contenedor (ventas de 5,9 MB):

| | MapReduce a mano | PySpark |
|---|---|---|
| Leído de HDFS | 5,9 MB | 18,0 MB |
| Shuffle | 3,2 MB | 3,0 KB |
| Disco local | 7,2 MB | 2,2 KB |
| Memoria por tiempo | 19,0 GB·s | 72,7 GB·s |
| Tiempo | 19 s | 28 s |

**Qué significa.**

- `mapper.py` emite una línea por venta y las 200.000 viajan por el shuffle;
  Spark suma por producto en cada partición antes de mandar (lo que en
  MapReduce sería un **combiner**) y manda unas pocas filas.
- PySpark lee la entrada tres veces: `inferSchema` la recorre entera para
  adivinar los tipos y cada acción (`show`, `write`) la vuelve a leer, porque
  el programa no usa `cache()`.
- Spark tarda más en un archivo tan chico: arrancar el driver y los executors
  lleva más que la cuenta. Con datos que no entran en un nodo, o con pasos que
  se repiten, la diferencia se da vuelta.
- De Hive solo se ven el tiempo y la memoria: **Tez no guarda contadores sin
  el Timeline Server**, y la columna lo avisa.

**De dónde sale.** `GET /api/yarn/metrics?apps=…`: el tiempo y la memoria, del
ResourceManager; lo leído, el shuffle y el disco local, de JobHistory
(MapReduce) y de Spark History. A mano:

<!-- prueba: no (necesita un trabajo terminado; cambiá el id por el tuyo) -->
```bash
curl -s http://localhost:8088/ws/v1/cluster/apps/application_1792695340081_0001 | grep -o '"memorySeconds":[0-9]*'
curl -s http://localhost:19888/ws/v1/history/mapreduce/jobs/job_1792695340081_0001/counters | grep -o '"REDUCE_SHUFFLE_BYTES"[^}]*'
```

## Paso 4. ¿Dieron lo mismo?

**Qué se ve.** Al final, "Qué cambió y qué no" (el último paso del recorrido
*Una consulta, tres motores* del mapa) y un comando que muestra las cuatro
salidas con el mismo formato.

<!-- prueba: no (necesita las cuatro versiones corridas) -->
```bash
for h in mr pig hive spark; do
  echo "== $h"
  hdfs dfs -cat "/user/root/resultados/${h}_por_producto/*" | tr '\t' ',' | grep -v '^producto' | sort
done
```

**Qué significa.** Las cuatro tienen que dar las mismas 8 filas. Cada una
separa con otra cosa (tabulador o coma) y ordena distinto: por eso el `tr` y
el `sort`.

## Paso 5. ¿Cuál uso?

**Qué se ve.** Abajo, seis preguntas con una tabla cada una: ¿Cómo lo pido?,
¿Quién hace el trabajo?, ¿Dónde quedan los datos?, ¿Una máquina o el
cluster?, ¿Quién coordina qué? y ¿Cómo entran los datos? Cada una tiene su
dirección (por ejemplo `#comparar/quien-hace-el-trabajo`), y desde Inicio se
llega con un clic.

## Paso 6. El glosario

**Qué se ve.** El `?` de cada pantalla tiene dos pestañas: *Esta pantalla*,
con sus conceptos y atajos y los términos del glosario que van con ella, y
**Glosario**, con todas las palabras del cluster ordenadas por capa y un
buscador. En `Ctrl+K`, escribir una palabra (por ejemplo "shuffle") también
abre el glosario en ella.

**Qué significa.** Es el mismo texto que [`guias/glosario.md`](../glosario.md):
la interfaz lo lee de ese archivo cuando se arma la imagen.

## Dónde se usa esto en la industria

Elegir el motor por lo que **mueve** y no solo por lo que tarda es el trabajo
diario de quien opera un cluster. Spark muestra lo mismo en su interfaz (la
pestaña *Stages*, con *Shuffle Read* y *Spill*); en la nube, **EMR**,
**Dataproc** y **Databricks** cobran por memoria y CPU por tiempo, que es la
cuenta de *memoria por tiempo* de esta pantalla. Ver
[teoría: ciclo de vida en YARN](teoria/ciclo-de-vida-yarn.md).
