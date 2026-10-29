# Evaluación 6: prácticos

Ejercicios con el [aula simulada](../01-aula-simulada.md) andando (maestro,
pc01 y pc02, con el archivo `aula-simulada.yml`). Cada uno tiene enunciado,
solución y una rúbrica de 10 puntos.

[← 5. Redes y dimensionamiento](05-redes-y-dimensionamiento.md) · [Evaluación](README.md)

Antes de empezar:

- El aula arrancada como en la [guía 1, sección 1](../01-aula-simulada.md#1-arrancar),
  con `Cluster LISTO` en las tres.
- Los comandos de `hdfs`, `yarn` y `beeline` se corren **adentro de una
  PC** (`docker exec -it pc01 bash`); los de `docker`, en tu compu.
- Las soluciones no se corren solas: son para comparar con lo que hiciste.
  Lo que dice "tendría que salir" es lo esperable con la configuración de
  la imagen; si sale distinto, la explicación del porqué también suma.

## Práctico 1: el mapa del aula

**Enunciado.**

1. Averiguá cuántos DataNodes y cuántos NodeManagers tiene el aula, y en
   qué rack está cada DataNode.
2. El compose pone `PCS_POR_FILA: "2"`. Sin arrancarlas, predecí en qué
   rack quedarían pc03, pc04 y pc07, y una compu llamada `notebook`.
3. Explicá por qué el maestro no aparece en la lista de YARN.

<details><summary>Solución</summary>

1. Desde pc01:

<!-- prueba: no (solución de un práctico; se corre adentro de pc01 con el aula de la guía 1) -->
```bash
hdfs dfsadmin -printTopology
hdfs dfsadmin -report
yarn node -list
```

   Tendría que salir: 3 DataNodes (`Live datanodes (3)`), en `/profe` el
   maestro y en `/fila1` pc01 y pc02; 2 NodeManagers, `pc01:8041` y
   `pc02:8041`.

2. Con la cuenta `(NN - 1) / 2 + 1` (división entera): pc03 y pc04 en
   `/fila2`, pc07 en `/fila4`. `notebook` no es `maestro` ni `pcNN`:
   `/default-rack`.

3. Con `MAESTRO_NM=no` (el valor de fábrica) el maestro no prende
   NodeManager: no presta memoria ni corre tareas.

</details>

**Rúbrica (10 puntos).**

| Qué | Puntos |
|---|---|
| Cuenta bien DataNodes (3) y NodeManagers (2), con los comandos | 3 |
| Racks actuales correctos | 2 |
| Predicción de pc03, pc04 y pc07 | 3 |
| `notebook` en `/default-rack` | 1 |
| Por qué el maestro no está en YARN | 1 |

## Práctico 2: réplicas y políticas

**Enunciado.**

1. Generá un archivo de 4 MB y subilo a `/aula/r2.txt` con bloques de 1 MB
   y **replicación 2**. ¿Dónde quedan las réplicas de cada bloque y de qué
   tipo son? Explicalo con la política de `/`.
2. Pasalo a replicación 3. ¿Qué cambia?
3. Creá `/aula/frio`, ponele la política `COLD` y subí ahí el mismo
   archivo (replicación 3, la de fábrica). ¿Cuántas réplicas tiene cada
   bloque? ¿Por qué?

<details><summary>Solución</summary>

1. Desde pc01:

<!-- prueba: no (solución de un práctico; se corre adentro de pc01 con el aula de la guía 1) -->
```bash
yes "replica rack fila" | head -c 4M > /tmp/r2.txt
hdfs dfs -D dfs.blocksize=1m -D dfs.replication=2 -put -f /tmp/r2.txt /aula/r2.txt
hdfs fsck /aula/r2.txt -files -blocks -locations
```

   Tendría que salir: 4 bloques, cada uno con `Live_repl=2`: una réplica
   `ARCHIVE` (el maestro) y una `DISK` (pc01 o pc02). `/` tiene `WARM`, que
   con dos réplicas pide una `DISK` y una `ARCHIVE`.

2. Subir la replicación:

<!-- prueba: no (solución de un práctico; se corre adentro de pc01 con el aula de la guía 1) -->
```bash
hdfs dfs -setrep -w 3 /aula/r2.txt
hdfs fsck /aula/r2.txt -files -blocks -locations
```

   `-w` espera a que termine. Ahora cada bloque tiene `Live_repl=3`: sigue
   habiendo una sola `ARCHIVE` y aparece una segunda `DISK` (las dos PCs).
   El NameNode mandó copiar una réplica más de cada bloque, de DataNode a
   DataNode.

3. Política `COLD`:

<!-- prueba: no (solución de un práctico; se corre adentro de pc01 con el aula de la guía 1) -->
```bash
hdfs dfs -mkdir -p /aula/frio
hdfs storagepolicies -setStoragePolicy -path /aula/frio -policy COLD
hdfs dfs -D dfs.blocksize=1m -put -f /tmp/r2.txt /aula/frio/r2.txt
hdfs fsck /aula/frio/r2.txt -files -blocks -locations
```

   Tendría que salir: cada bloque con **una sola** réplica, `ARCHIVE`, en
   el maestro, y el archivo sub-replicado (fsck dice `HEALTHY`, con
   `Under-replicated blocks` mayor que 0). `COLD` quiere todas las réplicas
   en `ARCHIVE` y no acepta reemplazo; hay un solo DataNode `ARCHIVE` y un
   nodo no guarda dos copias del mismo bloque. Moraleja: una política tiene
   que tener dónde cumplirse.

</details>

**Rúbrica (10 puntos).**

| Qué | Puntos |
|---|---|
| Sube con bloques de 1 MB y replicación 2, con el comando correcto | 2 |
| Lee bien fsck: tipos y nodos de cada réplica | 2 |
| Lo explica con `WARM` (una `DISK` y una `ARCHIVE`) | 2 |
| `setrep` y qué copia nueva aparece | 2 |
| `COLD`: una réplica y por qué no hay más | 2 |

## Práctico 3: la caída de pc01

**Enunciado.** Con un archivo de varios bloques en `/aula` (por ejemplo el
`/aula/texto.txt` de la guía 1):

1. Apagá pc01 de golpe y medí cuánto tarda el NameNode en darla por
   muerta. Compará con la cuenta teórica.
2. Mientras está apagada: ¿se puede leer el archivo entero? ¿Qué dice
   `hdfs fsck /`? ¿Hay re-replicación? ¿Por qué?
3. ¿Qué dice YARN de pc01 en ese momento? ¿Por qué no coincide con HDFS?
4. Prendela otra vez y mostrá que todo vuelve a la normalidad.

<details><summary>Solución</summary>

1. Desde tu compu, lo mismo que la guía 1 con pc02:

<!-- prueba: no (solución de un práctico; se corre en la compu con el aula de la guía 1) -->
```bash
docker kill pc01
for i in $(seq 1 40); do
  docker exec maestro curl -s 'http://localhost:9870/jmx?qry=Hadoop:service=NameNode,name=FSNamesystemState' \
    | grep -q '"NumDeadDataNodes" : 1' && break
  sleep 3
done
echo "pc01 marcada muerta despues de unos $((i * 3)) s"
```

   Tendría que dar unos 40 s (se mide de a 3 s). La cuenta: `2 × recheck +
   10 × heartbeat = 2 × 5 + 10 × 3 = 40` s.

2. Desde pc02 (pc01 está apagada) y el maestro:

<!-- prueba: no (solución de un práctico; se corre en la compu con el aula de la guía 1) -->
```bash
docker exec pc02 bash -c "hdfs dfs -cat /aula/texto.txt | wc -c"
docker exec maestro hdfs fsck /
docker exec maestro estado
```

   Se lee entero (`8388608` para el archivo de la guía 1). fsck:
   `Under-replicated blocks` mayor que 0 y `HEALTHY`. `estado`: `DataNodes
   vivos 2, muertos 1`. No hay re-replicación: quedan el maestro y pc02,
   que ya tienen una réplica de cada bloque, y no hay un tercer DataNode.

3. En <http://localhost:8088> → Nodes, o `docker exec maestro yarn node
   -list -all`: pc01 puede seguir `RUNNING` un buen rato. YARN tiene su
   propio plazo para dar por perdido un NodeManager (10 minutos de
   fábrica, que la imagen no cambia); el de HDFS lo acorta la imagen.

4. Prenderla y esperar:

<!-- prueba: no (solución de un práctico; se corre en la compu con el aula de la guía 1) -->
```bash
docker start pc01
for i in $(seq 1 60); do
  docker exec maestro curl -s 'http://localhost:9870/jmx?qry=Hadoop:service=NameNode,name=FSNamesystemState' \
    | grep -q '"UnderReplicatedBlocks" : 0' && break
  sleep 2
done
docker exec maestro estado
```

   `estado` tiene que mostrar `DataNodes vivos 3, muertos 0` y
   `sub-replicados 0`: el DataNode mandó su block report y sus copias
   volvieron a contar.

</details>

**Rúbrica (10 puntos).**

| Qué | Puntos |
|---|---|
| Mide el tiempo y lo compara con la cuenta de 40 s | 2 |
| Muestra que el archivo se lee entero | 2 |
| fsck: sub-replicados pero `HEALTHY`, y qué quiere decir | 2 |
| Por qué no hay re-replicación con dos PCs | 2 |
| Diferencia con YARN (plazo propio) | 1 |
| Vuelta a la normalidad, con evidencia | 1 |

## Práctico 4: dónde corren las tareas

**Enunciado.**

1. Corré el wordcount de la guía 1 (sección 4) sobre `/aula/texto.txt`.
   ¿Cuántos maps se lanzaron? ¿Cuántos fueron data-local? ¿Por qué?
2. Mostrá en qué PC corrió cada map. ¿Alguno corrió en el maestro?
3. Con `TRABAJADOR_RAM=2048` en cada PC, calculá cuántos maps pueden correr
   a la vez como máximo, contando el ApplicationMaster.
4. Lanzá un SparkPi desde pc02. ¿Dónde corre el driver y dónde los
   executors? ¿Cuánta memoria de YARN usa?

<details><summary>Solución</summary>

1. Desde pc01:

<!-- prueba: no (solución de un práctico; se corre adentro de pc01 con el aula de la guía 1) -->
```bash
hdfs dfs -rm -r -f -skipTrash /aula/conteo
yarn jar "$HADOOP_HOME"/share/hadoop/mapreduce/hadoop-mapreduce-examples-*.jar wordcount /aula/texto.txt /aula/conteo
```

   En los contadores: `Launched map tasks` 8 (uno por bloque; puede haber
   alguno más por especulación) y `Data-local map tasks` igual o casi
   igual. Con dos PCs y replicación 3, cada PC tiene una réplica de cada
   bloque: un map corre donde corra, tiene su bloque.

2. En <http://localhost:19888> → el trabajo → Map tasks → columna Node, o
   con el script de Python de la guía 1, sección 4. Tendría que decir
   `pc01` o `pc02` en cada map, nunca `maestro`: no tiene NodeManager.

3. 2 × 2048 = 4096 MB, en lugares de 512 MB: 8 lugares. Uno es el
   ApplicationMaster (512 MB): quedan 7 maps a la vez; el octavo arranca
   cuando termina uno.

4. Desde pc02:

<!-- prueba: no (solución de un práctico; se corre adentro de pc02 con el aula de la guía 1) -->
```bash
spark-submit --master yarn --class org.apache.spark.examples.SparkPi "$SPARK_HOME"/examples/jars/spark-examples_*.jar 20
```

   El driver corre en pc02, fuera de YARN (modo `client`). El
   ApplicationMaster y los 2 executors son contenedores de YARN en las PCs:
   cada uno pide 512 MB + 384 MB de overhead y YARN le da 1024 MB, o sea
   3072 MB en total. Se ve en <http://localhost:8088> mientras corre y,
   después, en <http://localhost:18080> → Executors.

</details>

**Rúbrica (10 puntos).**

| Qué | Puntos |
|---|---|
| Corre el wordcount y lee los contadores | 2 |
| Explica por qué son data-local | 2 |
| Muestra la PC de cada map y que ninguno es el maestro | 2 |
| Cuenta de 7 maps a la vez | 2 |
| Spark: driver fuera de YARN, 3 contenedores de 1024 MB | 2 |

## Práctico 5: dimensionar un laboratorio

**Enunciado.** Un laboratorio tiene 18 PCs de alumnos con 8 GB de RAM y
Docker Desktop configurado con 5 GB, y la PC del profe con 16 GB. Las
filas tienen 6 PCs.

1. Proponé los valores de `PCS_POR_FILA`, `TRABAJADOR_RAM` (para las PCs) y
   `MAESTRO_NM` (para el maestro). Justificá.
2. ¿Cuánta memoria para trabajos tiene el cluster? ¿Cuántos SparkPi como
   el del práctico 4 pueden correr a la vez?
3. ¿Qué tendría que medir la sonda antes de armarlo, y qué pasa hoy si el
   veredicto es A o B?
4. En el aula simulada, verificá qué memoria anuncia cada PC.

<details><summary>Solución</summary>

1. `PCS_POR_FILA=6` (tres filas: `/fila1` a `/fila3`, más `/profe`).
   `TRABAJADOR_RAM`: de 5 GB de Docker, sacando ~0,5 a 1 GB de servicios
   (DataNode y NodeManager) y un margen, unos 3 GB: `3072`. Si los alumnos
   lanzan Spark desde su PC, el driver también va fuera de YARN, otra razón
   para no pasar de ahí. `MAESTRO_NM=no`: con 18 PCs sobra memoria y el
   maestro tiene que cuidar NameNode, ResourceManager y Hive. (Se acepta
   `si` si se justifica con la RAM libre del profe.)
2. 18 × 3072 = 55 296 MB (unos 54 GB). Cada SparkPi usa 3072 MB de YARN
   (3 contenedores de 1024): 18 a la vez, uno por PC en promedio. Los
   demás quedan en la cola (`ACCEPTED`).
3. La sonda mide si cada PC llega al profe (`udp_profe`, `inscripcion`),
   si levanta el túnel WireGuard (`tunel`) y si el profe llega a la PC
   (`tcp_entrante`), además de la RAM (`ram_gb`, `docker_ram_mb`). Decide
   con el 80% de las PCs que contestaron. Con A, `empresa` arranca con
   `RED=wireguard` ([guía 3](../03-laboratorio.md)); con B, la red directa
   no está implementada y queda el aula simulada en cada PC.
4. Desde pc01:

<!-- prueba: no (solución de un práctico; se corre adentro de pc01 con el aula de la guía 1) -->
```bash
yarn node -list -showDetails
```

   O `docker exec pc01 estado`, que muestra el NodeManager con `2048 MB
   para trabajos`, y <http://localhost:8088> → Nodes (2 GB por PC).

</details>

**Rúbrica (10 puntos).**

| Qué | Puntos |
|---|---|
| `PCS_POR_FILA` correcto | 1 |
| `TRABAJADOR_RAM` razonable (entre 2048 y 4096), restando servicios y margen | 3 |
| `MAESTRO_NM` justificado | 1 |
| Cuenta de memoria total y de SparkPi a la vez | 2 |
| Qué mide la sonda y qué red arranca con cada veredicto | 2 |
| Verifica la memoria anunciada en el aula simulada | 1 |

## Al terminar

Para dejar el aula como estaba, borrá lo que creaste (desde una PC):

<!-- prueba: no (limpieza de los prácticos; se corre adentro de pc01) -->
```bash
hdfs dfs -rm -r -f -skipTrash /aula/r2.txt /aula/frio /aula/conteo
```

O borrá todo con `docker compose -f aula-simulada.yml down -v` (ver
[guía 1, sección 9](../01-aula-simulada.md#9-apagar-y-borrar)).

[← 5. Redes y dimensionamiento](05-redes-y-dimensionamiento.md) · [Evaluación](README.md)
