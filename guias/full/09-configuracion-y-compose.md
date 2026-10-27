# 9. Configuración y docker-compose.yml

Cambiar la forma del cluster (cuántos DataNodes y NameNodes, cuántas réplicas,
qué tamaño de bloque, qué servicios) desde la interfaz, ver cuánta memoria va
a pedir antes de arrancar y llevarse todo a un `docker-compose.yml` para
levantar el mismo cluster sin la interfaz. Es la parte de "variables de
entorno" de las guías [1](../01-instalacion.md) y
[2](../02-arrancar-y-apagar.md), con un dibujo que muestra qué cambia.

[← 8. Prácticas guiadas](08-practicas.md) · [Índice de full](README.md) · Siguiente: [10. Consola →](10-consola.md)

La pantalla es **Configuración** (`G S`). Se puede usar con el cluster
apagado o prendido: los cambios se aplican reiniciando.

## Paso 1. La pantalla

**Qué se ve.** El título *Configuración* con "Las variables de entorno del
contenedor. Se aplican reiniciando el cluster; los datos quedan en el
volumen." y el botón **Ver docker-compose.yml**. A la izquierda, cuatro
paneles: **HDFS**, **Servicios**, **Avanzado** y **Empezar de cero**. A la
derecha, **Arquitectura** (el mismo dibujo de la pantalla Cluster) y
**Memoria** ("estimada para Docker · N procesos").

Cada campo dice su variable de entorno al lado del nombre. Pasando el mouse
por un campo, el dibujo resalta la parte que cambia.

**Qué significa.** Cada control es una variable del `docker run` (o del
`environment:` del compose). La interfaz no inventa nada: arma esas
variables y reinicia los procesos con ellas.

## Paso 2. HDFS: DataNodes, réplicas, bloque y NameNodes

| Campo | Variable | Valores | Qué dice la pantalla |
|---|---|---|---|
| DataNodes | `DATANODES` | 1 a 9 | Procesos que guardan los bloques. Cada uno tiene su carpeta y su página, y suma unos 250 MB. |
| Réplicas por bloque | `REPLICATION` | 1 a 9 | Copias de cada bloque, cada una en un DataNode distinto. Con 2 o más, si se cae un nodo no se pierde nada. |
| Tamaño de bloque | `BLOCK_SIZE` | 1 MB, 16 MB, 128 MB, 1 GB u otro (`8m`, `64m`...) | HDFS corta cada archivo en bloques de este tamaño. 1 MB para ver muchos bloques con archivos chicos; 128 MB es el de un cluster real. |
| NameNodes | `NAMENODES` | 1, 2 · HA, 3 · HA | Con 2 o 3 se arma alta disponibilidad: si el activo se cae, ZooKeeper promueve al que está en espera. |

Debajo de cada campo, una nota que se actualiza: "Páginas en
localhost:9901–9903", "Aguanta 1 DataNode caído", "ventas_grandes.csv (5,9 MB)
→ 6 bloques" (con bloque de 1 MB).

**Qué hacer.** Poné 3 DataNodes, 2 réplicas y bloque de 1 MB.

**Qué significa.**

- Las réplicas no pueden superar a los DataNodes: "Hay 1 DataNode: cada
  bloque va a quedar con 1 copia y HDFS lo marca sub-replicado." (es un
  aviso, no un error). Con 1 réplica: "Con una sola copia, si se cae un
  DataNode sus bloques quedan perdidos hasta que vuelva."
- El tamaño de bloque "Se aplica a los archivos que subas desde ahora; los
  que ya están conservan su tamaño de bloque."
- La cantidad de NameNodes "Queda fijo al crear el volumen, porque los
  NameNodes formatean HDFS juntos". Con un volumen ya creado, las otras
  opciones aparecen con un candado (*fijo*): "El volumen se creó con otra
  cantidad. Borralo para elegir esta."

