# 11. Problemas y cómo arreglarlos

[← 10. MongoDB](10-mongodb.md) · [Índice](README.md)

## Primero, mirar

Casi todo se diagnostica con estos tres, desde tu compu:

<!-- prueba: compu | espera: bigdata | espera: Safe mode is OFF -->
```bash
docker ps -a --filter name=bigdata
docker stats --no-stream bigdata
docker exec bigdata hdfs dfsadmin -safemode get
```

- `docker ps -a`: si el contenedor está prendido (*Up*) o apagado (*Exited*).
- `docker stats`: cuánta RAM y CPU usa (`MEM USAGE / LIMIT`: el límite es la
  RAM que le diste a Docker).
- `safemode get`: si HDFS ya está listo para escribir (*OFF*).

Y el log: primero el arranque (hasta *Cluster LISTO* y el `estado`) y
después lo que van escribiendo HDFS, YARN, Hive y MySQL. Las últimas líneas:

<!-- prueba: compu -->
```bash
docker logs --tail 40 bigdata
```

Para buscar un error del arranque, `docker logs bigdata | grep -E "ERROR|AVISO"`.

Adentro, `estado` muestra cada proceso. Los logs de cada servicio están en
`/opt/hadoop/logs/` (uno por proceso: `hadoop-dn2-datanode-*.log`,
`hadoop-nn1-namenode-*.log`...), `/opt/hive/*.log`, `/opt/spark/logs/`,
`/var/log/mysql/error.log` y `/var/log/mongodb/mongod.log`.

## Síntomas comunes

