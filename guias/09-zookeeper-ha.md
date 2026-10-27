# 9. ZooKeeper y alta disponibilidad (HA)

Con un solo NameNode, si se cae, HDFS entero queda sin servicio: es el *punto
único de falla*. Con **alta disponibilidad** hay dos (o tres) NameNodes: uno
*active* y los otros *standby*, y **ZooKeeper** decide quién manda. Si el
activo se cae, otro toma el control solo, en segundos.

[← 8. Spark](08-spark.md) · [Índice](README.md) · Siguiente: [10. MongoDB →](10-mongodb.md)

## Las piezas

| Pieza | Qué hace |
|---|---|
| **NameNodes** (2 o 3) | Uno *active* atiende a todos; los *standby* tienen los metadatos al día, listos para reemplazarlo |
| **JournalNodes** (3) | Guardan el registro de cada cambio de HDFS. El activo escribe ahí y los standby leen: así están al día. Hacen falta la mayoría (2 de 3) |
| **ZooKeeper** (puerto 2181) | Servicio de coordinación: lleva un "candado" que solo puede tener un NameNode a la vez. El que lo tiene es el activo |
| **ZKFC** (uno por NameNode) | Vigila a su NameNode. Si se cae, suelta el candado y otro ZKFC lo toma y hace activo a su NameNode |

## Un cluster con HA, aparte

`NAMENODES` queda fijo al crear el volumen. Para no tocar tu cluster
`bigdata`, armamos otro, `bigdata-ha`, con **su propio volumen**
(`bigdata_ha`) y solo HDFS (`SERVICIOS=hdfs`, más liviano). Los dos juntos no
entran en la memoria de una notebook: primero se apaga el otro.

Desde tu compu:

<!-- prueba: compu -->
```bash
docker stop bigdata
docker run -d --name bigdata-ha --stop-timeout 20 \
  -e NAMENODES=2 -e DATANODES=3 -e REPLICATION=2 -e BLOCK_SIZE=1m -e SERVICIOS=hdfs \
  -p 127.0.0.1:9870-9872:9870-9872 -p 127.0.0.1:8480-8482:8480-8482 \
  -v bigdata_ha:/hadoop \
  franki678/bigdata-sandbox:base
```

En PowerShell o CMD, en una sola línea (sin las `\`). Esperá el cartel
*Cluster LISTO* (`docker logs -f bigdata-ha`):

<!-- prueba: esperar listo bigdata-ha -->

<!-- prueba: compu | espera: active | espera: standby -->
```bash
docker exec bigdata-ha namenode
```

```text
  NameNode 1 (nn1)  http://localhost:9870  active
  NameNode 2 (nn2)  http://localhost:9871  standby
```

En el navegador, http://localhost:9870 y http://localhost:9871: arriba de
cada una dice *(active)* o *(standby)*.

## Mirar adentro

<!-- prueba: no (abre una consola interactiva) -->
```bash
docker exec -it bigdata-ha bash
```

Lo que sigue va **adentro** de `bigdata-ha`. Qué NameNode es el activo, según
Hadoop, y el candado en ZooKeeper:

<!-- prueba: adentro bigdata-ha | espera: active | espera: ActiveStandbyElectorLock -->
```bash
hdfs haadmin -getAllServiceState
zkCli.sh -server localhost:2181 ls /hadoop-ha/sandbox
```

- `ActiveStandbyElectorLock` es el candado: lo tiene el NameNode activo.
- `ActiveBreadCrumb` recuerda quién fue el último activo (para que, si
  vuelve, no crea que sigue mandando).

Subí un archivo para tener algo que leer después:

<!-- prueba: adentro bigdata-ha | espera: texto.txt -->
```bash
hdfs dfs -put -f ejemplos/texto.txt /user/root/
hdfs dfs -ls /user/root
```

## Se cae el NameNode activo

Apagamos el que esté *active* (la primera línea lo busca en la salida de
`namenode`), esperamos unos segundos y miramos:

<!-- prueba: adentro bigdata-ha | espera: lo apago | espera: hadoop guarda los datos en bloques -->
```bash
activo=$(namenode | awk '/active/ {print $2}')
echo "El activo es el $activo: lo apago"
namenode stop $activo
sleep 20
namenode
hdfs dfs -cat /user/root/texto.txt
```

- El que era *standby* ahora dice *active*, y el apagado, `APAGADO`.
- HDFS sigue andando: el archivo se lee igual.
- En la web del que quedó (9870 o 9871) dice *(active)*.

Lo volvemos a prender: vuelve como **standby** (el activo sigue siendo el que
tomó el control).

<!-- prueba: adentro bigdata-ha | espera: standby | espera: active -->
```bash
namenode start 1
namenode start 2
sleep 20
namenode
```

(Uno de los dos `start` dice *ya estaba prendido*: es el que no apagamos.)

**Para pensar:** ¿qué pasa si apagás los dos? ¿Y si con un solo NameNode
(tu cluster `bigdata`) hacés `namenode stop 1`?

## Volver a tu cluster

Borrar el de HA (y su volumen) y prender el tuyo, desde tu compu:

<!-- prueba: compu -->
```bash
docker rm -f bigdata-ha
docker volume rm bigdata_ha
docker start bigdata
```

<!-- prueba: esperar listo -->

Si querés conservar el de HA para otra clase, en vez de borrarlo:
`docker stop bigdata-ha`.

## Lo más usado

| Comando (adentro) | Qué hace |
|---|---|
| `namenode` | Lista los NameNodes y cuál es el activo |
| `namenode stop N` / `namenode start N` | Apaga / prende el NameNode N |
| `hdfs haadmin -getAllServiceState` | El estado de cada NameNode según Hadoop |
| `hdfs haadmin -getServiceState nn1` | El de uno solo |
| `zkCli.sh -server localhost:2181` | Consola de ZooKeeper (`ls /`, `get <nodo>`, salir: `quit`) |
| `zkCli.sh -server localhost:2181 ls /hadoop-ha/sandbox` | El candado de la elección |

## Para profundizar

- Teoría: [ZooKeeper y alta disponibilidad](base/teoria/08-zookeeper-ha.md): el porqué y cómo funciona por dentro.
- Evaluación: [ZooKeeper y HA](base/evaluacion/08-zookeeper-ha.md): preguntas y ejercicios con sus respuestas.
- Referencia: [ZooKeeper](base/referencia.md#zookeeper) y [NameNode](base/referencia.md#namenode): comandos, opciones y puertos.
