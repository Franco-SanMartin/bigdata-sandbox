# Evaluación 3. YARN y MapReduce

[← 2. HDFS](02-hdfs.md) · [Evaluación](README.md) · Teoría: [YARN y MapReduce](../teoria/03-yarn-mapreduce.md) · Guía: [4. YARN y MapReduce](../../04-yarn-mapreduce.md) · Siguiente: [4. Pig →](04-pig.md)

## Opción múltiple

**1.** ¿Qué hace el ResourceManager de YARN?

- a) Ejecuta las tareas map y reduce.
- b) Reparte la memoria y la CPU del cluster entre los trabajos; el
  seguimiento de cada trabajo lo hace su ApplicationMaster.
- c) Guarda los resultados de los trabajos.
- d) Ordena los pares clave-valor en el shuffle.

<details><summary>Respuesta</summary>

**b)** YARN separa repartir recursos (ResourceManager) de coordinar un
trabajo (ApplicationMaster, uno por trabajo).

- a) Las tareas corren en contenedores de los NodeManagers.
- c) Los resultados van a HDFS.
- d) El shuffle lo hacen las tareas del trabajo, no el ResourceManager.

</details>

**2.** ¿Qué ganó Hadoop al pasar del JobTracker (Hadoop 1) a YARN?

- a) Poder correr en el mismo cluster otros motores además de MapReduce
  (Tez, Spark), y sacar el cuello de botella de un proceso que hacía todo.
- b) No necesitar HDFS.
- c) Que MapReduce no escriba en disco.
- d) Correr sin Java.

<details><summary>Respuesta</summary>

**a)** Cada trabajo trae su ApplicationMaster; el ResourceManager solo
reparte. Por eso en http://localhost:8088 aparecen trabajos `MAPREDUCE`,
`TEZ` y `SPARK`.

- b) YARN es la capa de recursos; los datos siguen en HDFS.
- c) MapReduce sigue escribiendo en disco entre etapas; los que no lo hacen
  son Tez y Spark.
- d) Todo el ecosistema sigue en la JVM.

</details>

**3.** En el wordcount de la guía 4, ¿qué emite el mapper por cada palabra?

- a) `(palabra, 1)`
- b) `(1, palabra)`
- c) `(línea, cantidad de palabras)`
- d) La palabra sola, sin valor.

<details><summary>Respuesta</summary>

**a)** La clave es la palabra (por ella se agrupa) y el valor es un 1; el
reducer suma los unos de cada palabra.

- b) La clave tiene que ser lo que se agrupa: con la clave `1` todas las
  palabras irían juntas.
- c) Eso contaría palabras por línea, no por palabra.
- d) Sin valor no hay nada que sumar (aunque contar las apariciones de la
  clave daría lo mismo, el ejemplo emite el 1).

</details>

**4.** ¿Qué pasa en el **shuffle**?

- a) Se mezclan las filas al azar para balancear.
- b) Cada reducer copia de todos los mappers los pares de las claves que le
  tocan, y los ordena por clave.
- c) Se borran los duplicados.
- d) Se replica la entrada en tres DataNodes.

<details><summary>Respuesta</summary>

**b)** Gracias al shuffle, cada reducer recibe todas las apariciones de una
clave, juntas y ordenadas.

- a) "Shuffle" no es aleatorio: es redistribuir por clave.
- c) No se elimina nada: los duplicados son justamente lo que se suma.
- d) La replicación es cosa de HDFS, no del shuffle.

</details>

**5.** El trabajo de Streaming de la guía 4 tuvo `number of splits:6`. ¿Por
qué 6?

- a) Porque hay 6 productos más el encabezado.
- b) Porque el archivo de 6 MB está en 6 bloques de 1 MB, y hay un split
  (un mapper) por bloque.
- c) Porque YARN tiene 6 contenedores.
- d) Porque se lo pidió con `-m 6`.

<details><summary>Respuesta</summary>

**b)** La cantidad de mappers la decide la entrada. Con bloques de 128 MB
habría sido 1.

- a) Hay 8 productos, y la cantidad de claves no define los mappers.
- c) YARN tiene lugar para 8 contenedores de 512 MB, y uno es del
  ApplicationMaster; además, si hubiera más splits que lugar, esperarían.
- d) `-m` es de Sqoop; el comando no lo tiene.

</details>

**6.** Corrés el wordcount dos veces seguidas con la misma carpeta de salida,
sin borrarla. ¿Qué pasa la segunda vez?

