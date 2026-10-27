# Versión `full`: el cluster manejado desde el navegador

`full` es la imagen `ml` con una **interfaz web** en el puerto 8080. Desde ahí
se elige la configuración del cluster, se lo prende y se lo apaga, y se mira por
dentro mientras trabaja: HDFS con sus bloques y réplicas, los trabajos de YARN
con sus contenedores y logs, consultas en Hive, MariaDB, MongoDB y Pig, un
pipeline de punta a punta, modelos de machine learning dibujados por dentro y
las prácticas de la materia paso a paso.

La interfaz no esconde nada: cada botón corre el **mismo comando** que
escribirías en la terminal y te lo muestra. Por eso sirve para aprender los
comandos y, a la vez, para ver qué pasa en el cluster cuando los corrés.

![La interfaz de la versión full: el cluster en marcha con su arquitectura en vivo](../../docs/capturas/cluster.png)

## Para quién es

- Para quien cursa la materia y quiere **ver** lo que hace cada comando: en
  qué DataNodes quedó un bloque, cuántos contenedores pidió un trabajo, qué
  plan armó Hive.
- Para el docente que quiere mostrar en clase una falla (un DataNode que se
  cae, un NameNode que hace failover) y que todos vean lo mismo.
- Para quien ya hizo las guías de `base` en la terminal y quiere repasarlas con
  las **Prácticas guiadas**, que preguntan el comando antes de correrlo.

## Qué agrega sobre `ml`

| | `base` | `ml` | `full` |
|---|---|---|---|
| Hadoop, Hive, Spark, Pig, Sqoop, MySQL, ZooKeeper, MongoDB | sí | sí | sí |
| Python para datos (pandas, scikit-learn) y JupyterLab | — | sí | sí |
| Interfaz web en `localhost:8080` | — | — | sí |
| Arranque | solo, con variables | solo, con variables | espera **Iniciar** en la interfaz (o solo con `AUTOSTART=1`) |
| Proceso principal del contenedor | `/opt/entrypoint.sh` | `/opt/entrypoint.sh` | el servidor de la interfaz (`python3 -m sandbox_server`), que lanza el mismo `/opt/entrypoint.sh` |

Todo lo de [`base`](../base/README.md) y de [`ml`](../ml/README.md) vale igual
en `full`: los mismos procesos, puertos, carpetas y comandos. La terminal sigue
estando (`docker exec -it bigdata-full bash`) y lo que hacés ahí aparece en la
interfaz, y al revés.

## Requisitos

- Docker Desktop (Windows o Mac) o Docker Engine (Linux), con **7 GB de RAM**
  para Docker, como `ml` (8 GB con alta disponibilidad). La interfaz toma
  como tope 7,7 GB, lo que Docker Desktop le da por defecto en una PC de
  16 GB, y la pantalla de Configuración calcula la memoria de cada
  combinación antes de arrancar.
- Disco: lo de `ml` (unos 4,5 GB en Docker Desktop, 2,9 GB en Linux) más la
  interfaz, que pesa poco, y lo que ocupen tus datos en el volumen.
- Un navegador actual. La vista 3D de los modelos necesita WebGL; sin WebGL la
  interfaz lo avisa y muestra la misma cuenta en texto.
- Intel/AMD (amd64) o ARM (Mac M1–M4): Docker baja sola la que corresponde.

## Arrancar

En una carpeta de trabajo (la misma que usás para las guías), con una carpeta
`datos/` adentro:

<!-- prueba: no (baja y arranca la imagen full: lo prueba el humo de full.yml, no este corredor) -->
```bash
docker run -d --name bigdata-full --stop-timeout 20 \
  -p 127.0.0.1:8080:8080 -v bigdata_full:/hadoop -v "$(pwd)/datos:/datos" \
  franki678/bigdata-sandbox:full
```

En PowerShell el último `-v` va como `"${PWD}/datos:/datos"`; en CMD, como
`"%cd%\datos:/datos"`.

- `-p 127.0.0.1:8080:8080`: la interfaz, solo para tu compu.
- `-v bigdata_full:/hadoop`: el volumen con HDFS, las tablas de Hive, MySQL,
  MongoDB y la configuración que elijas en la interfaz.
- `-v …/datos:/datos`: tu carpeta `datos/` adentro. Al iniciar el cluster se
  copian ahí los ejemplos (`/datos/ejemplos`) y lo que bajes de HDFS aparece en
  tu compu.
- `--stop-timeout 20`: le da tiempo al apagado ordenado (`docker stop` espera
  hasta 20 s antes de matar los procesos).