Con `NAMENODES=1` hay un NameNode y un Secondary ("Un NameNode y un Secondary
que le guarda copias. Lo liviano."); con 2, "Uno activo y otro en espera, con
ZooKeeper y 3 JournalNodes."; con 3, "Uno activo y dos en espera. Pide unos 8
GB."

## Paso 3. Servicios

| Campo | Variable | Opciones |
|---|---|---|
| Stack | `SERVICIOS` | `hdfs` (4 GB): Solo HDFS. El más liviano y el que más rápido arranca. · `mapreduce` (5 GB): Suma YARN, MapReduce, Pig, Sqoop y MySQL. · `todo` (6 GB): Suma Hive (sobre Tez) y Spark. Hive tarda ~1 min en arrancar. |
| MongoDB | `MONGODB` | Base de documentos en el 27017, con la base tienda (20.000 pedidos). Suma unos 500 MB. |
| JupyterLab | `JUPYTER` | Notebooks de Python en el 8888, con pandas, scikit-learn y PySpark. |
| Memoria del comando pig (Avanzado) | `PIG_HEAPSIZE` | 512, 1024 o 2048 MB: la del programa pig mismo, no la de sus trabajos (esa la pone YARN). |

**Qué significa.** "Cada opción incluye a la anterior." y "Pig y Sqoop no son
servicios: mandan trabajos MapReduce a YARN." Lo que no está prendido
aparece apagado en Inicio, con el motivo y cómo activarlo. Los valores de
fábrica de la imagen son 1 DataNode, 1 réplica, bloque de 128 MB, 1 NameNode,
`SERVICIOS=todo`, MongoDB apagado, JupyterLab prendido y pig con 512 MB.

## Paso 4. La memoria estimada

**Qué se ve.** En **Memoria**, un número grande ("X GB de 7,7"), una barra con
una marca en el límite y un cartel: **Entra con margen**, **Entra justo** (más
del 85 % del límite) o **No entra**. **Ver de dónde sale** desarma la cuenta:

| Parte | MB |
|---|---|
| HDFS y sistema | 4096 |
| cada DataNode más allá del primero | 256 |
| YARN, MapReduce y MySQL (si no es `hdfs`) | 1024 |
| Hive y Spark (con `todo`) | 1024 |
| Alta disponibilidad | 2048 con 2 NameNodes, 2560 con 3 |
| MongoDB | 512 |
| JupyterLab | 384 |
| Esta interfaz | 128 |

Abajo, el resumen en una línea con el tamaño de bloque.

**Qué significa.** El límite (7884 MB) es lo que Docker Desktop le da por
defecto a una PC de 16 GB. Si la estimación no entra, el contenedor va a
arrancar igual pero algún proceso puede morir por falta de memoria: conviene
bajar servicios o subir la memoria de Docker. Ver la
[guía 1 de la materia](../01-instalacion.md) para cambiar ese límite.

## Paso 5. Aplicar los cambios

**Qué se ve.** Ni bien cambiás algo, aparece una barra abajo: "N cambios sin
aplicar", la lista *antes → después* y qué implica:

- Cluster apagado: "Se usa en el próximo arranque. Los datos quedan en el
  volumen." con **Descartar**, **Guardar** y **Guardar e iniciar**.
- Cluster prendido: "Para aplicarlo se reinicia el cluster: tarda alrededor
  de un minuto." con **Descartar** y **Aplicar y reiniciar**, que confirma:
  "El cluster se apaga y vuelve a arrancar con la nueva configuración. HDFS,
  las tablas de Hive y las bases quedan en el volumen."

Si un campo tiene error (por ejemplo, un tamaño de bloque como `abc`: "Número
seguido de m o g: 1m, 32m, 128m, 1g. Mínimo 1m."), la barra dice "1 campo con
error" y los botones quedan bloqueados con "Corregí el campo marcado en
rojo". En **Arquitectura**, el dibujo pasa a "cómo queda con tus cambios",
con la etiqueta *sin aplicar*.

**Qué significa.** Las reglas de validación son las mismas en la interfaz y en
el servidor. La configuración guardada vive en el volumen: sobrevive a que se
borre y se vuelva a crear el contenedor.

## Paso 6. El docker-compose.yml

**Qué hacer.** **Ver docker-compose.yml**.

**Qué se ve.** Una hoja con "El mismo cluster, sin pasar por esta interfaz.
Guardalo en una carpeta vacía y corré `docker compose up -d`.", el archivo, el
aviso "Los puertos quedan en **127.0.0.1**: solo los ve tu compu. El sandbox
no tiene contraseñas." y el botón **Descargar**. El archivo refleja lo que
tenés en pantalla, aunque no lo hayas aplicado.

Qué tiene el archivo:

| Parte | Qué dice | Por qué |
|---|---|---|
| Comentarios de arriba | `docker compose up -d`, `logs -f` hasta "Cluster LISTO", `stop` | Cómo usarlo, sin abrir otra guía. |
| `name: bigdata`, servicio `bigdata`, `container_name: bigdata` | El proyecto y el contenedor | El mismo nombre que usan las guías (`docker exec -it bigdata bash`). |
| `image:` | `franki678/bigdata-sandbox:full` (o la etiqueta que esté corriendo) | La misma imagen. |
| `AUTOSTART: "1"` | Arranca solo con estas variables | Sin ella, la imagen espera **Iniciar** en la interfaz. |
| `DATANODES` ... `JUPYTER` | Las variables de la pantalla | Con un comentario si las réplicas superan a los DataNodes o si hay alta disponibilidad. |
| `PIG_HEAPSIZE` | Comentada si es 512 (el valor de fábrica) | Solo aparece si la cambiaste. |
| `ports:` | 8080 (la interfaz), 9870, 9868 o los de los NameNodes y JournalNodes en HA, 9901-9909; 8088, 8042 y 19888 sin `hdfs`; 10000, 10002, 18080 y 4040 con `todo`; 27017 con MongoDB; 8888 siempre (JupyterLab se puede prender después) | Solo los puertos de lo que se prende, y todos en `127.0.0.1`. |
| `volumes:` | `bigdata_hadoop:/hadoop` (HDFS, metastore, MySQL y MongoDB) y `./datos:/datos` | Los datos sobreviven al contenedor; la carpeta `datos/` de tu compu aparece adentro. |
| `stop_grace_period: 20s` | Tiempo para apagar en orden | Para que HDFS cierre bien al hacer `docker compose stop`. |

La misma configuración sirve con `:base` y `:ml`, que no tienen interfaz:
esas arrancan siempre solas.

**En tu compu.** En una carpeta vacía con el archivo descargado:

<!-- prueba: no (levanta un cluster nuevo; la guía 2 de la materia lo hace) -->
```bash
docker compose up -d
docker compose logs -f
```

## Paso 7. Empezar de cero

**Qué se ve.** El panel **Empezar de cero**: "Borra el volumen: HDFS, las
tablas de Hive, MySQL y MongoDB. Hace falta para cambiar la cantidad de
NameNodes. Equivale a `docker compose down -v`." El botón **Borrar el
volumen** está bloqueado con el cluster prendido ("Primero detené el
cluster") o si todavía no hay volumen ("Todavía no hay volumen: se crea en el
primer arranque"). Al apretarlo confirma: "Se pierde todo HDFS, las tablas de
Hive, la base tienda de MySQL y MongoDB. El próximo arranque formatea de
cero. No se puede deshacer."

**En tu compu.**

<!-- prueba: no (borra el volumen con todos los datos) -->
```bash
docker compose down -v
```

**Qué significa.** El volumen es lo único que guarda estado. Borrarlo es la
forma de cambiar de 1 a 2 NameNodes, o de volver a un HDFS recién formateado
cuando algo quedó roto.

## Dónde se usa esto en la industria

Describir la infraestructura como un archivo (y no a mano) es **Infraestructura
como Código**: `docker-compose.yml` para una máquina, **Helm** y manifiestos
de **Kubernetes** para un cluster, **Terraform** para la nube. Las consolas de
**Cloudera Manager** y **Ambari** hacen lo mismo que esta pantalla con un
cluster Hadoop de verdad: cambiar la réplica o el tamaño de bloque, ver qué
servicios necesitan reinicio y aplicar en orden. Estimar la memoria antes de
desplegar es el *capacity planning* que se hace antes de pedir máquinas.