- a) Pisa el resultado anterior.
- b) Agrega los resultados al final.
- c) Falla con `Output directory ... already exists`.
- d) Crea `wc-out-2`.

<details><summary>Respuesta</summary>

**c)** MapReduce se niega a escribir en una carpeta existente, para no mezclar
resultados de una corrida fallida con los anteriores. Por eso la guía hace
`hdfs dfs -rm -r -f` antes.

- a), b) y d) Ninguna de esas es la conducta de MapReduce.

</details>

**7.** ¿Qué hace `sort` en `cat ventas.csv | python3 mapper.py | sort |
python3 reducer.py`?

- a) Ordena el resultado final por facturación.
- b) Hace de shuffle: deja juntas las líneas de un mismo producto, como las
  recibiría un reducer.
- c) Saca el encabezado.
- d) Nada: es opcional.

<details><summary>Respuesta</summary>

**b)** `reducer.py` suma mientras el producto no cambia: si las líneas no
llegaran agrupadas, emitiría un mismo producto varias veces.

- a) El orden del resultado es alfabético por producto, no por facturación.
- c) El encabezado lo saltea el mapper (`campos[0] == "fecha"`).
- d) Sin `sort`, el resultado es incorrecto.

</details>

**8.** Un trabajo queda en estado `ACCEPTED` y no avanza. ¿Cuál es la causa
más probable en la imagen?

- a) El archivo de entrada no existe.
- b) No hay memoria libre en YARN para su ApplicationMaster, por ejemplo
  porque una consola de `pyspark` abierta retiene contenedores.
- c) HDFS está en safe mode.
- d) El reducer tiene un error.

<details><summary>Respuesta</summary>

**b)** `ACCEPTED` es "aceptado, esperando recursos". El NodeManager tiene
4096 MB y los contenedores son de 512 MB como mínimo.

- a) Un archivo que no existe hace **fallar** el trabajo (`FAILED`), no
  esperar.
- c) En safe mode no se puede escribir la salida: falla.
- d) Un error en el reducer se ve como tareas fallidas cuando el trabajo ya
  está corriendo (`RUNNING`).

</details>

**9.** Si una tarea map falla, ¿qué hace MapReduce?

- a) Cancela el trabajo entero.
- b) La reintenta en otro contenedor (hasta 4 veces de fábrica), y como solo
  depende de su entrada, da el mismo resultado.
- c) Sigue sin esos datos.
- d) Le pide al usuario que la vuelva a lanzar.

<details><summary>Respuesta</summary>

**b)** Las funciones map y reduce no tienen efectos secundarios: repetirlas es
seguro.

- a) Recién falla el trabajo si una tarea agota sus reintentos.
- c) Perder datos en silencio sería un resultado incorrecto.
- d) Es automático.

</details>

**10.** ¿Para qué sirve el **combiner**?

- a) Para unir dos archivos de entrada.
- b) Para hacer una reducción parcial en cada mapper (por ejemplo, sumar
  antes de mandar) y achicar los datos que viajan en el shuffle.
- c) Para combinar los `part-r-*` en un solo archivo.
- d) Para elegir el reducer de cada clave.

<details><summary>Respuesta</summary>

**b)** Si la operación es asociativa y conmutativa (como la suma), sumar
antes en cada mapper da el mismo resultado y manda muchos menos pares por la
red.

- a) Eso es un JOIN.
- c) Eso se hace después, por ejemplo con `hdfs dfs -getmerge`.
- d) Eso lo hace el *partitioner*.

</details>

## Desarrollo

**1.** Describí el recorrido de un trabajo en YARN desde que se lanza con
`hadoop jar` hasta que termina. Nombrá cada proceso que interviene.

<details><summary>Respuesta modelo</summary>

1. El cliente (`hadoop jar`) envía el trabajo al **ResourceManager**.
2. El ResourceManager le pide a un **NodeManager** un contenedor para el
   **ApplicationMaster** del trabajo.
3. El ApplicationMaster calcula las tareas (un mapper por split) y le pide al
   ResourceManager contenedores para ellas, preferentemente en nodos que
   tengan los bloques.
4. Los NodeManagers lanzan las tareas en esos contenedores; el
   ApplicationMaster las vigila y reintenta las que fallan.
5. Al terminar, el ApplicationMaster avisa al ResourceManager, se liberan los
   contenedores, y el **JobHistory Server** (19888) guarda el detalle del
   trabajo.

</details>

**2.** Explicá por qué MapReduce es lento para cálculos de varias etapas (por
ejemplo, un JOIN seguido de un GROUP BY seguido de un ORDER BY). ¿Qué
herramientas resolvieron eso y cómo?