Abrís http://localhost:8080 y tocás **Iniciar cluster**. El primer arranque
formatea HDFS y carga las bases de ejemplo (unos 2 minutos); los siguientes
tardan menos de uno. Con `-e AUTOSTART=1` el cluster arranca solo, con las
variables de siempre (`DATANODES`, `REPLICATION`, `SERVICIOS`...).

La guía [1. Arrancar y primer recorrido](01-arrancar-y-recorrido.md) lo hace
paso a paso.

## Demo online

Para mirarla sin instalar nada está la
[demo](https://franki-678.github.io/bigdata-sandbox/demo/): la misma interfaz
con un cluster **simulado** en el navegador (tiempos acelerados, sin Hadoop de
verdad). Sirve para conocer las pantallas y para seguir estas guías antes de
bajar la imagen. Lo que hagas ahí no corre en ningún lado. Las capturas de esta
documentación salen de la demo.

## Mapa de la documentación

| Parte | Qué tiene | Para qué |
|---|---|---|
| Guía paso a paso (01 a 10) | Una pantalla por guía: qué hacer, qué se ve, qué significa y el comando equivalente | Aprender a usarla, en orden |
| [Referencia](referencia.md) | Pantalla por pantalla y control por control: qué muestra, de dónde sale el dato, el comando y dónde se usa en la industria | Consultar mientras trabajás |
| [Teoría](teoria/README.md) | Observabilidad, salud de HDFS, ciclo de vida en YARN, pipelines, cómo una UI habla con un cluster, interpretabilidad | Entender por qué funciona así |
| [Evaluación](evaluacion/README.md) | Multiple choice, preguntas de desarrollo y ejercicios sobre la interfaz, con respuestas y rúbricas | Repasar y evaluar |

### La guía paso a paso

1. [Arrancar y primer recorrido](01-arrancar-y-recorrido.md): el `docker run`,
   Inicio, la barra lateral, la paleta y la ayuda.
2. [El panel del cluster y el sinóptico](02-cluster-y-sinoptico.md): las
   lámparas, los procesos, el arranque paso a paso y las alertas.
3. [HDFS desde la interfaz](03-hdfs.md): subir, mirar bloques, replicar, fsck
   y apagar un DataNode.
4. [YARN y los trabajos](04-trabajos-yarn.md): lanzar MapReduce, Tez y Spark,
   seguir el avance, el DAG y los logs.
5. [Consultas](05-consultas.md): Hive, MariaDB, MongoDB y Pig, con el
   resultado, el plan y quién lo resolvió.
6. [Pipeline](06-pipeline.md): de `ventas_sucias.csv` al resumen y al modelo,
   en 6 etapas.
7. [Machine Learning y el modelo por dentro](07-machine-learning.md):
   entrenar, comparar y mirar qué aprendió.
8. [Prácticas guiadas](08-practicas.md): las guías de la materia con pregunta,
   Ejecutar y verificación.
9. [Configuración y compose](09-configuracion-y-compose.md): nodos,
   réplicas, servicios, memoria y el `docker-compose.yml`.
10. [La Consola](10-consola.md): todo lo que pasó, con el comando exacto.

### Orden de estudio sugerido

1. Si nunca usaste el sandbox: primero las guías 01 a 03 de
   [`base`](../README.md) en la terminal (instalar, arrancar, HDFS). La
   interfaz se entiende mejor si ya escribiste `hdfs dfs -put` alguna vez.
2. Después, estas guías 01 y 02 para conocer la interfaz.
3. Para cada tema de la materia: la guía de `base` en la terminal, la
   práctica guiada del mismo tema (guía 08) y la guía de `full` de esa
   pantalla (03 a 07).
4. La teoría de cada tema cuando algo no cierra; la evaluación al final.
5. La guía 09 cuando quieras cambiar la forma del cluster (más DataNodes,
   alta disponibilidad).

## Cómo leer los bloques de comandos

Cada guía dice, para cada cosa que hacés en la interfaz, el **comando
equivalente** en la terminal. Esos comandos se corren adentro del contenedor:

<!-- prueba: no (es el contenedor de full, que no levanta el corredor de las guías) -->
```bash
docker exec -it bigdata-full bash
```

Arriba de cada bloque hay un comentario (no se ve en GitHub) que dice cómo se
prueba; los que dicen `no` explican por qué. Los bloques de texto son salidas
reales tomadas de las pruebas de la imagen.

## Si algo no anda

- La interfaz explica, en cada botón deshabilitado y en cada pantalla
  bloqueada, **por qué** no se puede y **cómo** habilitarlo.
- Los problemas del cluster (memoria, puertos, volumen) son los mismos de
  `base`: ver [11. Problemas](../11-problemas.md).
- El detalle del servidor y su API está en [server/README.md](../../server/README.md)
  y [ui/API.md](../../ui/API.md).