| Síntoma | Causa y arreglo |
|---|---|
| `the container name "/bigdata" is already in use` | Ya lo creaste: `docker start bigdata`. Para recrearlo, antes `docker rm -f bigdata` |
| `hdfs: command not found` (o `pig`, `beeline`, `mongosh`...) | Estás en tu compu: primero `docker exec -it bigdata bash` |
| `docker: command not found` adentro | Estás adentro: primero `exit` |
| `Cannot connect to the Docker daemon` / `error during connect` | Docker Desktop no está abierto (o todavía arranca) |
| `invalid characters for a local volume name` | El `docker run` es de otra consola: usá el de la tuya (`$(pwd)`, `${PWD}` o `%cd%`) |
| `port is already allocated` o, en Windows, `access permissions` / `forbidden` | Otro programa usa ese puerto: cambiá el número de la izquierda (`-p 127.0.0.1:18088:8088`) o sacá ese `-p` |
| El contenedor se apaga solo con `[sandbox] ERROR: ...` | Un parámetro mal escrito: el mensaje dice cuál. Corregilo y recreá el contenedor |
| El contenedor se apaga solo, sin `ERROR` | Poca RAM para Docker ([guía 1](01-instalacion.md#qué-necesitás)). Mirá `docker logs bigdata` |
| `AVISO: este volumen se creo con N NameNode(s)` | `NAMENODES` no cambia sobre un volumen que ya existe ([guía 2](02-arrancar-y-apagar.md#cambiar-los-parámetros)) |
| `Name node is in safe mode` | Recién prendido: esperá el *Cluster LISTO*. Si sigue, faltan DataNodes (¿bajaste `DATANODES`?) |
| `Output directory ... already exists` | MapReduce no pisa resultados: `hdfs dfs -rm -r <carpeta>` y de nuevo |
| `File exists` en `hdfs dfs -put` | Ya estaba: `hdfs dfs -put -f` |
| Un trabajo queda en `ACCEPTED` sin avanzar | YARN no tiene memoria libre: cerrá las consolas de `pyspark` o `beeline` que no uses, o dale más RAM a Docker |
| `pig` se queda en `Connecting to ResourceManager` | YARN apagado (`SERVICIOS=hdfs`): usá `pig -x local` o recreá con `SERVICIOS=mapreduce` o `todo` |
| `beeline` dice `Connection refused` | HiveServer2 todavía arranca (~1 min después del LISTO de HDFS) o `SERVICIOS` no es `todo`. Mirá `estado` |
| `sqoop` dice `Communications link failure` | MySQL no está corriendo (`SERVICIOS=hdfs`, o recién prendido). Mirá `estado` |
| `sqoop import` dice `No primary key could be found` | La tabla no tiene clave primaria: `-m 1` o `--split-by <columna>` |
| `sqoop export` falla con `Duplicate entry` | La tabla ya tiene esas filas: `TRUNCATE TABLE` antes |
| Muchos `WARN` al correr `sqoop`, `hadoop` o `pig` | Normales. Lo que importa es el final (`Retrieved N records`, `Exported N records`, `Success!`) |
| `Unable to load native-hadoop library` | Aviso normal: no afecta |
| `mongosh` dice `ECONNREFUSED` o `estado` no muestra MongoDB | No está prendido: recreá el contenedor con `-e MONGODB=si` ([guía 10](10-mongodb.md#antes-de-empezar)) |
| `AVISO: este procesador no tiene AVX` | MongoDB necesita AVX: en esa compu no hay MongoDB. Lo demás anda |
| `MySQL NO ARRANCO: este volumen es de la imagen anterior` | Ver [Venís de la imagen anterior](#venís-de-la-imagen-anterior) |
| `docker pull` dice `toomanyrequests` | Límite de descargas de Docker Hub sin cuenta: esperá, hacé `docker login` con una cuenta gratis o usá el archivo del aula ([guía 1](01-instalacion.md#b-en-el-aula-el-archivo-del-profesor)) |
| `docker pull` dice `denied` o `not found` | Revisá el nombre: `franki678/bigdata-sandbox` |
| Abrí un segundo `pyspark` y http://localhost:4040 no muestra el nuevo | La segunda sesión usa el 4041, que no está expuesto: entrá por http://localhost:8088 → *ApplicationMaster* |
| `ModuleNotFoundError: No module named 'pandas'` | pandas y scikit-learn vienen en otra versión de la imagen, `:ml` ([README](../README.md#versiones-de-la-imagen)) |

## Venís de la imagen anterior

Hasta octubre de 2026, `franki678/bigdata-sandbox` (la `latest`) era otra
imagen: Ubuntu 20.04, sin MongoDB. Ahora es la versión `base`: Ubuntu 24.04,
MongoDB y los programas al día. Los comandos son los mismos.

**¿Cuál tengo?** Con el contenedor prendido, desde tu compu:

<!-- prueba: compu | espera: 24.04 -->
```bash
docker exec bigdata grep VERSION= /etc/os-release
```

La nueva dice `24.04`; la anterior, `20.04`. En la nueva, además, `estado`
termina con `Version de la imagen: base`.

**Pasar a la nueva.** Primero tener la imagen nueva ([guía 1](01-instalacion.md#paso-2-tener-la-imagen):
`docker pull` o el archivo del aula). Después, una de dos:

- **Volumen nuevo (lo recomendado en el aula).** Se pierde lo que había en
  HDFS, Hive y MySQL, y se empieza limpio: `docker rm -f bigdata`, `docker
  volume rm bigdata_hadoop` y el `docker run` de la
  [guía 2](02-arrancar-y-apagar.md#crear-el-cluster-una-sola-vez). Con
  compose: `docker compose down -v` y `docker compose up -d`.
- **Conservar los datos.** `docker rm -f bigdata` y el `docker run` de la
  guía 2 con el **mismo** volumen. La primera vez, la nueva pone al día la
  base MySQL (~10 s) y sigue todo como estaba.

**Si dice `MySQL NO ARRANCO`.** Pasa cuando el volumen viene de la anterior y
la última vez se apagó de golpe (sin `docker stop`, se cortó la luz, se
reinició la PC del aula...): el MySQL nuevo no puede abrir una base que quedó
así. HDFS, Hive y Spark andan igual; Sqoop no. Dos arreglos:

1. **Si lo que había en MySQL no importa** (lo normal: es la base de
   ejemplo): borrar solo MySQL; al reiniciar se crea de nuevo con la base
   `tienda`.

   <!-- prueba: no (necesita un volumen de la imagen anterior; lo prueba el escenario volumen-cortado) -->
   ```bash
   docker exec bigdata rm -rf /hadoop/mysql
   docker restart bigdata
   ```

2. **Para no perder nada:** que la cierre bien la imagen anterior, que sigue
   en Docker Hub por su *digest* (su número de versión exacto):

   <!-- prueba: no (necesita un volumen de la imagen anterior; lo prueba el escenario volumen-cortado) -->
   ```bash
   docker rm -f bigdata
   docker run -d --name bigdata -v bigdata_hadoop:/hadoop franki678/bigdata-sandbox@sha256:ec227d9e0559b4294a708a73a91f0e2218871ab0c2ffc3a4f77f347c10f67ce1
   ```

   Cuando diga *Cluster LISTO* (`docker logs -f bigdata`), apagarla bien y
   volver a la nueva:

   <!-- prueba: no (necesita un volumen de la imagen anterior; lo prueba el escenario volumen-cortado) -->
   ```bash
   docker stop -t 20 bigdata
   docker rm bigdata
   ```

   y el `docker run` de la guía 2. MySQL se pone al día solo.

**Volver a la anterior** después de usar la nueva con el mismo volumen no
anda para MySQL (la base ya quedó en el formato nuevo). Si hace falta, con un
volumen nuevo: `-v otro_volumen:/hadoop` y la imagen por digest de arriba.

## Empezar de cero

Para borrar **todo** (HDFS, tablas de Hive, bases MySQL y MongoDB) y volver
al cluster recién creado: borrar el contenedor **y** el volumen, desde tu
compu:

<!-- prueba: compu -->
```bash
docker rm -f bigdata
docker volume rm bigdata_hadoop
```

y el `docker run` de la [guía 2](02-arrancar-y-apagar.md#crear-el-cluster-una-sola-vez).
Los archivos de tu carpeta `datos/` no se borran.

Si `docker volume rm` dice `volume is in use`, el contenedor sigue existiendo:
`docker ps -a` muestra cuál (el `docker rm -f` va primero).