<details><summary>Respuesta modelo</summary>

Cada trabajo MapReduce tiene una sola etapa map y una reduce, y escribe su
resultado en HDFS (con réplicas). Tres operaciones son tres trabajos
encadenados: el segundo lee de HDFS lo que escribió el primero, y cada uno
paga además el arranque de sus contenedores. Para algoritmos iterativos, que
recorren los datos muchas veces, el costo se multiplica.

- **Tez** (el motor de Hive) arma la consulta entera como un solo grafo de
  etapas (DAG), sin escribir en HDFS entre ellas.
- **Spark** también planifica el cálculo entero como un DAG y mantiene en
  memoria lo intermedio, que además se puede reusar (`cache`).

</details>

**3.** ¿Qué es Hadoop Streaming y qué convención tienen que respetar el
mapper y el reducer?

<details><summary>Respuesta modelo</summary>

Es una forma de usar como mapper y reducer **cualquier programa** que lea de
la entrada estándar y escriba en la salida estándar (Python, en la guía).
Hadoop le pasa los registros línea por línea y lee lo que imprime.

La convención: cada línea de salida es `clave<TAB>valor`, donde la clave es lo
que está antes del primer tab. El reducer recibe las líneas **ordenadas por
clave**, así que puede acumular mientras la clave no cambia y emitir cuando
cambia. Es lo que hace `reducer.py`. `-files` manda los scripts a cada nodo.

</details>

## Ejercicios sobre la imagen

Suponen las ventas en `/user/root/ventas` ([guía 3](../../03-hdfs.md#un-dataset-de-verdad-200000-ventas)).

### Ejercicio 1. Ventas por sucursal con Streaming

Escribí un `mapper_sucursal.py` que emita `sucursal<TAB>cantidad<TAB>importe`
y usalo con el mismo `reducer.py` de la guía:

1. Probalo sin Hadoop sobre `ejemplos/ventas.csv`.
2. Corrélo en el cluster sobre las 200.000 ventas, con salida en
   `/user/root/resultados/mr_por_sucursal`.

¿Por qué el reducer no hace falta cambiarlo?

<details><summary>Solución</summary>

<!-- prueba: adentro | espera: Centro	9	55000 | espera: 475765400 -->
```bash
cat > mapper_sucursal.py <<'EOF'
import sys

for linea in sys.stdin:
    campos = linea.strip().split(",")
    if len(campos) != 5 or campos[0] == "fecha":
        continue
    fecha, sucursal, producto, cantidad, precio = campos
    print(f"{sucursal}\t{cantidad}\t{int(cantidad) * int(precio)}")
EOF
cat ejemplos/ventas.csv | python3 mapper_sucursal.py | sort | python3 ejemplos/reducer.py
hdfs dfs -rm -r -f /user/root/resultados/mr_por_sucursal
hadoop jar $HADOOP_HOME/share/hadoop/tools/lib/hadoop-streaming-3.3.6.jar \
  -files mapper_sucursal.py,ejemplos/reducer.py \
  -mapper "python3 mapper_sucursal.py" -reducer "python3 reducer.py" \
  -input /user/root/ventas -output /user/root/resultados/mr_por_sucursal
hdfs dfs -cat /user/root/resultados/mr_por_sucursal/part-*
```

Sobre el archivo chico:

```text
Centro	9	55000
Norte	2	10500
Sur	4	22000
```

En el cluster (sucursal, unidades, facturado):

```text
Centro	149271	475765400
Norte	150209	480187600
Oeste	149954	480328000
Sur	149639	476986200
```

El reducer no cambia porque no sabe qué es la clave: suma las dos columnas
mientras la clave se repite. Solo cambió qué emite el mapper como clave. La
suma de las cuatro sucursales da el mismo total que la de los 8 productos
(1.913.267.200).

</details>

**Rúbrica (10 puntos)**

| Criterio | Puntos |
|---|---:|
| Mapper correcto (saltea el encabezado, emite la sucursal como clave) | 3 |
| Prueba local con `sort` como shuffle | 2 |
| Corrida en el cluster con salida en una carpeta nueva | 2 |
| Resultado exacto | 2 |
| Explica por qué el reducer sirve igual | 1 |

### Ejercicio 2. Ventas por mes

Con la misma idea, calculá unidades y facturación **por mes** (`2026-01`,
`2026-02`, ...). ¿Qué mes facturó más?

<details><summary>Solución</summary>

El mapper emite `fecha[:7]` (los primeros 7 caracteres de la fecha) como
clave. Se corre igual que el anterior, con otro nombre de mapper y otra
carpeta de salida:

<!-- prueba: adentro | espera: 2026-01	104122	330992000 -->
```bash
cat > mapper_mes.py <<'EOF'
import sys

for linea in sys.stdin:
    campos = linea.strip().split(",")
    if len(campos) != 5 or campos[0] == "fecha":
        continue
    fecha, sucursal, producto, cantidad, precio = campos
    print(f"{fecha[:7]}\t{cantidad}\t{int(cantidad) * int(precio)}")
EOF
hdfs dfs -rm -r -f /user/root/resultados/mr_por_mes
hadoop jar $HADOOP_HOME/share/hadoop/tools/lib/hadoop-streaming-3.3.6.jar \
  -files mapper_mes.py,ejemplos/reducer.py \
  -mapper "python3 mapper_mes.py" -reducer "python3 reducer.py" \
  -input /user/root/ventas -output /user/root/resultados/mr_por_mes
hdfs dfs -cat /user/root/resultados/mr_por_mes/part-*
```

```text
2026-01	104122	330992000
2026-02	92357	294766600
2026-03	102241	328358900
2026-04	98619	317441300
2026-05	102777	329053100
2026-06	98957	312655300
```

Enero es el mes de mayor facturación. Febrero es el más bajo, en parte
porque tiene 28 días.

</details>

**Rúbrica (8 puntos)**: mapper con la clave de mes (3), corrida correcta (2),
resultado exacto (2), mes de mayor facturación (1).

### Ejercicio 3. Dos reducers

Corré el trabajo de ventas por producto de la guía con **2 reducers** y
mirá la carpeta de salida. ¿Cuántos archivos `part-r-*` hay? ¿Cómo se
repartieron los productos entre ellos? ¿Cambian los totales?

<details><summary>Solución</summary>

La cantidad de reducers se pasa con `-D`, antes de las otras opciones:

<!-- prueba: no (solución de ejercicio: -D mapreduce.job.reduces no se usa en las guías probadas) -->
```bash
hdfs dfs -rm -r -f /user/root/resultados/mr_2reducers
hadoop jar $HADOOP_HOME/share/hadoop/tools/lib/hadoop-streaming-3.3.6.jar \
  -D mapreduce.job.reduces=2 \
  -files ejemplos/mapper.py,ejemplos/reducer.py \
  -mapper "python3 mapper.py" -reducer "python3 reducer.py" \
  -input /user/root/ventas -output /user/root/resultados/mr_2reducers
hdfs dfs -ls /user/root/resultados/mr_2reducers
hdfs dfs -cat /user/root/resultados/mr_2reducers/part-r-00000
hdfs dfs -cat /user/root/resultados/mr_2reducers/part-r-00001
```

- Hay dos archivos, `part-r-00000` y `part-r-00001`, más `_SUCCESS`.
- Cada producto está en **uno solo** de los dos: el *partitioner* (de fábrica,
  por el hash de la clave) manda todas las apariciones de una clave al mismo
  reducer. Cada archivo está ordenado por producto, pero entre los dos no hay
  un orden global.
- Los totales de cada producto son los mismos de la guía; solo cambia en qué
  archivo quedó cada uno.

</details>

**Rúbrica (8 puntos)**: usa `mapreduce.job.reduces=2` (2), encuentra los dos
`part-r-*` (2), explica que cada clave va a un solo reducer (3), verifica que
los totales no cambian (1).

### Ejercicio 4. El historial de YARN

Después de los ejercicios anteriores, listá los trabajos terminados desde la
terminal y buscá en http://localhost:19888 el de ventas por sucursal. Anotá
cuántos mappers y cuántos reducers tuvo, y cuánto tardó.

<details><summary>Solución</summary>

<!-- prueba: adentro | espera: FINISHED -->
```bash
yarn application -list -appStates FINISHED
```

- La lista muestra cada trabajo con su id (`application_...`), su tipo
  (`MAPREDUCE`) y su estado final.
- En 19888, el trabajo tiene **6 maps** (uno por bloque) y **1 reduce**. El
  tiempo depende de la compu.
- Los logs de un trabajo terminado también salen por consola con `yarn logs
  -applicationId <id>`.

</details>

**Rúbrica (6 puntos)**: lista los trabajos terminados (2), encuentra el
trabajo en el JobHistory (2), 6 mappers y 1 reducer con su explicación (2).
